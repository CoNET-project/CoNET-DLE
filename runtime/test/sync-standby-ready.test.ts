import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { indexLabHashObject, labChainObjectLocator } from '../src/archive/hashPipe.js'
import { openArchiveStore, type ArchiveStore } from '../src/archive/store.js'
import {
  ARCHIVE_STANDBY_READINESS_TYPES,
  ERR_SYNC_STANDBY,
  ERR_SYNC_STANDBY_HMAC_CUTOVER,
  ERR_SYNC_STANDBY_ROLE,
  ERR_SYNC_STANDBY_ROOT,
  ERR_SYNC_STANDBY_SIG,
  archiveStandbyReadinessMessage,
  createSyncQualificationEngine,
  isExtraStandby,
  isOfficialStandbyRole,
  labSeatingAddress,
  makeArchiveStandbyReadiness,
  makeHmacStandbyReady,
  recoverArchiveStandbyReadiness,
  signArchiveStandbyReadiness,
  snapshotInventory,
  type SyncInventoryV1,
  type SyncPeer,
  type SyncQualificationEngine,
} from '../src/archive/syncQualification/index.js'
import { keccak256Utf8 } from '../src/shared/bytes.js'
import { DLE_LAB_GROUP_ID } from '../src/shared/hashLookup.js'
import { labRouteTableFromPeers } from '../src/shared/labRoute.js'

const dirs: string[] = []
const ACTIVES = ['a1', 'a2', 'a3', 'a4', 'a5'] as const

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempStore(): Promise<ArchiveStore> {
  const dir = await mkdtemp(join(tmpdir(), 'dle-standby-'))
  dirs.push(dir)
  return openArchiveStore(dir)
}

function h(label: string): string {
  return keccak256Utf8(`dle.lab.sync.test|${label}`)
}

function seedTwoChains(store: ArchiveStore): void {
  const rows = [
    { kind: 'ac' as const, nft: '42', height: '0x1', label: 'ac42' },
    { kind: 'tipStateRoot' as const, nft: '42', height: '0x1', label: 'tip42' },
    { kind: 'block' as const, nft: '42', height: '0x0', label: 'hist42' },
    { kind: 'ac' as const, nft: '99', height: '0x1', label: 'ac99' },
    { kind: 'daRootProof' as const, nft: '99', height: '0x1', label: 'da99' },
  ]
  for (const row of rows) {
    const hash = h(row.label)
    const put = indexLabHashObject(
      store.hash,
      labChainObjectLocator(row.kind, hash, row.nft, row.height, h('ac42'), DLE_LAB_GROUP_ID),
      { kind: row.kind, label: row.label, hash },
    )
    assert.equal(put.ok, true, row.label)
  }
}

function tableFor(domainId: string, peers: readonly SyncPeer[], role = 'active') {
  return labRouteTableFromPeers(
    { domainId, role },
    peers
      .filter((peer) => peer.domainId !== domainId)
      .map((peer) => ({
        domainId: peer.domainId,
        host: peer.domainId,
        port: 27101,
        role: peer.role,
      })),
    { ownGroupId: DLE_LAB_GROUP_ID, foreignChains: [{ chainNftId: '99', groupId: DLE_LAB_GROUP_ID }] },
  )
}

function roster(): SyncPeer[] {
  return [
    ...ACTIVES.map((domainId) => ({ domainId, role: 'active', url: `http://${domainId}:27101` })),
    { domainId: 'fd-06', role: 'standby', url: 'http://fd-06:27101' },
    { domainId: 'fd-07', role: 'standby', url: 'http://fd-07:27101' },
    { domainId: 'fd-08', role: 'standby', url: 'http://fd-08:27101' },
  ]
}

function inventoryOf(store: ArchiveStore, domainId: string): SyncInventoryV1 {
  return snapshotInventory({
    store: store.hash,
    table: tableFor(domainId, []),
    domainId,
    activeDomainIds: [...ACTIVES],
  })
}

function readyFrom(domainId: string, inventory: SyncInventoryV1, ready = true) {
  return makeArchiveStandbyReadiness({
    domainId,
    groupId: inventory.groupId,
    hostedChainSetRoot: inventory.hostedChainSetRoot,
    lastACRef: inventory.lastACRef,
    membershipRoot: inventory.membershipRoot,
    hashIndexRoot: inventory.hashIndexRoot,
    ready,
  })
}

function fakeFetch(nodes: Map<string, { engine: SyncQualificationEngine; store: ArchiveStore }>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const node = nodes.get(url.hostname)
    if (node === undefined) return new Response('missing', { status: 404 })
    if (url.pathname === '/sync/status') return Response.json(node.engine.status())
    if (url.pathname === '/sync/inventory') return Response.json(node.engine.inventory())
    if (url.pathname === '/sync/standby-ready') {
      return Response.json(node.engine.handleStandbyReady(JSON.parse(String(init?.body ?? '{}'))))
    }
    return new Response('no', { status: 404 })
  }) as typeof fetch
}

