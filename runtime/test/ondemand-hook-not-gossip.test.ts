import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createOnDemandEngine } from '../src/archive/ondemand/engine.js'
import { makeLabPoolAttest } from '../src/archive/ondemand/mac.js'
import { openArchiveStore } from '../src/archive/store.js'
import { submitWaitHook, submitWaitHookToArchives } from '../src/daemon/core.js'
import {
  ERR_ONDEMAND_HOOK_NOT_GOSSIP,
  LAB_DAEMON_PROBE_MINER,
  LAB_EPOCH,
  LAB_GROUP_ID,
  LAB_HOOK_FANOUT_INCOMPLETE_NOTE,
  LAB_HOOK_QUEUED_NOTE,
  LAB_HOOK_SINGLE_ARCHIVE_NOTE,
  LAB_SHARD_ID,
} from '../src/shared/ondemand/index.js'

const dirs: string[] = []

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempStore() {
  const dataDir = await mkdtemp(join(tmpdir(), 'dle-p20-hook-'))
  dirs.push(dataDir)
  return openArchiveStore(dataDir)
}

test('P20 health and hook response refuse intra-group hook gossip', async () => {
  const engine = createOnDemandEngine({
    domainId: 'fd-01',
    role: 'active',
    peers: [],
    store: await tempStore(),
    autoSeedLabMiners: false,
    autoFreeze: false,
  })
  await engine.start()
  const health = engine.health()
  assert.equal(health.ondemandHookNotGossip, true)
  assert.equal(health.ondemandMustFanoutToEveryActiveArchive, true)
  assert.equal(health.ondemandNotProductionDepinGossip, true)
  const hooked = engine.hook({
    schema: 'DleOnDemandHookV1',
    miner: LAB_DAEMON_PROBE_MINER,
    groupId: LAB_GROUP_ID,
  })
  assert.equal(hooked.status, 200)
  const body = hooked.body as {
    note?: string
    notGossiped?: boolean
    mustFanoutToEveryActiveArchive?: boolean
    notProductionDepinGossip?: boolean
  }
  assert.equal(body.note, LAB_HOOK_QUEUED_NOTE)
  assert.equal(body.notGossiped, true)
  assert.equal(body.mustFanoutToEveryActiveArchive, true)
  assert.equal(body.notProductionDepinGossip, true)
  const pool = engine.pool()
  assert.equal(pool.hookNotGossip, true)
  assert.equal(pool.mustFanoutToEveryActiveArchive, true)
  assert.equal(pool.notProductionDepinGossip, true)
  engine.stop()
})

test('P20 ingest rejects miner or hook payloads and does not merge them', async () => {
  const engine = createOnDemandEngine({
    domainId: 'fd-02',
    role: 'active',
    peers: [],
    store: await tempStore(),
    autoSeedLabMiners: false,
    autoFreeze: false,
  })
  await engine.start()
  const poisoned = engine.ingest({
    schema: 'DleLabOnDemandMessageV1',
    from: 'fd-01',
    miners: [LAB_DAEMON_PROBE_MINER],
    attests: [],
  })
  assert.equal(poisoned.ok, false)
  assert.equal(poisoned.error, ERR_ONDEMAND_HOOK_NOT_GOSSIP)
  assert.equal(engine.pool().minerCount, 0)
  assert.equal(
    engine.ingest({
      schema: 'DleLabOnDemandMessageV1',
      hooks: [{ miner: LAB_DAEMON_PROBE_MINER }],
    }).error,
    ERR_ONDEMAND_HOOK_NOT_GOSSIP,
  )
  assert.equal(
    engine.ingest({
      schema: 'DleLabOnDemandMessageV1',
      hook: { miner: LAB_DAEMON_PROBE_MINER },
    }).error,
    ERR_ONDEMAND_HOOK_NOT_GOSSIP,
  )
  assert.equal(engine.pool().minerCount, 0)
  engine.stop()
})

test('P20 gossip of attests and selection does not carry a wait-hook miner', async () => {
  let captured: Record<string, unknown> | null = null
  const sender = createOnDemandEngine({
    domainId: 'fd-01',
    role: 'active',
    peers: [{ domainId: 'fd-02', host: '127.0.0.1', port: 9, role: 'active' }],
    store: await tempStore(),
    autoSeedLabMiners: false,
    autoFreeze: false,
    fetchImpl: async (_url, init) => {
      captured = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      return new Response('{}', { status: 200 })
    },
  })
  const receiver = createOnDemandEngine({
    domainId: 'fd-02',
    role: 'active',
    peers: [],
    store: await tempStore(),
    autoSeedLabMiners: false,
    autoFreeze: false,
  })
  await sender.start()
  await receiver.start()
  assert.equal(
    sender.hook({
      schema: 'DleOnDemandHookV1',
      miner: LAB_DAEMON_PROBE_MINER,
      groupId: LAB_GROUP_ID,
    }).status,
    200,
  )
  const started = Date.now()
  while (captured === null && Date.now() - started < 2_000) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.ok(captured)
  assert.equal(captured.schema, 'DleLabOnDemandMessageV1')
  assert.equal(Array.isArray(captured.miners), false)
  assert.equal(receiver.ingest(captured).ok, true)
  assert.equal(sender.pool().miners.includes(LAB_DAEMON_PROBE_MINER), true)
  assert.equal(receiver.pool().miners.includes(LAB_DAEMON_PROBE_MINER), false)
  sender.stop()
  receiver.stop()
})

