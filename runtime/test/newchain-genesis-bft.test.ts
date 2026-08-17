import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createArchiveBftEngine, type ArchiveBftEngine } from '../src/archive/bft/engine.js'
import { listenArchiveHttp, type ArchiveHttpServer } from '../src/archive/http.js'
import { defaultFacadeViews } from '../src/archive/jsonrpcFacade.js'
import { createNewChainEngine, type NewChainEngine } from '../src/archive/newchain/engine.js'
import { openArchiveStore } from '../src/archive/store.js'
import { DLE_LAB_CHAIN_NFT_ID } from '../src/shared/hashLookup.js'
import { labRouteTableFromPeers } from '../src/shared/labRoute.js'
import { keccak256Utf8 } from '../src/shared/bytes.js'
import { LAB_CLASS_TRADE, makeNewChainRequest } from '../src/shared/newchain.js'

const ACTIVE = ['fd-01', 'fd-02', 'fd-03', 'fd-04', 'fd-05']
const STANDBY = ['fd-06', 'fd-07']

interface LabNode {
  domainId: string
  role: 'active' | 'standby'
  dataDir: string
  server: ArchiveHttpServer
  newchain: NewChainEngine | null
  nft42: ArchiveBftEngine | null
}

const nodes: LabNode[] = []

async function waitForNewChainCertificates(chainNftId: string, timeoutMs = 15_000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const ready = nodes.every((node) => {
      const chains = node.newchain?.list().chains
      if (!Array.isArray(chains)) return false
      const row = chains.find((item) => {
        return typeof item === 'object' && item !== null && (item as { chainNftId?: string }).chainNftId === chainNftId
      }) as { archiveCertificate?: { schema?: string; signers?: string[] } } | undefined
      return row?.archiveCertificate?.schema === 'DleLabArchiveCertificateV1'
    })
    if (ready) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('new-chain AC not formed')
}

after(async () => {
  for (const node of nodes) {
    node.newchain?.stop()
    node.nft42?.stop()
    await node.server.close()
    await rm(node.dataDir, { recursive: true, force: true })
  }
})

test('five archives form a per-chain 4-of-5 AC that never writes NFT 42', async () => {
  const roster = [
    ...ACTIVE.map((domainId) => ({ domainId, role: 'active' as const })),
    ...STANDBY.map((domainId) => ({ domainId, role: 'standby' as const })),
  ]
  for (const row of roster) {
    const dataDir = await mkdtemp(join(tmpdir(), `dle-newchain-bft-${row.domainId}-`))
    const store = openArchiveStore(dataDir)
    const box: LabNode = {
      domainId: row.domainId,
      role: row.role,
      dataDir,
      newchain: null,
      nft42: null,
      server: await listenArchiveHttp({
        port: 0,
        store,
        identity: { domainId: row.domainId, role: row.role },
        facadeViews: () => box.nft42?.facadeViews() ?? defaultFacadeViews(),
        extraGet(pathname) {
          return box.newchain?.get(pathname)
        },
        extraHealth() {
          return box.newchain?.health() ?? {}
        },
        onPost(pathname, body) {
          if (pathname === '/bft/message') {
            return { status: 400, body: { ok: false, error: 'ERR_NFT42_BFT_DISABLED' } }
          }
          return box.newchain?.post(pathname, body)
        },
      }),
    }
    nodes.push(box)
  }
  for (const node of nodes) {
    const peers = nodes
      .filter((peer) => peer.domainId !== node.domainId)
      .map((peer) => ({
        domainId: peer.domainId,
        host: '127.0.0.1',
        port: peer.server.port,
        role: peer.role,
      }))
    const store = openArchiveStore(node.dataDir)
    const routeTable = labRouteTableFromPeers({ domainId: node.domainId, role: node.role }, peers)
    node.newchain = createNewChainEngine({
      domainId: node.domainId,
      role: node.role,
      store,
      routeTable,
      peers,
      enableBft: true,
    })
    node.nft42 = createArchiveBftEngine({
      domainId: node.domainId,
      role: node.role,
      store,
      peers,
    })
  }
  await Promise.all(nodes.map((node) => node.newchain?.start()))
  const request = makeNewChainRequest({
    classId: LAB_CLASS_TRADE,
    nonce: 9,
    salt: keccak256Utf8('dle.test.newchain.genesis-bft'),
  })
  const replies = await Promise.all(
    nodes.map(async (node) => {
      const response = await fetch(`http://127.0.0.1:${node.server.port}/newchain/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', connection: 'close' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(4_000),
      })
      return (await response.json()) as Record<string, unknown>
    }),
  )
  const first = replies[0]
  assert.equal(first?.ok, true)
  const chainNftId = String(first?.chainNftId)
  assert.notEqual(chainNftId, DLE_LAB_CHAIN_NFT_ID)
  assert.equal(first?.archiveCertificatePending, true)
  await waitForNewChainCertificates(chainNftId)
  for (const node of nodes) {
    const health = node.newchain?.health() ?? {}
    assert.equal(health.newchainArchiveCertified, 1)
    assert.equal(health.newchainArchivePending, 0)
    const chains = node.newchain?.list().chains as Array<{
      chainNftId: string
      archiveCertificate?: { schema: string; signers: string[]; valueHash: string }
    }>
    const row = chains.find((item) => item.chainNftId === chainNftId)
    assert.equal(row?.archiveCertificate?.schema, 'DleLabArchiveCertificateV1')
    assert.equal((row?.archiveCertificate?.signers.length ?? 0) >= 4, true)
    assert.equal(row?.archiveCertificate?.signers.every((id) => ACTIVE.includes(id)) ?? false, true)
    assert.equal(row?.archiveCertificate?.signers.some((id) => STANDBY.includes(id)) ?? true, false)
    assert.equal(node.nft42?.certificate(), null)
  }
  const second = makeNewChainRequest({
    classId: LAB_CLASS_TRADE,
    nonce: 10,
    salt: keccak256Utf8('dle.test.newchain.genesis-bft.second'),
  })
  const secondReplies = await Promise.all(
    nodes.map(async (node) => {
      const response = await fetch(`http://127.0.0.1:${node.server.port}/newchain/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', connection: 'close' },
        body: JSON.stringify(second),
        signal: AbortSignal.timeout(4_000),
      })
      return (await response.json()) as Record<string, unknown>
    }),
  )
  const secondNft = String(secondReplies[0]?.chainNftId)
  assert.notEqual(secondNft, chainNftId)
  assert.notEqual(secondNft, DLE_LAB_CHAIN_NFT_ID)
  await waitForNewChainCertificates(secondNft)
  for (const node of nodes) {
    const health = node.newchain?.health() ?? {}
    assert.equal(health.newchainArchiveCertified, 2)
    assert.equal(health.newchainArchivePending, 0)
  }
  const tip = await fetch(`http://127.0.0.1:${nodes[0]!.server.port}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
    signal: AbortSignal.timeout(4_000),
  })
  const body = (await tip.json()) as { result: string }
  assert.notEqual(body.result, '0x1')
})
