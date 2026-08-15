import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createOnDemandEngine } from '../src/archive/ondemand/engine.js'
import { openArchiveStore } from '../src/archive/store.js'
import {
  HTTP_QUEUE_CLIENT_COUNT,
  HTTP_QUEUE_MINERS,
  LAB_GROUP_ID,
  httpQueueMiner,
  httpQueueMinersPresent,
} from '../src/shared/ondemand/index.js'

const dirs: string[] = []

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempStore() {
  const dataDir = await mkdtemp(join(tmpdir(), 'dle-http-queue-'))
  dirs.push(dataDir)
  return openArchiveStore(dataDir)
}

test('http queue miners are 30 distinct 0xb110 addresses', () => {
  assert.equal(HTTP_QUEUE_CLIENT_COUNT, 30)
  assert.equal(HTTP_QUEUE_MINERS.length, 30)
  assert.equal(httpQueueMiner(1), '0xb110000000000000000000000000000000000001')
  assert.equal(httpQueueMiner(30), '0xb11000000000000000000000000000000000001e')
  assert.equal(new Set(HTTP_QUEUE_MINERS.map((row) => row.toLowerCase())).size, 30)
  assert.equal(httpQueueMinersPresent(HTTP_QUEUE_MINERS), true)
  assert.equal(httpQueueMinersPresent(HTTP_QUEUE_MINERS.slice(0, 29)), false)
  assert.throws(() => httpQueueMiner(0))
  assert.throws(() => httpQueueMiner(31))
})

test('empty HTTP queue archive does not auto-seed or auto-freeze', async () => {
  const store = await tempStore()
  const engine = createOnDemandEngine({
    domainId: 'fd-http',
    role: 'active',
    peers: [],
    store,
    autoSeedLabMiners: false,
    autoFreeze: false,
  })
  await engine.start()
  assert.equal(engine.pool().frozen, false)
  assert.equal(engine.pool().minerCount, 0)
  engine.stop()
})

test('30 HTTP queue miners can hook then freeze into 7+2', async () => {
  const store = await tempStore()
  const engine = createOnDemandEngine({
    domainId: 'fd-http',
    role: 'active',
    peers: [],
    store,
    autoSeedLabMiners: false,
    autoFreeze: false,
  })
  await engine.start()
  for (const miner of HTTP_QUEUE_MINERS) {
    const hooked = engine.hook({ schema: 'DleOnDemandHookV1', miner, groupId: LAB_GROUP_ID })
    assert.equal(hooked.status, 200)
  }
  assert.equal(engine.pool().minerCount, 30)
  assert.equal(httpQueueMinersPresent(engine.pool().miners), true)
  const frozen = engine.freeze()
  assert.equal(frozen.status, 200)
  const selection = engine.selection()
  assert.equal(selection.available, true)
  if (selection.available) {
    assert.equal(selection.committee.length, 7)
    assert.equal(selection.standbys.length, 2)
    assert.equal(selection.labBeacon, true)
    assert.match(selection.note, /Not 30-day qualification/u)
  }
  const late = engine.hook({
    schema: 'DleOnDemandHookV1',
    miner: '0xb11000000000000000000000000000000000001f',
    groupId: LAB_GROUP_ID,
  })
  assert.equal(late.status, 409)
  engine.stop()
})