async function makeNode(
  domainId: string,
  peers: SyncPeer[],
  seed: boolean,
  fetchImpl: typeof fetch,
  role = 'active',
): Promise<{ engine: SyncQualificationEngine; store: ArchiveStore }> {
  const store = await tempStore()
  if (seed) seedTwoChains(store)
  const engine = createSyncQualificationEngine({
    domainId,
    role,
    peers: peers.filter((peer) => peer.domainId !== domainId),
    store,
    table: tableFor(domainId, peers, role),
    fetchImpl,
    tickMs: 10_000,
  })
  return { engine, store }
}

test('ArchiveStandbyReadiness typed data uses string groupId and recovers the seating key', () => {
  assert.equal(
    ARCHIVE_STANDBY_READINESS_TYPES.ArchiveStandbyReadiness.some((field) => field.name === 'groupId' && field.type === 'string'),
    true,
  )
  assert.equal(isOfficialStandbyRole('fd-06', 'standby'), true)
  assert.equal(isOfficialStandbyRole('fd-08', 'standby'), false)
  assert.equal(isExtraStandby('fd-08-hosthatch-hk1'), true)
  const message = archiveStandbyReadinessMessage({
    groupId: DLE_LAB_GROUP_ID,
    hostedChainSetRoot: h('hosted'),
    lastACRef: h('ac'),
    membershipRoot: h('members'),
    hashIndexRoot: h('index'),
    ready: true,
  })
  const signature = signArchiveStandbyReadiness('fd-06', message)
  assert.equal(recoverArchiveStandbyReadiness(message, signature), labSeatingAddress('fd-06'))
})

test('official standbys count; extra fd-08 is ingest-only; HMAC / tamper / root / role fail', async () => {
  const peers = roster()
  const { engine, store } = await makeNode('a1', peers, true, fetch)
  const inventory = inventoryOf(store, 'a1')
  assert.equal(engine.handleStandbyReady({}).ok, false)
  assert.equal(engine.handleStandbyReady({}).error, ERR_SYNC_STANDBY)
  const hmac = makeHmacStandbyReady({
    domainId: 'fd-06',
    groupId: inventory.groupId,
    hostedChainSetRoot: inventory.hostedChainSetRoot,
    lastACRef: inventory.lastACRef,
    membershipRoot: inventory.membershipRoot,
    hashIndexRoot: inventory.hashIndexRoot,
    ready: true,
  })
  assert.equal(engine.handleStandbyReady(hmac).error, ERR_SYNC_STANDBY_HMAC_CUTOVER)
  const tampered = readyFrom('fd-06', inventory)
  tampered.signature = (`${tampered.signature.slice(0, -2)}11`) as typeof tampered.signature
  assert.equal(engine.handleStandbyReady(tampered).error, ERR_SYNC_STANDBY_SIG)
  const wrongRoot = readyFrom('fd-06', { ...inventory, hashIndexRoot: h('wrong-index') })
  assert.equal(engine.handleStandbyReady(wrongRoot).error, ERR_SYNC_STANDBY_ROOT)
  const activeRole = readyFrom('a2', inventory)
  assert.equal(engine.handleStandbyReady(activeRole).error, ERR_SYNC_STANDBY_ROLE)
  assert.equal(engine.handleStandbyReady(readyFrom('fd-06', inventory)).ok, true)
  assert.equal(engine.officialStandbyReadyCount(), 1)
  assert.equal(engine.officialStandbysReady(), false)
  assert.equal(engine.handleStandbyReady(readyFrom('fd-07', inventory)).ok, true)
  assert.equal(engine.handleStandbyReady(readyFrom('fd-08', inventory)).ok, true)
  assert.equal(engine.officialStandbyReadyCount(), 2)
  assert.equal(engine.officialStandbysReady(), true)
  const health = engine.health().syncQualification as Record<string, unknown>
  assert.equal(health.standbyReadyEip712, true)
  assert.equal(health.officialStandbyReadyCount, 2)
  assert.equal(health.officialStandbysReady, true)
  assert.equal(health.extraStandbyReadyDoesNotCount, true)
  engine.stop()
})

test('standby-ready persists across reload and REJECTED reset keeps the map', async () => {
  const peers = roster()
  const first = await makeNode('a1', peers, true, fetch)
  const inventory = inventoryOf(first.store, 'a1')
  assert.equal(first.engine.handleStandbyReady(readyFrom('fd-06', inventory)).ok, true)
  first.engine.stop()
  const reloaded = createSyncQualificationEngine({
    domainId: 'a1',
    role: 'active',
    peers: peers.filter((peer) => peer.domainId !== 'a1'),
    store: first.store,
    table: tableFor('a1', peers),
    fetchImpl: fetch,
    tickMs: 10_000,
  })
  assert.equal(reloaded.officialStandbyReadyCount(), 1)
  reloaded.stop()
  first.store.persistSyncQualificationState({
    schema: 'DleLabSyncQualificationStateV1',
    phase: 'REJECTED',
    nonce: 1,
    rejectReason: 'ERR_SYNC_TEST',
    certificate: null,
    pendingChallenge: null,
    pendingFreeze: null,
    holdClaimed: false,
    standbyReady: { 'fd-06': readyFrom('fd-06', inventory) },
  })
  const afterReject = createSyncQualificationEngine({
    domainId: 'a1',
    role: 'active',
    peers: peers.filter((peer) => peer.domainId !== 'a1'),
    store: first.store,
    table: tableFor('a1', peers),
    fetchImpl: fetch,
    tickMs: 10_000,
  })
  assert.equal(afterReject.phase(), 'SYNCING')
  assert.equal(afterReject.officialStandbyReadyCount(), 1)
  afterReject.stop()
})

