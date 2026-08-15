import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { labGenesisDepositBundle } from '../src/archive/bft/labCandidate.js'
import { replayDepositBundle } from '../src/archive/bft/modeA.js'
import { attachSelectionToDepositBundle } from '../src/archive/ondemand/attach.js'
import { createOnDemandEngine } from '../src/archive/ondemand/engine.js'
import { openArchiveStore } from '../src/archive/store.js'
import type { Hex } from '../src/shared/bytes.js'
import {
  ARCHIVE_ATTEST_QUORUM,
  LAB_EPOCH,
  LAB_GROUP_ID,
  LAB_MINERS,
  LAB_SHARD_ID,
  drawCommittee,
  labBeaconAfterFreeze,
  poolRootOf,
  rouletteSeed,
  sameHexList,
  type SelectionLog,
} from '../src/shared/ondemand/index.js'

const dirs: string[] = []

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempStore() {
  const dataDir = await mkdtemp(join(tmpdir(), 'dle-ondemand-'))
  dirs.push(dataDir)
  return openArchiveStore(dataDir)
}

function selectionFromDraw(draw: ReturnType<typeof drawCommittee>): SelectionLog {
  return {
    schema: 'DleLabSelectionLogV1',
    available: true,
    endorsed: false,
    epoch: LAB_EPOCH,
    shardId: LAB_SHARD_ID,
    groupId: LAB_GROUP_ID,
    poolRoot: draw.poolRoot,
    beacon: draw.beacon,
    roulette: draw.roulette,
    committee: draw.committee,
    standbys: draw.standbys,
    attestors: [],
    quorum: ARCHIVE_ATTEST_QUORUM,
    labBeacon: true,
    labOnly: true,
    note: 'test',
  }
}

test('poolRoot is stable for the same sorted miners', () => {
  const first = poolRootOf(LAB_MINERS)
  const shuffled = [...LAB_MINERS].reverse()
  assert.equal(poolRootOf(shuffled), first)
  assert.match(first, /^0x[0-9a-f]{64}$/)
})

test('same R_e draws the same 7+2 committee', () => {
  const first = drawCommittee({ miners: LAB_MINERS })
  const second = drawCommittee({ miners: [...LAB_MINERS].reverse() })
  assert.equal(first.poolRoot, second.poolRoot)
  assert.equal(first.roulette, second.roulette)
  assert.equal(sameHexList(first.committee, second.committee), true)
  assert.equal(sameHexList(first.standbys, second.standbys), true)
  assert.equal(first.committee.length, 7)
  assert.equal(first.standbys.length, 2)
  const overlap = new Set(first.committee.map((row) => row.toLowerCase()))
  assert.equal(first.standbys.every((row) => !overlap.has(row.toLowerCase())), true)
})

test('injected beacon changes roulette but stays locally recomputable', () => {
  const beacon = `0x${'ab'.repeat(32)}` as Hex
  const drawn = drawCommittee({ miners: LAB_MINERS, beacon })
  assert.equal(drawn.beacon, beacon)
  assert.notEqual(drawn.beacon, labBeaconAfterFreeze(drawn.poolRoot))
  const replay = drawCommittee({ miners: LAB_MINERS, beacon })
  assert.equal(drawn.roulette, replay.roulette)
  assert.equal(sameHexList(drawn.committee, replay.committee), true)
  assert.equal(
    drawn.roulette,
    rouletteSeed({ beacon, epoch: LAB_EPOCH, shardId: LAB_SHARD_ID, poolRoot: drawn.poolRoot }),
  )
})

test('duplicate wait hook is rejected before freeze (anti-hoard)', async () => {
  const store = await tempStore()
  const engine = createOnDemandEngine({
    domainId: 'fd-01',
    role: 'active',
    peers: [],
    store,
  })
  await engine.start()
  const miner = LAB_MINERS[0]!
  const first = engine.hook({ schema: 'DleOnDemandHookV1', miner, groupId: LAB_GROUP_ID })
  assert.equal(first.status, 200)
  const body = first.body as { status: string }
  assert.equal(body.status, 'queued')
  const second = engine.hook({ schema: 'DleOnDemandHookV1', miner, groupId: LAB_GROUP_ID })
  assert.equal(second.status, 409)
  assert.equal((second.body as { error: string }).error, 'ERR_DUPLICATE_HOOK')
  engine.stop()
})

test('freeze rejects later hooks and keeps the frozen poolRoot', async () => {
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
  const pool = engine.pool()
  assert.equal(pool.frozen, true)
  assert.equal(pool.minerCount, 9)
  const frozenRoot = pool.poolRoot
  const late = engine.hook({
    schema: 'DleOnDemandHookV1',
    miner: '0xa11000000000000000000000000000000000000a',
    groupId: LAB_GROUP_ID,
  })
  assert.equal(late.status, 409)
  assert.equal((late.body as { error: string }).error, 'ERR_POOL_FROZEN')
  assert.equal(engine.pool().poolRoot, frozenRoot)
  const selection = engine.selection()
  assert.equal(selection.available, true)
  if (selection.available) {
    const replay = drawCommittee({
      miners: pool.miners,
      epoch: pool.epoch,
      shardId: pool.shardId,
      beacon: selection.beacon,
    })
    assert.equal(replay.poolRoot, selection.poolRoot)
    assert.equal(sameHexList(replay.committee, selection.committee), true)
    assert.equal(selection.endorsed, false)
  }
  engine.stop()
})

test('optional DepositBundle selection fields do not change Mode A valueHash', () => {
  const bundle = labGenesisDepositBundle()
  const drawn = drawCommittee({ miners: LAB_MINERS })
  const attached = attachSelectionToDepositBundle(bundle, selectionFromDraw(drawn))
  const replay = replayDepositBundle(attached)
  assert.equal(replay.ok, true)
  if (replay.ok) {
    assert.equal(replay.valueHash, bundle.claimedValueHash)
    assert.equal(replay.valueHash, attached.claimedValueHash)
  }
  assert.equal(attached.selectionLogRef, drawn.poolRoot)
  assert.equal(attached.committee?.length, 7)
})
