import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createArchiveBftEngine, type ArchiveBftEngine } from '../src/archive/bft/engine.js'
import { listenArchiveHttp, type ArchiveHttpServer } from '../src/archive/http.js'
import { defaultFacadeViews } from '../src/archive/jsonrpcFacade.js'
import { openArchiveStore } from '../src/archive/store.js'

const ACTIVE = ['fd-01', 'fd-02', 'fd-03', 'fd-04', 'fd-05']
const STANDBY = ['fd-06', 'fd-07']

interface LabNode {
  domainId: string
  role: 'active' | 'standby'
  dataDir: string
  server: ArchiveHttpServer
  engine: ArchiveBftEngine | null
}

const nodes: LabNode[] = []

async function waitForCertificates(timeoutMs = 15_000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (nodes.every((node) => node.engine?.certificate() !== null)) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(
    `AC not formed: ${nodes.map((node) => `${node.domainId}=${node.engine?.status().precommitCount ?? 0}`).join(',')}`,
  )
}

after(async () => {
  for (const node of nodes) {
    node.engine?.stop()
    await node.server.close()
    await rm(node.dataDir, { recursive: true, force: true })
  }
})

test('five local archives form one 4-of-5 lab AC; standby observes and does not sign', async () => {
  const roster = [
    ...ACTIVE.map((domainId) => ({ domainId, role: 'active' as const })),
    ...STANDBY.map((domainId) => ({ domainId, role: 'standby' as const })),
  ]
  for (const row of roster) {
    const dataDir = await mkdtemp(join(tmpdir(), `dle-bft-${row.domainId}-`))
    const store = openArchiveStore(dataDir)
    const box: LabNode = {
      domainId: row.domainId,
      role: row.role,
      dataDir,
      engine: null,
      server: await listenArchiveHttp({
        port: 0,
        store,
        identity: { domainId: row.domainId, role: row.role },
        facadeViews: () => box.engine?.facadeViews() ?? defaultFacadeViews(),
        extraGet(pathname) {
          if (pathname === '/bft/status' && box.engine !== null) return { ...box.engine.status() }
          return undefined
        },
        onPost(pathname, body) {
          if (pathname !== '/bft/message' || box.engine === null) return undefined
          const result = box.engine.ingest(body)
          return { status: result.ok ? 200 : 400, body: result }
        },
      }),
    }
    nodes.push(box)
  }
  for (const node of nodes) {
    node.engine = createArchiveBftEngine({
      domainId: node.domainId,
      role: node.role,
      store: openArchiveStore(node.dataDir),
      peers: nodes
        .filter((peer) => peer.domainId !== node.domainId)
        .map((peer) => ({
          domainId: peer.domainId,
          host: '127.0.0.1',
          port: peer.server.port,
          role: peer.role,
        })),
    })
  }
  await Promise.all(nodes.map((node) => node.engine?.start()))
  await waitForCertificates()
  const certificates = nodes.map((node) => node.engine?.certificate())
  const first = certificates[0]
  assert.equal(first !== null && first !== undefined, true)
  if (first === null || first === undefined) throw new Error('missing AC')
  assert.equal(first.quorum, 4)
  assert.equal(first.signers.length >= 4, true)
  assert.equal(first.signers.every((id) => ACTIVE.includes(id)), true)
  assert.equal(first.signers.some((id) => STANDBY.includes(id)), false)
  for (const certificate of certificates) {
    assert.equal(certificate?.valueHash, first.valueHash)
    assert.equal((certificate?.signers.length ?? 0) >= 4, true)
    assert.equal(certificate?.signers.every((id) => ACTIVE.includes(id)) ?? false, true)
    assert.equal(certificate?.signers.some((id) => STANDBY.includes(id)) ?? true, false)
  }
  for (const standby of nodes.filter((node) => node.role === 'standby')) {
    assert.equal(standby.engine?.status().voted, false)
  }
  const tip = await fetch(`http://127.0.0.1:${nodes[0]!.server.port}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
    signal: AbortSignal.timeout(4_000),
  })
  const body = (await tip.json()) as { result: string }
  assert.equal(body.result, '0x1')
})