test('official standby auto-signs after QUALIFIED and gossips; extra fd-08 does not', async () => {
  const peers = roster()
  const nodes = new Map<string, { engine: SyncQualificationEngine; store: ArchiveStore }>()
  const fetchImpl = fakeFetch(nodes)
  const receiver = await makeNode('a1', peers, true, fetchImpl)
  const official = await makeNode('fd-06', peers, true, fetchImpl, 'standby')
  const extra = await makeNode('fd-08', peers, true, fetchImpl, 'standby')
  nodes.set('a1', receiver)
  nodes.set('fd-06', official)
  nodes.set('fd-08', extra)
  official.store.persistSyncQualificationState({
    schema: 'DleLabSyncQualificationStateV1',
    phase: 'SYNCING',
    nonce: 0,
    rejectReason: null,
    certificate: { candidate: 'fd-06' },
    pendingChallenge: null,
    pendingFreeze: null,
    holdClaimed: false,
  })
  extra.store.persistSyncQualificationState({
    schema: 'DleLabSyncQualificationStateV1',
    phase: 'SYNCING',
    nonce: 0,
    rejectReason: null,
    certificate: { candidate: 'fd-08' },
    pendingChallenge: null,
    pendingFreeze: null,
    holdClaimed: false,
  })
  const officialRestored = createSyncQualificationEngine({
    domainId: 'fd-06',
    role: 'standby',
    peers: peers.filter((peer) => peer.domainId !== 'fd-06'),
    store: official.store,
    table: tableFor('fd-06', peers, 'standby'),
    fetchImpl,
    tickMs: 10_000,
  })
  const extraRestored = createSyncQualificationEngine({
    domainId: 'fd-08',
    role: 'standby',
    peers: peers.filter((peer) => peer.domainId !== 'fd-08'),
    store: extra.store,
    table: tableFor('fd-08', peers, 'standby'),
    fetchImpl,
    tickMs: 10_000,
  })
  nodes.set('fd-06', { engine: officialRestored, store: official.store })
  nodes.set('fd-08', { engine: extraRestored, store: extra.store })
  await officialRestored.tick()
  await extraRestored.tick()
  assert.equal(officialRestored.phase(), 'QUALIFIED')
  assert.equal(officialRestored.officialStandbyReadyCount(), 1)
  assert.equal(receiver.engine.officialStandbyReadyCount(), 1)
  assert.equal(extraRestored.phase(), 'QUALIFIED')
  assert.equal(extraRestored.officialStandbyReadyCount(), 1)
  assert.equal(receiver.engine.officialStandbysReady(), false)
  official.engine.stop()
  extra.engine.stop()
  officialRestored.stop()
  extraRestored.stop()
  receiver.engine.stop()
})

test('official standby with a matching local envelope still fan-outs to peers', async () => {
  const peers = roster()
  const nodes = new Map<string, { engine: SyncQualificationEngine; store: ArchiveStore }>()
  const fetchImpl = fakeFetch(nodes)
  const receiver = await makeNode('a1', peers, true, fetchImpl)
  const official = await makeNode('fd-06', peers, true, fetchImpl, 'standby')
  const inventory = inventoryOf(official.store, 'fd-06')
  official.store.persistSyncQualificationState({
    schema: 'DleLabSyncQualificationStateV1',
    phase: 'QUALIFIED',
    nonce: 0,
    rejectReason: null,
    certificate: { candidate: 'fd-06' },
    pendingChallenge: null,
    pendingFreeze: null,
    holdClaimed: false,
    standbyReady: { 'fd-06': readyFrom('fd-06', inventory) },
  })
  const restored = createSyncQualificationEngine({
    domainId: 'fd-06',
    role: 'standby',
    peers: peers.filter((peer) => peer.domainId !== 'fd-06'),
    store: official.store,
    table: tableFor('fd-06', peers, 'standby'),
    fetchImpl,
    tickMs: 10_000,
  })
  nodes.set('a1', receiver)
  nodes.set('fd-06', { engine: restored, store: official.store })
  assert.equal(restored.phase(), 'QUALIFIED')
  assert.equal(restored.officialStandbyReadyCount(), 1)
  assert.equal(receiver.engine.officialStandbyReadyCount(), 0)
  await restored.tick()
  assert.equal(receiver.engine.officialStandbyReadyCount(), 1)
  assert.equal(receiver.engine.officialStandbysReady(), false)
  official.engine.stop()
  restored.stop()
  receiver.engine.stop()
})
