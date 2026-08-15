import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { listenArchiveHttp, type ArchiveHttpServer } from '../src/archive/http.js'
import { createOnDemandEngine, type OnDemandEngine } from '../src/archive/ondemand/engine.js'
import { openArchiveStore } from '../src/archive/store.js'
import { sameHexList, type SelectionLog } from '../src/shared/ondemand/index.js'

const ACTIVE = ['fd-01', 'fd-02', 'fd-03', 'fd-04', 'fd-05']
const STANDBY = ['fd-06', 'fd-07']

interface LabNode {
  domainId: string
  role: 'active' | 'standby'
  dataDir: string
  server: ArchiveHttpServer
  engine: OnDemandEngine | null
}

const nodes: LabNode[] = []

async function waitForEndorsed(timeoutMs = 15_000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (
      nodes.every((node) => {
        const view = node.engine?.selection()
        return view !== undefined && view.available === true && view.endorsed === true
      })
    ) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(
    `selection not endorsed: ${nodes
      .map((node) => `${node.domainId}=${node.engine?.health().ondemandAttestCount ?? 0}`)
      .join(',')}`,
  )
}

after(async () => {
  for (const node of nodes) {
    node.engine?.stop()
    await node.server.close()
    await rm(node.dataDir, { recursive: true, force: true })
  }
})

test('five local archives endorse one 7+2 SelectionLog; standby observes and does not attest', async () => {
  const roster = [
    ...ACTIVE.map((domainId) => ({ domainId, role: 'active' as const })),
    ...STANDBY.map((domainId) => ({ domainId, role: 'standby' as const })),
  ]
  for (const row of roster) {
    const dataDir = await mkdtemp(join(tmpdir(), `dle-ondemand-${row.domainId}-`))
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
        extraHealth: () => box.engine?.health() ?? {},
        extraGet: (pathname) => box.engine?.get(pathname),
        onPost: (pathname, body) => box.engine?.post(pathname, body),
      }),
    }
    nodes.push(box)
  }
  for (const node of nodes) {
    node.engine = createOnDemandEngine({
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
      autoSeedLabMiners: true,
      autoFreeze: true,
    })
    await node.engine.start()
  }
  await waitForEndorsed()
  const first = nodes[0]!.engine!.selection()
  assert.equal(first.available, true)
  if (first.available !== true) throw new Error('expected selection')
  const log = first as SelectionLog
  assert.equal(log.endorsed, true)
  assert.equal(log.committee.length, 7)
  assert.equal(log.standbys.length, 2)
  assert.equal(log.attestors.length >= 4, true)
  assert.equal(log.attestors.every((id) => ACTIVE.includes(id)), true)
  assert.equal(log.attestors.some((id) => STANDBY.includes(id)), false)
  for (const node of nodes) {
    const view = node.engine!.selection()
    assert.equal(view.available, true)
    if (view.available !== true) continue
    assert.equal(view.poolRoot, log.poolRoot)
    assert.equal(view.roulette, log.roulette)
    assert.equal(sameHexList(view.committee, log.committee), true)
    assert.equal(sameHexList(view.standbys, log.standbys), true)
    assert.equal(view.endorsed, true)
  }
})
