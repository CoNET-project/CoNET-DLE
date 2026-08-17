import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { indexLabHashObject, labChainObjectLocator } from '../src/archive/hashPipe.js'
import { getObjectLocal } from '../src/archive/hop1.js'
import { openArchiveStore, type ArchiveStore } from '../src/archive/store.js'
import {
  answerChallengeLocal,
  attestLabChallenge,
  bindChallengeBeacon,
  buildCertificate,
  buildChallenge,
  buildStratifiedSamples,
  challengeCoversLiveOpening,
  challengeSeedOf,
  createSyncQualificationEngine,
  ERR_SYNC_CHALLENGE_HMAC_CUTOVER,
  ERR_SYNC_CHALLENGE_SAMPLES,
  ERR_SYNC_CHALLENGE_SIG,
  freezeChallengeRoots,
  gradeChallenge,
  hostedChainSetRootOf,
  isForbiddenElRpcAsCl,
  isHmacChallenge,
  isSyncChallengerMissingReason,
  labCgOpeningView,
  labHonestWaitReveal,
  labSyncBeacon,
  labSyncBeaconAfterFreeze,
  LAB_SYNC_MAX_HOSTED_CHAINS,
  LAB_SYNC_OPEN_ALL_HOSTED_CHAINS,
  isHmacSeatingVote,
  labSeatingAddress,
  makeHmacSyncVote,
  makeSyncVote,
  probeFinalizedClRandomness,
  probeProductionCg,
  productionCgHealthView,
  productionCgOpeningSmoke,
  recoverArchiveStateChallenge,
  recoverSyncVoteSigner,
  snapshotInventory,
  verifyEip712Challenge,
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
  const dir = await mkdtemp(join(tmpdir(), 'dle-sync-'))
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

function inventoryOf(store: ArchiveStore, domainId: string) {
  return snapshotInventory({
    store: store.hash,
    table: tableFor(domainId, []),
    domainId,
    activeDomainIds: [...ACTIVES],
  })
}

function voteFromInventory(
  domainId: string,
  candidate: string,
  challengeHash: ReturnType<typeof h>,
  accept: boolean,
  inventory: SyncInventoryV1,
) {
  return makeSyncVote({
    domainId,
    candidate,
    challengeHash,
    accept,
    groupId: inventory.groupId,
    hostedChainSetRoot: inventory.hostedChainSetRoot,
    lastACRef: inventory.lastACRef,
    membershipRoot: inventory.membershipRoot,
    hashIndexRoot: inventory.hashIndexRoot,
  })
}

test('stratified samples cover every hosted chain, history, DA, and a hashIndex leaf', () => {
  const locators = [
    labChainObjectLocator('ac', h('ac42'), '42', '0x1', h('ac42'), DLE_LAB_GROUP_ID),
    labChainObjectLocator('block', h('hist42'), '42', '0x0', h('ac42'), DLE_LAB_GROUP_ID),
    labChainObjectLocator('ac', h('ac99'), '99', '0x1', h('ac99'), DLE_LAB_GROUP_ID),
    labChainObjectLocator('daRootProof', h('da99'), '99', '0x1', h('ac99'), DLE_LAB_GROUP_ID),
  ]
  const samples = buildStratifiedSamples(locators, ['42', '99'], h('seed'))
  const nfts = new Set(samples.filter((sample) => sample.kind !== 'hashIndex').map((sample) => sample.chainNftId))
  assert.equal(nfts.has('42'), true)
  assert.equal(nfts.has('99'), true)
  assert.equal(
    samples.some((sample) => sample.chainNftId === '42' && (sample.kind === 'ac' || sample.kind === 'tipStateRoot')),
    true,
  )
  assert.equal(samples.some((sample) => sample.chainNftId === '42' && sample.height === '0x0'), true)
  assert.equal(samples.some((sample) => sample.kind === 'daRootProof'), true)
  assert.equal(samples.some((sample) => sample.kind === 'hashIndex'), true)
})

test('lab stratified samples open every hosted chain, not an 8-chain cap', () => {
  assert.equal(LAB_SYNC_OPEN_ALL_HOSTED_CHAINS, true)
  assert.equal(LAB_SYNC_MAX_HOSTED_CHAINS <= 0, true)
  const locators = []
  const nfts: string[] = ['42']
  locators.push(labChainObjectLocator('ac', h('ac42'), '42', '0x1', h('ac42'), DLE_LAB_GROUP_ID))
  for (let i = 0; i < 40; i += 1) {
    const nft = String(1000 + i)
    nfts.push(nft)
    locators.push(labChainObjectLocator('ac', h(`ac${nft}`), nft, '0x1', h(`ac${nft}`), DLE_LAB_GROUP_ID))
  }
  const seed = h('open-all-seed')
  const samples = buildStratifiedSamples(locators, nfts, seed)
  const hosted = new Set(samples.filter((sample) => sample.kind !== 'hashIndex').map((sample) => sample.chainNftId))
  assert.equal(hosted.has('42'), true)
  assert.equal(hosted.size, 41)
  assert.equal(samples.some((sample) => sample.kind === 'hashIndex'), true)
  const view = labCgOpeningView({ chainNftIds: nfts, locators }, seed)
  assert.equal(view.hostedChainCount, 41)
  assert.equal(view.openedChainCount, 41)
  assert.equal(view.openedAllHostedChains, true)
})

test('lab opening still covers two hundred hosted chains after grouping', () => {
  const locators = []
  const nfts: string[] = []
  for (let i = 0; i < 200; i += 1) {
    const nft = String(2000 + i)
    nfts.push(nft)
    locators.push(labChainObjectLocator('ac', h(`ac${nft}`), nft, '0x1', h(`ac${nft}`), DLE_LAB_GROUP_ID))
    locators.push(labChainObjectLocator('block', h(`hist${nft}`), nft, '0x0', h(`ac${nft}`), DLE_LAB_GROUP_ID))
  }
  const view = labCgOpeningView({ chainNftIds: nfts, locators }, h('group-200'))
  assert.equal(view.hostedChainCount, 200)
  assert.equal(view.openedChainCount, 200)
  assert.equal(view.openedAllHostedChains, true)
  assert.equal(view.sampleCount >= 201, true)
})

test('challenge records opened===hosted and rejects a persisted 8-cap shape', async () => {
  const store = await tempStore()
  seedTwoChains(store)
  const inventory = inventoryOf(store, 'a1')
  const challenge = buildChallenge({
    inventory,
    candidate: 'joiner',
    challenger: 'a1',
    nonce: 1,
  })
  assert.equal(challenge.openedAllHostedChains, true)
  assert.equal(challenge.hostedChainCount, inventory.chainNftIds.length)
  assert.equal(challenge.openedChainCount, inventory.chainNftIds.length)
  assert.equal(challengeCoversLiveOpening(challenge, inventory), true)
  const legacyCap = { ...challenge, openedAllHostedChains: undefined, hostedChainCount: 8, openedChainCount: 8 }
  assert.equal(challengeCoversLiveOpening(legacyCap, inventory), false)
  const staleCount = { ...challenge, hostedChainCount: (challenge.hostedChainCount ?? 0) + 1 }
  assert.equal(challengeCoversLiveOpening(staleCount, inventory), false)
})

test('AC sample matches on commitment when signer sets differ', async () => {
  const store = await tempStore()
  const valueHash = h('ac-commit')
  const membershipRoot = h('members')
  const tip = h('tip')
  const locator = labChainObjectLocator('ac', valueHash, '103070659', '0x1', valueHash, DLE_LAB_GROUP_ID)
  assert.equal(
    indexLabHashObject(store.hash, locator, {
      schema: 'DleLabArchiveCertificateV1',
      certificate: {
        valueHash,
        membershipRoot,
        tipStateRoot: tip,
        signers: ['a1', 'a2', 'a3', 'a4'],
      },
    }).ok,
    true,
  )
  const inventory = inventoryOf(store, 'a1')
  const challenge = buildChallenge({
    inventory,
    candidate: 'joiner',
    challenger: 'a1',
    nonce: 1,
  })
  const honest = answerChallengeLocal(store.hash, inventory, challenge)
  const mutated = {
    ...honest,
    objects: honest.objects.map((row) => {
      if (!row || typeof row !== 'object' || !('certificate' in row)) return row
      const cert = (row as { certificate: Record<string, unknown> }).certificate
      return {
        ...row,
        certificate: { ...cert, signers: ['a1', 'a2', 'a4', 'a5'] },
      }
    }),
  }
  assert.equal(gradeChallenge({ challenge, answer: mutated, expected: inventory, store: store.hash }).ok, true)
  const otherValue = {
    ...honest,
    objects: honest.objects.map((row) => {
      if (!row || typeof row !== 'object' || !('certificate' in row)) return row
      const cert = (row as { certificate: Record<string, unknown> }).certificate
      return {
        ...row,
        certificate: { ...cert, valueHash: h('other-ac') },
      }
    }),
  }
  const otherGrade = gradeChallenge({ challenge, answer: otherValue, expected: inventory, store: store.hash })
  assert.equal(otherGrade.ok, false)
})

test('genesis stub ACs match on valueHash when domainId and acceptedAt differ', async () => {
  const store = await tempStore()
  const valueHash = h('genesis-value')
  const tip = h('genesis-tip')
  const body = h('genesis-body')
  const locator = labChainObjectLocator('ac', valueHash, '105735037', '0x1', valueHash, DLE_LAB_GROUP_ID)
  assert.equal(
    indexLabHashObject(store.hash, locator, {
      schema: 'DleLabGenesisCertificateV1',
      labOnly: true,
      notArchiveCertificate: true,
      valueHash,
      tipStateRoot: tip,
      bodyCommitment: body,
      domainId: 'fd-01-ionos-45',
      acceptedAt: '2026-08-16T00:00:00.000Z',
    }).ok,
    true,
  )
  const inventory = inventoryOf(store, 'a1')
  const challenge = buildChallenge({
    inventory,
    candidate: 'joiner',
    challenger: 'a1',
    nonce: 1,
  })
  const honest = answerChallengeLocal(store.hash, inventory, challenge)
  const mutated = {
    ...honest,
    objects: honest.objects.map((row) => {
      if (!row || typeof row !== 'object' || !('valueHash' in row)) return row
      return {
        ...(row as Record<string, unknown>),
        domainId: 'fd-02-ionos-189',
        acceptedAt: '2026-08-16T00:00:01.000Z',
      }
    }),
  }
  assert.equal(gradeChallenge({ challenge, answer: mutated, expected: inventory, store: store.hash }).ok, true)
})

test('AC sample grades against tip when the freezer has not stored PrecommitQC yet', async () => {
  const store = await tempStore()
  const valueHash = h('pending-ac')
  const tip = h('pending-tip')
  const acLocator = labChainObjectLocator('ac', valueHash, '510797093', '0x1', valueHash, DLE_LAB_GROUP_ID)
  const tipLocator = labChainObjectLocator('tipStateRoot', tip, '510797093', '0x1', valueHash, DLE_LAB_GROUP_ID)
  assert.equal(store.hash.putLocator(acLocator).ok, true)
  assert.equal(
    indexLabHashObject(store.hash, tipLocator, {
      kind: 'tipStateRoot',
      tipStateRoot: tip,
      chainNftId: '510797093',
      height: '0x1',
    }).ok,
    true,
  )
  const inventory = inventoryOf(store, 'a1')
  const challenge = buildChallenge({
    inventory,
    candidate: 'joiner',
    challenger: 'a1',
    nonce: 1,
  })
  const honest = answerChallengeLocal(store.hash, inventory, challenge)
  assert.equal(
    honest.objects.some((row) => row !== null && typeof row === 'object' && 'tipStateRoot' in row),
    true,
  )
  assert.equal(gradeChallenge({ challenge, answer: honest, expected: inventory, store: store.hash }).ok, true)
  const withAc = {
    ...honest,
    objects: honest.objects.map((row) => {
      if (!row || typeof row !== 'object' || !('tipStateRoot' in row)) return row
      return {
        schema: 'DleLabGenesisCertificateV1',
        valueHash,
        tipStateRoot: tip,
        domainId: 'fd-04-hosthatch-tokyo1',
      }
    }),
  }
  assert.equal(gradeChallenge({ challenge, answer: withAc, expected: inventory, store: store.hash }).ok, true)
})

test('AC sample fails when challenger holds an AC and candidate answers only the tip', async () => {
  const store = await tempStore()
  const valueHash = h('p8b-ac')
  const tip = h('p8b-tip')
  const locator = labChainObjectLocator('ac', valueHash, '610797093', '0x1', valueHash, DLE_LAB_GROUP_ID)
  assert.equal(
    indexLabHashObject(store.hash, locator, {
      schema: 'DleLabArchiveCertificateV1',
      certificate: {
        valueHash,
        membershipRoot: h('p8b-members'),
        tipStateRoot: tip,
        bodyCommitment: h('p8b-body'),
        signers: ['a1', 'a2', 'a3', 'a4'],
      },
    }).ok,
    true,
  )
  const inventory = inventoryOf(store, 'a1')
  const challenge = buildChallenge({
    inventory,
    candidate: 'joiner',
    challenger: 'a1',
    nonce: 1,
  })
  const honest = answerChallengeLocal(store.hash, inventory, challenge)
  const tipOnly = {
    ...honest,
    objects: honest.objects.map((row) => {
      if (!row || typeof row !== 'object') return row
      const rec = row as Record<string, unknown>
      if (rec.schema === 'DleLabArchiveCertificateV1' || rec.certificate !== undefined) {
        return { kind: 'tipStateRoot', tipStateRoot: tip }
      }
      return row
    }),
  }
  const grade = gradeChallenge({ challenge, answer: tipOnly, expected: inventory, store: store.hash })
  assert.equal(grade.ok, false)
})

test('health does not rebuild pendingChallenge when inventory roots drift', async () => {
  const store = await tempStore()
  seedTwoChains(store)
  const engine = createSyncQualificationEngine({
    domainId: 'a1',
    role: 'active',
    peers: [],
    store,
    table: tableFor('a1', []),
    tickMs: 10_000,
  })
  await engine.tick()
  assert.equal(engine.phase(), 'CLAIMED_SYNC')
  const first = engine.status()
  const healthBefore = engine.health()
  const qBefore = healthBefore.syncQualification as { nonce: number; pendingChallenge?: unknown }
  assert.equal(qBefore.nonce, first.nonce)
  assert.equal('pendingChallenge' in qBefore, false)
  const extra = h('p8c-drift')
  assert.equal(
    indexLabHashObject(
      store.hash,
      labChainObjectLocator('block', extra, '42', '0x2', h('ac42'), DLE_LAB_GROUP_ID),
      { kind: 'block', label: 'p8c-drift', hash: extra },
    ).ok,
    true,
  )
  const healthAfter = engine.health()
  const qAfter = healthAfter.syncQualification as { nonce: number; leafCount: number }
  assert.equal(qAfter.nonce, first.nonce)
  assert.equal('pendingChallenge' in qAfter, false)
  assert.equal(qAfter.leafCount > first.leafCount, true)
  const rebuilt = engine.status()
  assert.notEqual(rebuilt.nonce, first.nonce)
  assert.equal(rebuilt.pendingChallenge !== null, true)
  assert.notEqual(rebuilt.pendingChallenge?.seed, first.pendingChallenge?.seed)
})

test('root mismatch and hop-during-challenge fail the grade', async () => {
  const store = await tempStore()
  seedTwoChains(store)
  const inventory = inventoryOf(store, 'a1')
  const challenge = buildChallenge({
    inventory,
    candidate: 'joiner',
    challenger: 'a1',
    nonce: 1,
  })
  const honest = answerChallengeLocal(store.hash, inventory, challenge)
  assert.equal(gradeChallenge({ challenge, answer: honest, expected: inventory, store: store.hash }).ok, true)
  const hopped = { ...honest, hopUsed: true, localOnly: true as const }
  const hopGrade = gradeChallenge({ challenge, answer: hopped, expected: inventory, store: store.hash })
  assert.equal(hopGrade.ok, false)
  if (!hopGrade.ok) assert.equal(hopGrade.reason, 'ERR_SYNC_HOP_DURING_CHALLENGE')
  const wrong = { ...honest, lastACRef: h('wrong-root') }
  const rootGrade = gradeChallenge({ challenge, answer: wrong, expected: inventory, store: store.hash })
  assert.equal(rootGrade.ok, false)
  if (!rootGrade.ok) assert.equal(rootGrade.reason, 'ERR_SYNC_ROOT_MISMATCH')
})

test('four EIP-712 accept votes issue a certificate; three do not', async () => {
  const store = await tempStore()
  seedTwoChains(store)
  const inventory = inventoryOf(store, 'joiner')
  const challengeHash = h('challenge')
  const votes = ['a1', 'a2', 'a3'].map((domainId) =>
    voteFromInventory(domainId, 'joiner', challengeHash, true, inventory),
  )
  const short = buildCertificate({
    groupId: inventory.groupId,
    candidate: 'joiner',
    challengeHash,
    hostedChainSetRoot: inventory.hostedChainSetRoot,
    lastACRef: inventory.lastACRef,
    membershipRoot: inventory.membershipRoot,
    hashIndexRoot: inventory.hashIndexRoot,
    votes,
    activeDomainIds: [...ACTIVES],
  })
  assert.equal('ok' in short && short.ok === false, true)
  votes.push(voteFromInventory('a4', 'joiner', challengeHash, true, inventory))
  const cert = buildCertificate({
    groupId: inventory.groupId,
    candidate: 'joiner',
    challengeHash,
    hostedChainSetRoot: inventory.hostedChainSetRoot,
    lastACRef: inventory.lastACRef,
    membershipRoot: inventory.membershipRoot,
    hashIndexRoot: inventory.hashIndexRoot,
    votes,
    activeDomainIds: [...ACTIVES],
  })
  assert.equal('schema' in cert && cert.schema === 'ArchiveSyncQualificationCertificateV1', true)
  if ('schema' in cert) {
    assert.equal(cert.eip712, true)
    assert.equal(cert.hmacForgeable, false)
    assert.equal(cert.notL1Settled, true)
    assert.equal(cert.votes.length, 4)
    assert.equal(recoverSyncVoteSigner(cert.votes[0]!), cert.votes[0]!.signer)
    assert.equal(cert.votes[0]!.signer, labSeatingAddress('a1'))
  }
})

function fakeFetch(nodes: Map<string, { engine: SyncQualificationEngine; store: ArchiveStore }>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const node = nodes.get(url.hostname)
    if (node === undefined) return new Response('missing', { status: 404 })
    if (url.pathname === '/sync/status') return Response.json(node.engine.status())
    if (url.pathname === '/sync/inventory') return Response.json(node.engine.inventory())
    if (url.pathname === '/sync/challenge') {
      return Response.json(node.engine.handleChallenge(JSON.parse(String(init?.body ?? '{}'))))
    }
    if (url.pathname === '/sync/vote') {
      return Response.json(node.engine.handleVote(JSON.parse(String(init?.body ?? '{}'))))
    }
    if (url.pathname === '/sync/reject') {
      return Response.json(node.engine.handleReject(JSON.parse(String(init?.body ?? '{}'))))
    }
    if (url.pathname === '/sync/standby-ready') {
      return Response.json(node.engine.handleStandbyReady(JSON.parse(String(init?.body ?? '{}'))))
    }
    if (url.pathname === '/rpc') {
      const rpc = JSON.parse(String(init?.body ?? '{}')) as { method?: string; params?: string[] }
      const object = getObjectLocal(node.store.hash, rpc.params?.[0] ?? '', rpc.params?.[1] ?? '')
      return Response.json({ jsonrpc: '2.0', id: 1, result: object })
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

async function tickAll(
  nodes: Map<string, { engine: SyncQualificationEngine; store: ArchiveStore }>,
  rounds = 8,
): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    for (const node of nodes.values()) await node.engine.tick()
  }
}

test('local correct answer plus 4/5 EIP-712 votes reaches QUALIFIED', async () => {
  const peers: SyncPeer[] = ACTIVES.map((domainId) => ({
    domainId,
    role: 'active',
    url: `http://${domainId}:27101`,
  }))
  const nodes = new Map<string, { engine: SyncQualificationEngine; store: ArchiveStore }>()
  const fetchImpl = fakeFetch(nodes)
  for (const domainId of ACTIVES) {
    nodes.set(domainId, await makeNode(domainId, peers, true, fetchImpl))
  }
  await tickAll(nodes)
  const qualified = [...nodes.values()].filter((node) => node.engine.phase() === 'QUALIFIED')
  assert.equal(qualified.length >= 4, true)
  assert.equal(qualified[0]?.engine.seatingQualified(), true)
})

test('empty joiner catch-up then qualifies; tip-only joiner is rejected', async () => {
  const peers: SyncPeer[] = [...ACTIVES, 'joiner', 'tiponly'].map((domainId) => ({
    domainId,
    role: 'active',
    url: `http://${domainId}:27101`,
  }))
  const nodes = new Map<string, { engine: SyncQualificationEngine; store: ArchiveStore }>()
  const fetchImpl = fakeFetch(nodes)
  for (const domainId of ACTIVES) {
    nodes.set(domainId, await makeNode(domainId, peers, true, fetchImpl))
  }
  nodes.set('joiner', await makeNode('joiner', peers, false, fetchImpl))
  const tip = await makeNode('tiponly', peers, false, fetchImpl)
  const tipHash = h('ac42')
  assert.equal(
    indexLabHashObject(
      tip.store.hash,
      labChainObjectLocator('ac', tipHash, '42', '0x1', tipHash, DLE_LAB_GROUP_ID),
      { kind: 'ac', label: 'ac42', hash: tipHash },
    ).ok,
    true,
  )
  nodes.set('tiponly', tip)
  for (let i = 0; i < 8; i += 1) {
    for (const domainId of [...ACTIVES, 'joiner']) {
      await nodes.get(domainId)?.engine.tick()
    }
  }
  assert.equal(nodes.get('joiner')?.engine.phase(), 'QUALIFIED')
  assert.equal(tip.engine.claimSync(), true)
  for (let i = 0; i < 3; i += 1) {
    for (const domainId of ACTIVES) await nodes.get(domainId)?.engine.tick()
  }
  assert.equal(nodes.get('tiponly')?.engine.phase(), 'REJECTED')
})

test('catch-up ignores a richer foreign-group inventory', async () => {
  const peers: SyncPeer[] = [...ACTIVES, 'joiner', 'foreign'].map((domainId) => ({
    domainId,
    role: 'active',
    url: `http://${domainId}:27101`,
  }))
  const nodes = new Map<string, { engine: SyncQualificationEngine; store: ArchiveStore }>()
  const fetchImpl = fakeFetch(nodes)
  for (const domainId of ACTIVES) {
    nodes.set(domainId, await makeNode(domainId, peers, true, fetchImpl))
  }
  nodes.set('joiner', await makeNode('joiner', peers, false, fetchImpl))
  const foreign = await makeNode('foreign', peers, true, fetchImpl)
  const originalInventory = foreign.engine.inventory.bind(foreign.engine)
  const originalStatus = foreign.engine.status.bind(foreign.engine)
  foreign.engine.inventory = () => ({
    ...originalInventory(),
    groupId: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    leafCount: 99_999,
  })
  foreign.engine.status = () => ({
    ...originalStatus(),
    groupId: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    leafCount: 99_999,
  })
  nodes.set('foreign', foreign)
  for (let i = 0; i < 8; i += 1) {
    for (const domainId of [...ACTIVES, 'joiner']) {
      await nodes.get(domainId)?.engine.tick()
    }
  }
  assert.equal(nodes.get('joiner')?.engine.phase(), 'QUALIFIED')
  assert.equal(nodes.get('joiner')?.engine.inventory().groupId, DLE_LAB_GROUP_ID)
})

test('catch-up pulls extras from the richest same-group peer, then all five qualify', async () => {
  const peers: SyncPeer[] = ACTIVES.map((domainId) => ({
    domainId,
    role: 'active',
    url: `http://${domainId}:27101`,
  }))
  const nodes = new Map<string, { engine: SyncQualificationEngine; store: ArchiveStore }>()
  const fetchImpl = fakeFetch(nodes)
  for (const domainId of ACTIVES) {
    nodes.set(domainId, await makeNode(domainId, peers, true, fetchImpl))
  }
  const extraHash = h('extra-ac')
  assert.equal(
    indexLabHashObject(
      nodes.get('a5')!.store.hash,
      labChainObjectLocator('ac', extraHash, '77', '0x1', extraHash, DLE_LAB_GROUP_ID),
      { kind: 'ac', label: 'extra-ac', hash: extraHash },
    ).ok,
    true,
  )
  for (let i = 0; i < 8; i += 1) {
    for (const node of nodes.values()) await node.engine.tick()
  }
  const qualified = [...nodes.values()].filter((node) => node.engine.phase() === 'QUALIFIED')
  assert.equal(qualified.length >= 4, true)
  assert.equal(
    [...nodes.values()].every((node) => node.engine.inventory().chainNftIds.includes('77')),
    true,
  )
})

test('QUALIFIED is not unseated when the local inventory later grows', async () => {
  const peers: SyncPeer[] = ACTIVES.map((domainId) => ({
    domainId,
    role: 'active',
    url: `http://${domainId}:27101`,
  }))
  const nodes = new Map<string, { engine: SyncQualificationEngine; store: ArchiveStore }>()
  const fetchImpl = fakeFetch(nodes)
  for (const domainId of ACTIVES) {
    nodes.set(domainId, await makeNode(domainId, peers, true, fetchImpl))
  }
  await tickAll(nodes)
  assert.equal(nodes.get('a1')?.engine.phase(), 'QUALIFIED')
  const grown = h('post-seat')
  assert.equal(
    indexLabHashObject(
      nodes.get('a1')!.store.hash,
      labChainObjectLocator('ac', grown, '88', '0x1', grown, DLE_LAB_GROUP_ID),
      { kind: 'ac', label: 'post-seat', hash: grown },
    ).ok,
    true,
  )
  await nodes.get('a1')!.engine.tick()
  assert.equal(nodes.get('a1')?.engine.phase(), 'QUALIFIED')
  assert.equal(nodes.get('a1')?.engine.seatingQualified(), true)
})

test('QUALIFIED keeper merges extras from a richer same-group peer', async () => {
  const peers: SyncPeer[] = ACTIVES.map((domainId) => ({
    domainId,
    role: 'active',
    url: `http://${domainId}:27101`,
  }))
  const nodes = new Map<string, { engine: SyncQualificationEngine; store: ArchiveStore }>()
  const fetchImpl = fakeFetch(nodes)
  for (const domainId of ACTIVES) {
    nodes.set(domainId, await makeNode(domainId, peers, true, fetchImpl))
  }
  await tickAll(nodes)
  assert.equal(nodes.get('a1')?.engine.phase(), 'QUALIFIED')
  const extraHash = h('post-seat-merge')
  assert.equal(
    indexLabHashObject(
      nodes.get('a5')!.store.hash,
      labChainObjectLocator('ac', extraHash, '91', '0x1', extraHash, DLE_LAB_GROUP_ID),
      { kind: 'ac', label: 'post-seat-merge', hash: extraHash },
    ).ok,
    true,
  )
  for (let i = 0; i < 4; i += 1) {
    for (const node of nodes.values()) await node.engine.tick()
  }
  assert.equal(nodes.get('a1')?.engine.phase(), 'QUALIFIED')
  assert.equal(nodes.get('a1')?.engine.inventory().chainNftIds.includes('91'), true)
})

test('INDEX_PROOF demotes auto-claim to SYNCING', async () => {
  const peers: SyncPeer[] = ACTIVES.map((domainId) => ({
    domainId,
    role: 'active',
    url: `http://${domainId}:27101`,
  }))
  const nodes = new Map<string, { engine: SyncQualificationEngine; store: ArchiveStore }>()
  const fetchImpl = fakeFetch(nodes)
  for (const domainId of ACTIVES) {
    nodes.set(domainId, await makeNode(domainId, peers, true, fetchImpl))
  }
  const auto = nodes.get('a1')!
  await auto.engine.tick()
  if (auto.engine.phase() === 'QUALIFIED') return
  assert.equal(auto.engine.phase(), 'CLAIMED_SYNC')
  const vote = makeSyncVote({
    domainId: 'a2',
    candidate: 'a1',
    challengeHash: h('stale-index'),
    accept: false,
    membershipRoot: auto.engine.inventory().membershipRoot,
  })
  assert.equal(auto.engine.handleReject({ ...vote, reason: 'ERR_SYNC_INDEX_PROOF' }).ok, true)
  assert.equal(auto.engine.phase(), 'SYNCING')
})

test('ROOT_MISMATCH demotes auto-claim to SYNCING; holdClaimed stays REJECTED', async () => {
  const peers: SyncPeer[] = ACTIVES.map((domainId) => ({
    domainId,
    role: 'active',
    url: `http://${domainId}:27101`,
  }))
  const nodes = new Map<string, { engine: SyncQualificationEngine; store: ArchiveStore }>()
  const fetchImpl = fakeFetch(nodes)
  for (const domainId of ACTIVES) {
    nodes.set(domainId, await makeNode(domainId, peers, true, fetchImpl))
  }
  const auto = nodes.get('a1')!
  await auto.engine.tick()
  assert.equal(auto.engine.status().holdClaimed, false)
  const autoVote = makeSyncVote({
    domainId: 'a2',
    candidate: 'a1',
    challengeHash: h('stale-auto'),
    accept: false,
    membershipRoot: auto.engine.inventory().membershipRoot,
  })
  if (auto.engine.phase() !== 'QUALIFIED') {
    assert.equal(auto.engine.phase(), 'CLAIMED_SYNC')
    assert.equal(auto.engine.handleReject({ ...autoVote, reason: 'ERR_SYNC_ROOT_MISMATCH' }).ok, true)
    assert.equal(auto.engine.phase(), 'SYNCING')
  } else {
    assert.equal(auto.engine.handleReject({ ...autoVote, reason: 'ERR_SYNC_ROOT_MISMATCH' }).ok, true)
    assert.equal(auto.engine.phase(), 'QUALIFIED')
  }

  const held = await makeNode('joiner', peers, true, fakeFetch(new Map()))
  assert.equal(held.engine.claimSync(), true)
  assert.equal(held.engine.status().holdClaimed, true)
  const heldVote = makeSyncVote({
    domainId: 'a1',
    candidate: 'joiner',
    challengeHash: h('held-claim'),
    accept: false,
    membershipRoot: held.engine.inventory().membershipRoot,
  })
  assert.equal(held.engine.handleReject({ ...heldVote, reason: 'ERR_SYNC_ROOT_MISMATCH' }).ok, true)
  assert.equal(held.engine.phase(), 'REJECTED')
})

function copyLocatorsOnly(from: ArchiveStore, to: ArchiveStore): void {
  for (const locator of from.hash.listLocators()) {
    assert.equal(to.hash.putLocator(locator).ok, true, locator.hash)
  }
}

test('grade: candidate locator-only answer is OBJECT_MISMATCH; voter miss is CHALLENGER_MISSING', async () => {
  const honest = await tempStore()
  seedTwoChains(honest)
  const liar = await tempStore()
  copyLocatorsOnly(honest, liar)
  const inventory = inventoryOf(honest, 'a1')
  const challenge = buildChallenge({
    inventory,
    candidate: 'joiner',
    challenger: 'a1',
    nonce: 1,
  })
  const missing = answerChallengeLocal(liar.hash, inventoryOf(liar, 'joiner'), challenge)
  assert.equal(
    missing.objects.some((row) => row === null),
    true,
  )
  const objectGrade = gradeChallenge({
    challenge,
    answer: missing,
    expected: inventory,
    store: honest.hash,
  })
  assert.equal(objectGrade.ok, false)
  if (!objectGrade.ok) {
    assert.equal(objectGrade.reason.startsWith('ERR_SYNC_OBJECT_MISMATCH'), true)
  }
  const honestAnswer = answerChallengeLocal(honest.hash, inventory, challenge)
  const voterMiss = gradeChallenge({
    challenge,
    answer: honestAnswer,
    expected: inventoryOf(liar, 'a1'),
    store: liar.hash,
  })
  assert.equal(voterMiss.ok, false)
  if (!voterMiss.ok) {
    assert.equal(isSyncChallengerMissingReason(voterMiss.reason), true)
  }
})

test('holdClaimed missing object is terminal REJECTED; auto-claim demotes to SYNCING', async () => {
  const peers: SyncPeer[] = ACTIVES.map((domainId) => ({
    domainId,
    role: 'active',
    url: `http://${domainId}:27101`,
  }))
  const nodes = new Map<string, { engine: SyncQualificationEngine; store: ArchiveStore }>()
  const fetchImpl = fakeFetch(nodes)
  for (const domainId of ACTIVES) {
    nodes.set(domainId, await makeNode(domainId, peers, true, fetchImpl))
  }
  await tickAll(nodes, 8)
  assert.equal(
    ['a1', 'a2', 'a3', 'a4'].every((id) => nodes.get(id)?.engine.phase() === 'QUALIFIED'),
    true,
  )

  const auto = await makeNode('a5', peers, false, fetchImpl)
  copyLocatorsOnly(nodes.get('a1')!.store, auto.store)
  nodes.set('a5', auto)
  await auto.engine.tick()
  assert.equal(auto.engine.phase(), 'CLAIMED_SYNC')
  for (let i = 0; i < 3; i += 1) {
    for (const id of ['a1', 'a2', 'a3', 'a4'] as const) await nodes.get(id)!.engine.tick()
  }
  assert.equal(auto.engine.phase(), 'SYNCING')
  assert.notEqual(auto.engine.phase(), 'REJECTED')

  const liar = await makeNode('a5', peers, false, fetchImpl)
  copyLocatorsOnly(nodes.get('a1')!.store, liar.store)
  nodes.set('a5', liar)
  assert.equal(liar.engine.claimSync(), true)
  for (let i = 0; i < 3; i += 1) {
    for (const id of ['a1', 'a2', 'a3', 'a4'] as const) await nodes.get(id)!.engine.tick()
  }
  assert.equal(liar.engine.phase(), 'REJECTED')
  const reason = liar.engine.status().rejectReason ?? ''
  assert.equal(reason.startsWith('ERR_SYNC_OBJECT_MISMATCH'), true)
})

test('challenger missing object must not reject an honest joiner', async () => {
  const peers: SyncPeer[] = [...ACTIVES, 'joiner'].map((domainId) => ({
    domainId,
    role: 'active',
    url: `http://${domainId}:27101`,
  }))
  const nodes = new Map<string, { engine: SyncQualificationEngine; store: ArchiveStore }>()
  const fetchImpl = fakeFetch(nodes)
  for (const domainId of ACTIVES) {
    nodes.set(domainId, await makeNode(domainId, peers, true, fetchImpl))
  }
  await tickAll(nodes, 8)
  assert.equal(nodes.get('a1')?.engine.phase(), 'QUALIFIED')

  const joiner = await makeNode('joiner', peers, true, fetchImpl)
  nodes.set('joiner', joiner)
  assert.equal(joiner.engine.claimSync(), true)

  const sparsePeers: SyncPeer[] = [...['a1', 'a2', 'a3'], 'joiner', 'sparse'].map((domainId) => ({
    domainId,
    role: 'active',
    url: `http://${domainId}:27101`,
  }))
  const sparse = await makeNode('sparse', sparsePeers, false, fetchImpl)
  copyLocatorsOnly(nodes.get('a1')!.store, sparse.store)
  nodes.set('sparse', sparse)
  await sparse.engine.tick()
  assert.notEqual(joiner.engine.phase(), 'REJECTED')
  assert.equal(sparse.engine.alignedQualifiedCount() < 4, true)

  for (let i = 0; i < 4; i += 1) {
    for (const id of ['a1', 'a2', 'a3', 'a4'] as const) await nodes.get(id)!.engine.tick()
  }
  assert.equal(joiner.engine.phase(), 'QUALIFIED')
})

test('permanent REJECTED active freezes inventory at Q_A=4', async () => {
  const peers: SyncPeer[] = ACTIVES.map((domainId) => ({
    domainId,
    role: 'active',
    url: `http://${domainId}:27101`,
  }))
  const nodes = new Map<string, { engine: SyncQualificationEngine; store: ArchiveStore }>()
  const fetchImpl = fakeFetch(nodes)
  for (const domainId of ACTIVES) {
    nodes.set(domainId, await makeNode(domainId, peers, true, fetchImpl))
  }
  await tickAll(nodes, 8)
  const liar = await makeNode('a5', peers, false, fetchImpl)
  copyLocatorsOnly(nodes.get('a1')!.store, liar.store)
  nodes.set('a5', liar)
  assert.equal(liar.engine.claimSync(), true)
  for (let i = 0; i < 3; i += 1) {
    for (const id of ['a1', 'a2', 'a3', 'a4'] as const) await nodes.get(id)!.engine.tick()
  }
  assert.equal(liar.engine.phase(), 'REJECTED')
  await nodes.get('a1')!.engine.tick()
  const a1 = nodes.get('a1')!.engine
  assert.equal(a1.phase(), 'QUALIFIED')
  assert.equal(a1.alignedQualifiedCount(), 4)
  assert.equal(a1.hasUnseatedActive(), true)
  assert.equal(a1.inventoryShouldFreeze(), true)
  const health = a1.health()
  assert.equal(health.hasUnseatedActive, true)
  assert.equal(health.alignedQualifiedCount, 4)
})

test('REJECTED persist restarts as a new SYNCING seating attempt', async () => {
  const peers: SyncPeer[] = ACTIVES.map((domainId) => ({
    domainId,
    role: 'active',
    url: `http://${domainId}:27101`,
  }))
  const held = await makeNode('joiner', peers, true, fakeFetch(new Map()))
  assert.equal(held.engine.claimSync(), true)
  const vote = makeSyncVote({
    domainId: 'a1',
    candidate: 'joiner',
    challengeHash: h('restart-reject'),
    accept: false,
    membershipRoot: held.engine.inventory().membershipRoot,
  })
  assert.equal(
    held.engine.handleReject({ ...vote, reason: 'ERR_SYNC_OBJECT_MISMATCH:ac:42' }).ok,
    true,
  )
  assert.equal(held.engine.phase(), 'REJECTED')
  const restarted = createSyncQualificationEngine({
    domainId: 'joiner',
    role: 'active',
    peers: peers.filter((peer) => peer.domainId !== 'joiner'),
    store: held.store,
    table: tableFor('joiner', peers),
    tickMs: 10_000,
  })
  assert.equal(restarted.phase(), 'SYNCING')
  assert.equal(restarted.status().rejectReason, null)
})

test('QUALIFIED ignores OBJECT_MISMATCH; inbound CHALLENGER_MISSING is a no-op', async () => {
  const peers: SyncPeer[] = ACTIVES.map((domainId) => ({
    domainId,
    role: 'active',
    url: `http://${domainId}:27101`,
  }))
  const nodes = new Map<string, { engine: SyncQualificationEngine; store: ArchiveStore }>()
  const fetchImpl = fakeFetch(nodes)
  for (const domainId of ACTIVES) {
    nodes.set(domainId, await makeNode(domainId, peers, true, fetchImpl))
  }
  await tickAll(nodes)
  const a1 = nodes.get('a1')!.engine
  assert.equal(a1.phase(), 'QUALIFIED')
  const rejectVote = makeSyncVote({
    domainId: 'a2',
    candidate: 'a1',
    challengeHash: h('qualified-ignore'),
    accept: false,
    membershipRoot: a1.inventory().membershipRoot,
  })
  assert.equal(
    a1.handleReject({ ...rejectVote, reason: 'ERR_SYNC_OBJECT_MISMATCH:ac:42' }).ok,
    true,
  )
  assert.equal(a1.phase(), 'QUALIFIED')

  const claimed = await makeNode('joiner', peers, true, fakeFetch(new Map()))
  assert.equal(claimed.engine.claimSync(), true)
  const inbound = makeSyncVote({
    domainId: 'a1',
    candidate: 'joiner',
    challengeHash: h('challenger-miss'),
    accept: false,
    membershipRoot: claimed.engine.inventory().membershipRoot,
  })
  assert.equal(
    claimed.engine.handleReject({ ...inbound, reason: 'ERR_SYNC_CHALLENGER_MISSING:42' }).ok,
    true,
  )
  assert.equal(claimed.engine.phase(), 'CLAIMED_SYNC')
  assert.equal(claimed.engine.status().rejectReason, null)
})

test('alignedQualifiedCount ignores standby seats so CLAIMED_SYNC keepers can still vote', async () => {
  const peers: SyncPeer[] = [
    ...ACTIVES.map((domainId) => ({
      domainId,
      role: 'active',
      url: `http://${domainId}:27101`,
    })),
    { domainId: 's1', role: 'standby', url: 'http://s1:27101' },
  ]
  const nodes = new Map<string, { engine: SyncQualificationEngine; store: ArchiveStore }>()
  const fetchImpl = fakeFetch(nodes)
  for (const domainId of ACTIVES) {
    nodes.set(domainId, await makeNode(domainId, peers, true, fetchImpl))
  }
  nodes.set('s1', await makeNode('s1', peers, true, fetchImpl, 'standby'))
  await tickAll(nodes, 8)
  const a1 = nodes.get('a1')!.engine
  const activeQualified = ACTIVES.filter((id) => nodes.get(id)!.engine.seatingQualified()).length
  assert.equal(a1.alignedQualifiedCount(), activeQualified)
  assert.equal(a1.alignedQualifiedCount() <= ACTIVES.length, true)
  assert.equal(a1.alignedQualifiedCount() >= 4, true)
})

test('P12 cutover rejects HMAC seating votes and bind recoverAddress to the lab seating key', async () => {
  const peers: SyncPeer[] = ACTIVES.map((domainId) => ({
    domainId,
    role: 'active',
    url: `http://${domainId}:27101`,
  }))
  const held = await makeNode('joiner', peers, true, fakeFetch(new Map()))
  assert.equal(held.engine.claimSync(), true)
  const inventory = held.engine.inventory()
  const hmac = makeHmacSyncVote({
    domainId: 'a1',
    candidate: 'joiner',
    challengeHash: h('hmac-cutover'),
    accept: true,
    membershipRoot: inventory.membershipRoot,
  })
  assert.equal(isHmacSeatingVote(hmac), true)
  assert.equal(held.engine.handleVote(hmac).error, 'ERR_SYNC_HMAC_CUTOVER')
  assert.equal(held.engine.handleReject({ ...hmac, accept: false }).error, 'ERR_SYNC_HMAC_CUTOVER')
  assert.equal(held.engine.phase(), 'CLAIMED_SYNC')

  const good = voteFromInventory('a1', 'joiner', h('eip712-bind'), true, inventory)
  assert.equal(isHmacSeatingVote(good), false)
  assert.equal(good.eip712, true)
  assert.equal(good.hmacForgeable, false)
  assert.equal(good.signer, labSeatingAddress('a1'))
  assert.equal(recoverSyncVoteSigner(good), labSeatingAddress('a1'))

  const outsider = voteFromInventory('zzz', 'joiner', h('eip712-bind'), true, inventory)
  assert.equal(held.engine.handleVote(outsider).error, 'ERR_SYNC_VOTER')

  const forged = {
    ...good,
    signature: voteFromInventory('a2', 'joiner', h('eip712-bind'), true, inventory).signature,
  }
  assert.equal(held.engine.handleVote(forged).error, 'ERR_SYNC_SIG')
  assert.equal(held.engine.seatingQualified(), false)
})

test('P13 freeze has no seed; post-freeze reveal is not keccak(freezeHex)', async () => {
  const store = await tempStore()
  seedTwoChains(store)
  const inventory = inventoryOf(store, 'a1')
  const freeze = freezeChallengeRoots({
    inventory,
    candidate: 'joiner',
    challenger: 'a1',
    nonce: 1,
    now: '2026-08-17T00:00:00.000Z',
  })
  assert.equal(freeze.schema, 'ArchiveSyncFreezeV1')
  assert.equal(freeze.beaconBound, false)
  assert.equal(freeze.waitingForClBeacon, true)
  assert.equal(freeze.notClRandao, true)
  assert.equal(freeze.notProductionBeacon, true)
  assert.equal(freeze.publicrpcNotClRandao, true)
  assert.equal('seed' in freeze, false)
  assert.equal('samples' in freeze, false)
  assert.equal('labBeacon' in freeze, false)

  const instant = labSyncBeacon(freeze.freezeHex)
  const revealA = h('p13-reveal-a')
  const revealB = h('p13-reveal-b')
  const boundA = bindChallengeBeacon({
    freeze,
    inventory,
    revealSalt: revealA,
    probe: { available: false, reason: 'no_finalized_cl_view', notClRandao: true, publicrpcNotClRandao: true },
  })
  const boundB = bindChallengeBeacon({
    freeze,
    inventory,
    revealSalt: revealB,
    probe: { available: false, reason: 'no_finalized_cl_view', notClRandao: true, publicrpcNotClRandao: true },
  })
  assert.equal(boundA.labBeaconAfterFreeze, true)
  assert.equal(boundA.notProductionBeacon, true)
  assert.equal(boundA.notClRandao, true)
  assert.equal(boundA.waitingForClBeacon, false)
  assert.equal(boundA.publicrpcNotClRandao, true)
  assert.equal(boundA.beaconSource, 'lab-after-freeze')
  assert.equal(boundA.labBeacon, labSyncBeaconAfterFreeze(freeze.freezeHex, revealA))
  assert.notEqual(boundA.labBeacon, instant)
  assert.notEqual(boundA.seed, boundB.seed)
  assert.notEqual(
    boundA.seed,
    challengeSeedOf({
      labBeacon: instant,
      groupId: inventory.groupId,
      candidate: 'joiner',
      nonce: 1,
      lastACRef: inventory.lastACRef,
      hostedChainSetRoot: inventory.hostedChainSetRoot,
    }),
  )
  const oneShot = buildChallenge({ inventory, candidate: 'joiner', challenger: 'a1', nonce: 1 })
  assert.equal(oneShot.labBeacon, labSyncBeaconAfterFreeze(oneShot.freezeHex, labHonestWaitReveal(oneShot.freezeHex)))
  assert.notEqual(oneShot.labBeacon, labSyncBeacon(oneShot.freezeHex))
})

test('P13 CL probe never treats publicrpc/rpc1 as RANDAO', () => {
  assert.equal(isForbiddenElRpcAsCl('https://publicrpc.conet.network'), true)
  assert.equal(isForbiddenElRpcAsCl('https://rpc1.conet.network'), true)
  assert.equal(isForbiddenElRpcAsCl('https://rpc.conet.network'), true)
  const blockedUrl = probeFinalizedClRandomness({
    clViewUrl: 'https://publicrpc.conet.network',
    env: {},
  })
  assert.equal(blockedUrl.available, false)
  if (!blockedUrl.available) assert.equal(blockedUrl.reason, 'forbidden_el_rpc_as_cl')
  const blockedEnv = probeFinalizedClRandomness({
    env: { DLE_ARCHIVE_CL_FINALIZED_RANDOMNESS: 'https://rpc1.conet.network' },
  })
  assert.equal(blockedEnv.available, false)
  const none = probeFinalizedClRandomness({ env: {} })
  assert.equal(none.available, false)
  if (!none.available) assert.equal(none.reason, 'no_finalized_cl_view')
  const injected = probeFinalizedClRandomness({ injectedRandomness: h('p13-injected-cl'), env: {} })
  assert.equal(injected.available, true)
  if (injected.available) {
    assert.equal(injected.source, 'injected-cl-view')
    assert.equal(injected.notClRandao, true)
    assert.equal(injected.notProductionBeacon, true)
  }
})

test('P13 engine persists freeze before bind and labels lab beacon', async () => {
  const store = await tempStore()
  seedTwoChains(store)
  const engine = createSyncQualificationEngine({
    domainId: 'a1',
    role: 'active',
    peers: [],
    store,
    table: tableFor('a1', []),
    tickMs: 10_000,
    postFreezeRevealMaterial: () => 'p13-engine-reveal',
  })
  assert.equal(engine.claimSync(), true)
  const status = engine.status()
  const challenge = status.pendingChallenge
  assert.equal(challenge !== null, true)
  if (challenge === null) return
  assert.equal(status.freezeBeforeBeacon, true)
  assert.equal(status.labBeaconAfterFreeze, true)
  assert.equal(status.notProductionBeacon, true)
  assert.equal(status.publicrpcNotClRandao, true)
  assert.equal(status.notClRandao, true)
  assert.equal(challenge.labBeaconAfterFreeze, true)
  assert.equal(challenge.notProductionBeacon, true)
  assert.notEqual(challenge.labBeacon, labSyncBeacon(challenge.freezeHex))
  const health = engine.health().syncQualification as {
    freezeBeforeBeacon?: boolean
    labBeaconAfterFreeze?: boolean
    notProductionBeacon?: boolean
    publicrpcNotClRandao?: boolean
  }
  assert.equal(health.freezeBeforeBeacon, true)
  assert.equal(health.labBeaconAfterFreeze, true)
  assert.equal(health.notProductionBeacon, true)
  assert.equal(health.publicrpcNotClRandao, true)
})

test('P14 production C_G probe never treats publicrpc/rpc1 or lab hosted-set as C_G', () => {
  const none = probeProductionCg({ env: {} })
  assert.equal(none.available, false)
  if (!none.available) assert.equal(none.reason, 'no_l1_archive_group_id_view')
  assert.equal(none.labHostedSetNotProductionCg, true)
  assert.equal(none.publicrpcNotProductionCg, true)
  assert.equal(none.notLiveL1Scan, true)

  const blockedUrl = probeProductionCg({
    l1ViewUrl: 'https://publicrpc.conet.network',
    env: {},
  })
  assert.equal(blockedUrl.available, false)
  if (!blockedUrl.available) assert.equal(blockedUrl.reason, 'forbidden_el_rpc_as_production_cg')

  const blockedEnv = probeProductionCg({
    env: { DLE_ARCHIVE_PRODUCTION_CG_JSON: 'https://rpc1.conet.network' },
  })
  assert.equal(blockedEnv.available, false)
  if (!blockedEnv.available) assert.equal(blockedEnv.reason, 'forbidden_el_rpc_as_production_cg')

  const labIds = ['42', '99']
  const impersonate = probeProductionCg({
    injected: {
      groupStorageKey: '1',
      chainNftIds: labIds,
      lastAC: h('p14-lastAC'),
      membershipRoot: h('p14-membership'),
      hashIndexRoot: h('p14-index'),
    },
    labHostedChainNftIds: labIds,
    env: {},
  })
  assert.equal(impersonate.available, false)
  if (!impersonate.available) assert.equal(impersonate.reason, 'lab_hosted_set_is_not_production_cg')
})

test('P14 injected L1 small-set is not the lab hosted-set; smoke opens only that set', () => {
  const injected = probeProductionCg({
    injected: {
      groupStorageKey: '1',
      chainNftIds: ['1001', '1002'],
      lastAC: h('p14-lastAC'),
      membershipRoot: h('p14-membership'),
      hashIndexRoot: h('p14-index'),
    },
    labHostedChainNftIds: ['42', '99'],
    env: {},
  })
  assert.equal(injected.available, true)
  if (!injected.available) return
  assert.equal(injected.source, 'injected-l1-archiveGroupId')
  assert.equal(injected.notLabHostedSet, true)
  assert.equal(injected.notLiveL1Scan, true)
  assert.equal(injected.notProductionCg, true)
  assert.equal(injected.hostedSetSize, 2)
  assert.deepEqual(injected.chainNftIds, ['1001', '1002'])
  assert.notEqual(injected.hostedChainSetRoot, hostedChainSetRootOf(['42', '99']))

  const health = productionCgHealthView(injected)
  assert.equal(health.schema, 'DleProductionCgProbeV1')
  assert.equal('sampleCount' in health, false)
  assert.equal('openedChainCount' in health, false)

  const locators = [
    labChainObjectLocator('ac', h('ac1001'), '1001', '0x1', h('ac1001'), DLE_LAB_GROUP_ID),
    labChainObjectLocator('tipStateRoot', h('tip1001'), '1001', '0x1', h('ac1001'), DLE_LAB_GROUP_ID),
    labChainObjectLocator('ac', h('ac1002'), '1002', '0x1', h('ac1002'), DLE_LAB_GROUP_ID),
    labChainObjectLocator('block', h('hist42'), '42', '0x0', h('ac42'), DLE_LAB_GROUP_ID),
  ]
  const smoke = productionCgOpeningSmoke({
    probe: injected,
    seed: h('p14-smoke-seed'),
    locators,
  })
  assert.equal(smoke.schema, 'DleProductionCgOpeningSmokeV1')
  assert.equal(smoke.openingRunnable, true)
  assert.equal(smoke.hostedChainCount, 2)
  assert.equal(smoke.openedAllHostedChains, true)
  assert.notEqual(smoke.hostedChainCount, 3)
})

test('P14 engine keeps lab opening on freezer set and labels production C_G unavailable', async () => {
  const store = await tempStore()
  seedTwoChains(store)
  const engine = createSyncQualificationEngine({
    domainId: 'a1',
    role: 'active',
    peers: [],
    store,
    table: tableFor('a1', []),
    tickMs: 10_000,
  })
  const opening = engine.opening()
  assert.equal(opening.schema, 'DleLabCgOpeningV1')
  assert.equal(opening.notProductionCg, true)
  assert.equal(opening.labHostedSetNotProductionCg, true)
  assert.equal(opening.publicrpcNotProductionCg, true)
  assert.equal(opening.hostedChainCount, 2)
  assert.equal(opening.openedAllHostedChains, true)
  const productionOpening = opening.productionCg as { available?: boolean; reason?: string; sampleCount?: number }
  assert.equal(productionOpening.available, false)
  assert.equal(productionOpening.reason, 'no_l1_archive_group_id_view')
  assert.equal(productionOpening.sampleCount, undefined)

  const status = engine.status()
  assert.equal(status.labHostedSetNotProductionCg, true)
  assert.equal(status.publicrpcNotProductionCg, true)
  assert.equal(status.productionCgAvailable, false)

  const health = engine.health()
  assert.equal(health.labCgOpeningNotProduction, true)
  assert.equal(health.labHostedSetNotProductionCg, true)
  assert.equal(health.publicrpcNotProductionCg, true)
  assert.equal(health.productionCgAvailable, false)
  const productionHealth = health.productionCg as { available?: boolean; sampleCount?: number; openedChainCount?: number }
  assert.equal(productionHealth.available, false)
  assert.equal(productionHealth.sampleCount, undefined)
  assert.equal(productionHealth.openedChainCount, undefined)
  const sync = health.syncQualification as { productionCgAvailable?: boolean; labHostedSetNotProductionCg?: boolean }
  assert.equal(sync.productionCgAvailable, false)
  assert.equal(sync.labHostedSetNotProductionCg, true)

  const injectedEngine = createSyncQualificationEngine({
    domainId: 'a1',
    role: 'active',
    peers: [],
    store,
    table: tableFor('a1', []),
    tickMs: 10_000,
    productionCgProbe: () =>
      probeProductionCg({
        injected: {
          groupStorageKey: '1',
          chainNftIds: ['1001'],
          lastAC: h('p14-eng-lastAC'),
          membershipRoot: h('p14-eng-membership'),
          hashIndexRoot: h('p14-eng-index'),
        },
        labHostedChainNftIds: ['42', '99'],
        env: {},
      }),
  })
  const injectedOpening = injectedEngine.opening()
  assert.equal(injectedOpening.hostedChainCount, 2)
  assert.equal(injectedOpening.notProductionCg, true)
  const smoke = injectedOpening.productionCg as {
    available?: boolean
    hostedSetSize?: number
    openingRunnable?: boolean
    notLabHostedSet?: boolean
  }
  assert.equal(smoke.available, true)
  assert.equal(smoke.hostedSetSize, 1)
  assert.equal(smoke.openingRunnable, false)
  assert.equal(smoke.notLabHostedSet, true)
  assert.equal(injectedEngine.health().productionCgAvailable, true)
  const slim = injectedEngine.health().productionCg as { sampleCount?: number; openedChainCount?: number }
  assert.equal(slim.sampleCount, undefined)
  assert.equal(slim.openedChainCount, undefined)
})

test('P15 cutover rejects unsigned HMAC challenges and binds recoverAddress to the challenger seating key', async () => {
  const store = await tempStore()
  seedTwoChains(store)
  const engine = createSyncQualificationEngine({
    domainId: 'a1',
    role: 'active',
    peers: [],
    store,
    table: tableFor('a1', []),
    tickMs: 10_000,
  })
  assert.equal(engine.claimSync(), true)
  const inventory = engine.inventory()
  const good = buildChallenge({
    inventory,
    candidate: 'a1',
    challenger: 'a1',
    nonce: 1,
  })
  assert.equal(good.eip712, true)
  assert.equal(good.hmacForgeable, false)
  assert.equal(isHmacChallenge(good), false)
  assert.equal(good.signer, labSeatingAddress('a1'))
  const verified = verifyEip712Challenge(good)
  assert.equal(verified.ok, true)
  if (verified.ok) assert.equal(verified.recovered, labSeatingAddress('a1'))
  assert.equal(recoverArchiveStateChallenge({
    groupId: good.groupId,
    candidate: good.candidate,
    challenger: good.challenger,
    nonce: good.nonce,
    hostedChainSetRoot: good.hostedChainSetRoot,
    lastACRef: good.lastACRef,
    membershipRoot: good.membershipRoot,
    hashIndexRoot: good.hashIndexRoot,
    freezeHex: good.freezeHex,
    labBeacon: good.labBeacon,
    seed: good.seed,
    challengeHash: good.challengeHash,
    samplesRoot: good.samplesRoot,
  }, good.signature), labSeatingAddress('a1'))

  const unsigned = {
    ...good,
    eip712: false,
    hmacForgeable: true,
    signature: undefined,
    signer: undefined,
  }
  assert.equal(isHmacChallenge(unsigned), true)
  assert.equal(engine.handleChallenge(unsigned).error, ERR_SYNC_CHALLENGE_HMAC_CUTOVER)
  assert.equal(engine.handleChallenge({ ...good, hmacForgeable: true }).error, ERR_SYNC_CHALLENGE_HMAC_CUTOVER)
})

test('P15 tampered samples fail SIG; resigned samples that miss the seed fail SAMPLES', async () => {
  const store = await tempStore()
  seedTwoChains(store)
  const engine = createSyncQualificationEngine({
    domainId: 'a1',
    role: 'active',
    peers: [],
    store,
    table: tableFor('a1', []),
    tickMs: 10_000,
  })
  assert.equal(engine.claimSync(), true)
  const inventory = engine.inventory()
  const good = buildChallenge({
    inventory,
    candidate: 'a1',
    challenger: 'a1',
    nonce: 1,
  })
  const tampered = { ...good, samples: [] }
  assert.equal(engine.handleChallenge(tampered).error, ERR_SYNC_CHALLENGE_SIG)
  const {
    samplesRoot: _samplesRoot,
    challengeHash: _challengeHash,
    signer: _signer,
    signature: _signature,
    eip712: _eip712,
    hmacForgeable: _hmacForgeable,
    notProductionOperatorKey: _notProductionOperatorKey,
    labDeterministicSeatingKey: _labDeterministicSeatingKey,
    notL1Settled: _notL1Settled,
    ...unsigned
  } = good
  const resigned = attestLabChallenge({ ...unsigned, samples: [] })
  assert.equal(resigned.eip712, true)
  assert.equal(engine.handleChallenge(resigned).error, ERR_SYNC_CHALLENGE_SAMPLES)
})

test('P15 engine claimSync signs the pending challenge and labels opening as EIP-712', async () => {
  const store = await tempStore()
  seedTwoChains(store)
  const engine = createSyncQualificationEngine({
    domainId: 'a1',
    role: 'active',
    peers: [],
    store,
    table: tableFor('a1', []),
    tickMs: 10_000,
  })
  assert.equal(engine.claimSync(), true)
  const status = engine.status()
  const challenge = status.pendingChallenge
  assert.equal(challenge !== null, true)
  if (challenge === null) return
  assert.equal(challenge.eip712, true)
  assert.equal(challenge.hmacForgeable, false)
  assert.equal(challenge.signer, labSeatingAddress('a1'))
  assert.equal(status.hmacForgeable, false)
  assert.equal(status.seatingEip712, true)
  assert.equal(status.challengeEip712, true)
  const opening = engine.opening()
  assert.equal(opening.eip712, true)
  assert.equal(opening.hmacForgeable, false)
  assert.equal(opening.challengeEip712, true)
  const health = engine.health().syncQualification as {
    hmacForgeable?: boolean
    seatingEip712?: boolean
    challengeEip712?: boolean
  }
  assert.equal(health.hmacForgeable, false)
  assert.equal(health.seatingEip712, true)
  assert.equal(health.challengeEip712, true)
  const verified = verifyEip712Challenge(challenge)
  assert.equal(verified.ok, true)
  if (verified.ok) assert.equal(verified.recovered, labSeatingAddress('a1'))
})