test('P20 missing one archive hook yields a different poolRoot; peer attest does not endorse', async () => {
  const withHook = createOnDemandEngine({
    domainId: 'fd-01',
    role: 'active',
    peers: [],
    store: await tempStore(),
    autoSeedLabMiners: true,
    autoFreeze: false,
  })
  const withoutHook = createOnDemandEngine({
    domainId: 'fd-02',
    role: 'active',
    peers: [],
    store: await tempStore(),
    autoSeedLabMiners: true,
    autoFreeze: false,
  })
  await withHook.start()
  await withoutHook.start()
  assert.equal(
    withHook.hook({
      schema: 'DleOnDemandHookV1',
      miner: LAB_DAEMON_PROBE_MINER,
      groupId: LAB_GROUP_ID,
    }).status,
    200,
  )
  assert.equal(withHook.freeze().status, 200)
  assert.equal(withoutHook.freeze().status, 200)
  const left = withHook.selection()
  const right = withoutHook.selection()
  assert.equal(left.available, true)
  assert.equal(right.available, true)
  if (left.available !== true || right.available !== true) throw new Error('expected selections')
  assert.notEqual(left.poolRoot, right.poolRoot)
  const attest = makeLabPoolAttest({
    domainId: 'fd-01',
    poolRoot: left.poolRoot,
    epoch: LAB_EPOCH,
    shardId: LAB_SHARD_ID,
    roulette: left.roulette,
  })
  assert.equal(withoutHook.ingest({ schema: 'DleLabOnDemandMessageV1', attests: [attest] }).error, 'ERR_ATTEST_MISMATCH')
  assert.equal(withoutHook.pool().miners.includes(LAB_DAEMON_PROBE_MINER), false)
  withHook.stop()
  withoutHook.stop()
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const emptyPool = {
  schema: 'DleWaitingPoolV1',
  groupId: LAB_GROUP_ID,
  epoch: LAB_EPOCH,
  shardId: LAB_SHARD_ID,
  frozen: false,
  miners: [] as string[],
  poolRoot: null,
  minerCount: 0,
}

const unavailableSelection = {
  schema: 'DleLabSelectionLogV1',
  available: false,
  reason: 'Waiting pool is not frozen yet.',
}

test('P20 daemon single-archive accept is not a group pool', async () => {
  const previous = globalThis.fetch
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/ondemand/hook')) {
      return jsonResponse({
        ok: true,
        status: 'queued',
        miner: LAB_DAEMON_PROBE_MINER,
        groupId: LAB_GROUP_ID,
      })
    }
    if (url.endsWith('/ondemand/pool')) {
      return jsonResponse({
        ...emptyPool,
        miners: [LAB_DAEMON_PROBE_MINER],
        minerCount: 1,
      })
    }
    if (url.endsWith('/ondemand/selection')) return jsonResponse(unavailableSelection)
    throw new Error(`unexpected fetch ${url}`)
  }
  try {
    const session = await submitWaitHook('http://a:27101', LAB_DAEMON_PROBE_MINER)
    assert.equal(session.status, 'queued')
    assert.equal(session.fanoutComplete, false)
    assert.equal(session.singleArchiveAcceptNotGroupPool, true)
    assert.equal(session.hookNotGossip, true)
    assert.equal(session.note, LAB_HOOK_SINGLE_ARCHIVE_NOTE)
  } finally {
    globalThis.fetch = previous
  }
})

test('P20 daemon fan-out is incomplete when one archive misses the hook', async () => {
  const previous = globalThis.fetch
  let aHasMiner = false
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.startsWith('http://a:27101/ondemand/hook') && method === 'POST') {
      aHasMiner = true
      return jsonResponse({ ok: true, status: 'queued', miner: LAB_DAEMON_PROBE_MINER, groupId: LAB_GROUP_ID })
    }
    if (url.startsWith('http://b:27101/ondemand/hook') && method === 'POST') {
      return jsonResponse({ ok: false, status: 'rejected', error: 'ERR_DUPLICATE_HOOK' }, 409)
    }
    if (url.endsWith('/ondemand/pool')) {
      if (url.startsWith('http://a:27101') && aHasMiner) {
        return jsonResponse({ ...emptyPool, miners: [LAB_DAEMON_PROBE_MINER], minerCount: 1 })
      }
      return jsonResponse(emptyPool)
    }
    if (url.endsWith('/ondemand/selection')) return jsonResponse(unavailableSelection)
    throw new Error(`unexpected fetch ${url}`)
  }
  try {
    const session = await submitWaitHookToArchives(
      ['http://a:27101', 'http://b:27101'],
      LAB_DAEMON_PROBE_MINER,
    )
    assert.equal(session.status, 'rejected')
    assert.equal(session.fanoutComplete, false)
    assert.equal(session.note, LAB_HOOK_FANOUT_INCOMPLETE_NOTE)
    assert.equal(session.archives[0]?.status, 'queued')
    assert.equal(session.archives[1]?.status, 'rejected')
  } finally {
    globalThis.fetch = previous
  }
})
