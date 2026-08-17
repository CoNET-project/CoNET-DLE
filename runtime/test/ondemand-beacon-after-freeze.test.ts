import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createOnDemandEngine } from '../src/archive/ondemand/engine.js'
import { makeHmacLabPoolAttest } from '../src/archive/ondemand/mac.js'
import { probeFinalizedClRandomness } from '../src/archive/syncQualification/clBeacon.js'
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
  ondemandFreezeHex,
  sameHexList,
} from '../src/shared/ondemand/index.js'

const dirs: string[] = []

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempStore() {
  const dataDir = await mkdtemp(join(tmpdir(), 'dle-p19-ondemand-'))
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

test('P19 autoFreeze binds lab-after-freeze; instant keccak is contrast-only', async () => {
  const store = await tempStore()
  const engine = createOnDemandEngine({
    domainId: 'fd-01',
    role: 'active',
    peers: [],
    store,
    autoSeedLabMiners: true,
    autoFreeze: true,
    clBeaconProbe: () => probeFinalizedClRandomness({ env: {} }),
  })
  await engine.start()
  const pool = engine.pool()
  const selection = engine.selection()
  const health = engine.health()
  assert.equal(pool.frozen, true)
  assert.equal(selection.available, true)
  if (selection.available !== true) throw new Error('expected selection')
  assert.ok(pool.poolRoot)
  assert.notEqual(selection.beacon, labBeaconAfterFreeze(selection.poolRoot, selection.epoch, selection.shardId))
  assert.equal(
    pool.freezeHex,
    ondemandFreezeHex({
      poolRoot: pool.poolRoot!,
      epoch: pool.epoch,
      shardId: pool.shardId,
      groupId: pool.groupId,
    }),
  )
  const replay = drawCommittee({
    miners: pool.miners,
    epoch: pool.epoch,
    shardId: pool.shardId,
    beacon: selection.beacon,
  })
  assert.equal(replay.poolRoot, selection.poolRoot)
  assert.equal(replay.roulette, selection.roulette)
  assert.equal(sameHexList(replay.committee, selection.committee), true)
  assert.equal(sameHexList(replay.standbys, selection.standbys), true)
  assert.equal(health.ondemandFreezeBeforeBeacon, true)
  assert.equal(health.ondemandLabBeaconAfterFreeze, true)
  assert.equal(health.ondemandNotProductionBeacon, true)
  assert.equal(health.ondemandPublicrpcNotClRandao, true)
  assert.equal(health.ondemandBeaconSource, 'lab-after-freeze')
  assert.equal(selection.freezeBeforeBeacon, true)
  assert.equal(selection.notProductionBeacon, true)
  assert.equal(selection.ondemandLabBeaconAfterFreeze, true)
  assert.equal(selection.ondemandBeaconSource, 'lab-after-freeze')
  engine.stop()
})

test('P19 injected CL view binds; publicrpc is forbidden and falls back to lab-after-freeze', async () => {
  const injected = `0x${'ab'.repeat(32)}` as Hex
  const injectedStore = await tempStore()
  const injectedEngine = createOnDemandEngine({
    domainId: 'fd-01',
    role: 'active',
    peers: [],
    store: injectedStore,
    autoSeedLabMiners: true,
    autoFreeze: true,
    clBeaconProbe: () => probeFinalizedClRandomness({ injectedRandomness: injected, env: {} }),
  })
  await injectedEngine.start()
  const injectedSelection = injectedEngine.selection()
  assert.equal(injectedSelection.available, true)
  if (injectedSelection.available !== true) throw new Error('expected injected selection')
  assert.equal(injectedSelection.beacon, injected)
  assert.equal(injectedEngine.health().ondemandBeaconSource, 'injected-cl-view')
  assert.equal(injectedSelection.ondemandBeaconSource, 'injected-cl-view')
  assert.equal(injectedSelection.ondemandLabBeaconAfterFreeze, false)
  injectedEngine.stop()

  const blocked = probeFinalizedClRandomness({
    clViewUrl: 'https://publicrpc.conet.network',
    env: {},
  })
  assert.equal(blocked.available, false)
  if (blocked.available) throw new Error('expected forbidden probe')
  assert.equal(blocked.reason, 'forbidden_el_rpc_as_cl')

  const blockedStore = await tempStore()
  const blockedEngine = createOnDemandEngine({
    domainId: 'fd-01',
    role: 'active',
    peers: [],
    store: blockedStore,
    autoSeedLabMiners: true,
    autoFreeze: true,
    clBeaconProbe: () =>
      probeFinalizedClRandomness({
        clViewUrl: 'https://publicrpc.conet.network',
        env: {},
      }),
  })
  await blockedEngine.start()
  const blockedSelection = blockedEngine.selection()
  assert.equal(blockedSelection.available, true)
  if (blockedSelection.available !== true) throw new Error('expected blocked fallback selection')
  assert.notEqual(blockedSelection.beacon, injected)
  assert.notEqual(
    blockedSelection.beacon,
    labBeaconAfterFreeze(blockedSelection.poolRoot, blockedSelection.epoch, blockedSelection.shardId),
  )
  assert.equal(blockedEngine.health().ondemandBeaconSource, 'lab-after-freeze')
  assert.equal(blockedEngine.health().ondemandPublicrpcNotClRandao, true)
  blockedEngine.stop()
})

test('P19 keep-only restores disk instant-keccak SelectionLog without rebinding', async () => {
  const store = await tempStore()
  const draw = drawCommittee({ miners: [...LAB_MINERS] })
  const now = new Date().toISOString()
  const instant = labBeaconAfterFreeze(draw.poolRoot, LAB_EPOCH, LAB_SHARD_ID)
  assert.equal(draw.beacon, instant)
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
      note: 'legacy instant keccak selection',
    },
  })
  const engine = createOnDemandEngine({
    domainId: 'fd-01',
    role: 'active',
    peers: [],
    store,
    clBeaconProbe: () => probeFinalizedClRandomness({ env: {} }),
  })
  await engine.start()
  const view = engine.selection()
  assert.equal(view.available, true)
  if (view.available !== true) throw new Error('expected keep-only selection')
  assert.equal(view.endorsed, true)
  assert.equal(view.beacon, instant)
  assert.equal(view.roulette, draw.roulette)
  assert.equal(sameHexList(view.committee, draw.committee), true)
  assert.equal(engine.health().ondemandBeaconSource, 'legacy-instant')
  assert.equal(engine.health().ondemandAttestCount, 4)
  assert.equal(engine.health().ondemandEndorsed, true)
  engine.stop()
})
