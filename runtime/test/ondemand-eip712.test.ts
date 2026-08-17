import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createOnDemandEngine } from '../src/archive/ondemand/engine.js'
import {
  ERR_ONDEMAND_ATTEST_SIG,
  ERR_ONDEMAND_HMAC_CUTOVER,
  isHmacOnDemandAttest,
  makeHmacLabPoolAttest,
  makeLabPoolAttest,
  recoverLabPoolAttestSigner,
  verifyEip712LabPoolAttest,
} from '../src/archive/ondemand/mac.js'
import { openArchiveStore } from '../src/archive/store.js'
import { labSeatingAddress } from '../src/archive/syncQualification/eip712.js'
import type { Hex } from '../src/shared/bytes.js'
import {
  ARCHIVE_ATTEST_QUORUM,
  LAB_EPOCH,
  LAB_GROUP_ID,
  LAB_MINERS,
  LAB_SELECTION_NOTE,
  LAB_SHARD_ID,
  drawCommittee,
} from '../src/shared/ondemand/index.js'

const dirs: string[] = []

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempStore() {
  const dataDir = await mkdtemp(join(tmpdir(), 'dle-p17-ondemand-'))
  dirs.push(dataDir)
  return openArchiveStore(dataDir)
}

function unsignedOf(domainId: string, draw: ReturnType<typeof drawCommittee>) {
  return {
    domainId,
    poolRoot: draw.poolRoot,
    epoch: LAB_EPOCH,
    shardId: LAB_SHARD_ID,
    roulette: draw.roulette,
  }
}

test('P17 cutover rejects HMAC and unsigned on-demand attests', async () => {
  const store = await tempStore()
  const engine = createOnDemandEngine({
    domainId: 'fd-01',
    role: 'active',
    peers: [],
    store,
    autoSeedLabMiners: true,
    autoFreeze: true,
  })
  await engine.start()
  const selection = engine.selection()
  assert.equal(selection.available, true)
  if (selection.available !== true) throw new Error('expected selection')
  const draw = {
    poolRoot: selection.poolRoot,
    roulette: selection.roulette,
  }
  const hmac = makeHmacLabPoolAttest({
    domainId: 'fd-02',
    poolRoot: draw.poolRoot,
    epoch: LAB_EPOCH,
    shardId: LAB_SHARD_ID,
    roulette: draw.roulette,
  })
  assert.equal(isHmacOnDemandAttest(hmac), true)
  const hmacIngest = engine.ingest({
    schema: 'DleLabOnDemandMessageV1',
    from: 'fd-02',
    attests: [hmac],
  })
  assert.equal(hmacIngest.ok, false)
  assert.equal(hmacIngest.error, ERR_ONDEMAND_HMAC_CUTOVER)

  const labeled = { ...makeLabPoolAttest({
    domainId: 'fd-02',
    poolRoot: draw.poolRoot,
    epoch: LAB_EPOCH,
    shardId: LAB_SHARD_ID,
    roulette: draw.roulette,
  }), hmacForgeable: true as const }
  const labeledIngest = engine.ingest({
    schema: 'DleLabOnDemandMessageV1',
    from: 'fd-02',
    attests: [labeled],
  })
  assert.equal(labeledIngest.ok, false)
  assert.equal(labeledIngest.error, ERR_ONDEMAND_HMAC_CUTOVER)

  const unsigned = {
    schema: 'DleLabPoolAttestV1',
    domainId: 'fd-02',
    poolRoot: draw.poolRoot,
    epoch: LAB_EPOCH,
    shardId: LAB_SHARD_ID,
    roulette: draw.roulette,
  }
  const unsignedIngest = engine.ingest({
    schema: 'DleLabOnDemandMessageV1',
    from: 'fd-02',
    attests: [unsigned],
  })
  assert.equal(unsignedIngest.ok, false)
  assert.equal(unsignedIngest.error, 'ERR_INVALID_ATTEST')
  engine.stop()
})

test('P17 recoverAddress binds the seating key; tampered signature fails SIG', async () => {
  const store = await tempStore()
  const engine = createOnDemandEngine({
    domainId: 'fd-01',
    role: 'active',
    peers: [],
    store,
    autoSeedLabMiners: true,
    autoFreeze: true,
  })
  await engine.start()
  const selection = engine.selection()
  assert.equal(selection.available, true)
  if (selection.available !== true) throw new Error('expected selection')
  const health = engine.health()
  assert.equal(health.eip712, true)
  assert.equal(health.hmacForgeable, false)
  assert.equal(health.ondemandEip712, true)
  assert.equal(selection.eip712, true)
  assert.equal(selection.hmacForgeable, false)
  assert.equal(selection.ondemandEip712, true)
  assert.equal(selection.note, LAB_SELECTION_NOTE)

  const attest = makeLabPoolAttest({
    domainId: 'fd-02',
    poolRoot: selection.poolRoot,
    epoch: LAB_EPOCH,
    shardId: LAB_SHARD_ID,
    roulette: selection.roulette,
  })
  assert.equal(attest.eip712, true)
  assert.equal(attest.hmacForgeable, false)
  assert.equal(attest.signer, labSeatingAddress('fd-02'))
  assert.equal(verifyEip712LabPoolAttest(attest), true)
  assert.equal(recoverLabPoolAttestSigner(attest), labSeatingAddress('fd-02'))
  const accepted = engine.ingest({
    schema: 'DleLabOnDemandMessageV1',
    from: 'fd-02',
    attests: [attest],
  })
  assert.equal(accepted.ok, true)
  assert.equal(engine.health().ondemandAttestCount >= 2, true)

  const wrongSigner = { ...attest, signer: labSeatingAddress('fd-03') }
  const mismatched = engine.ingest({
    schema: 'DleLabOnDemandMessageV1',
    from: 'fd-03',
    attests: [wrongSigner],
  })
  assert.equal(mismatched.ok, false)
  assert.equal(mismatched.error, ERR_ONDEMAND_ATTEST_SIG)

  const tampered = {
    ...attest,
    domainId: 'fd-03',
    signer: labSeatingAddress('fd-03'),
    signature: `0x${'11'.repeat(65)}` as Hex,
  }
  const bad = engine.ingest({
    schema: 'DleLabOnDemandMessageV1',
    from: 'fd-03',
    attests: [tampered],
  })
  assert.equal(bad.ok, false)
  assert.equal(bad.error, ERR_ONDEMAND_ATTEST_SIG)
  engine.stop()
})

test('P17 keep-only restores disk HMAC attests and labels health EIP-712', async () => {
  const store = await tempStore()
  const draw = drawCommittee({ miners: [...LAB_MINERS] })
  const now = new Date().toISOString()
  store.persistOnDemandState({
    schema: 'DleLabOnDemandStateV1',
    miners: LAB_MINERS.map((address) => ({ address, joinNonce: 0, joinedAt: now })),
    frozen: true,
    freezeAt: now,
    attests: ['fd-01', 'fd-02', 'fd-03', 'fd-04'].map((domainId) =>
      makeHmacLabPoolAttest(unsignedOf(domainId, draw)),
    ),
    selection: {
      schema: 'DleLabSelectionLogV1',
      available: true,
      endorsed: true,
      epoch: LAB_EPOCH,
      shardId: LAB_SHARD_ID,
      groupId: LAB_GROUP_ID,
      poolRoot: draw.poolRoot,
      beacon: draw.beacon,
      roulette: draw.roulette,
      committee: draw.committee,
      standbys: draw.standbys,
      attestors: ['fd-01', 'fd-02', 'fd-03', 'fd-04'],
      quorum: ARCHIVE_ATTEST_QUORUM,
      labBeacon: true,
      labOnly: true,
      note: 'legacy hmac selection',
    },
  })
  const engine = createOnDemandEngine({
    domainId: 'fd-01',
    role: 'active',
    peers: [],
    store,
  })
  await engine.start()
  const view = engine.selection()
  assert.equal(view.available, true)
  if (view.available !== true) throw new Error('expected selection')
  assert.equal(view.endorsed, true)
  assert.equal(engine.health().ondemandAttestCount, 4)
  assert.equal(engine.health().eip712, true)
  assert.equal(engine.health().hmacForgeable, false)
  assert.equal(engine.health().ondemandEip712, true)

  const hmacIngest = engine.ingest({
    schema: 'DleLabOnDemandMessageV1',
    from: 'fd-05',
    attests: [makeHmacLabPoolAttest(unsignedOf('fd-05', draw))],
  })
  assert.equal(hmacIngest.ok, false)
  assert.equal(hmacIngest.error, ERR_ONDEMAND_HMAC_CUTOVER)
  assert.equal(engine.health().ondemandAttestCount, 4)
  engine.stop()
})
