import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createNewChainEngine } from '../src/archive/newchain/engine.js'
import { createHashLookupAdapter } from '../src/archive/hashPipe.js'
import { openArchiveStore } from '../src/archive/store.js'
import { DLE_LAB_CHAIN_NFT_ID, DLE_LAB_GROUP_ID } from '../src/shared/hashLookup.js'
import { labRouteTableFromPeers, liveGroupCount, liveGroupIds, routeView } from '../src/shared/labRoute.js'
import { keccak256Utf8 } from '../src/shared/bytes.js'
import {
  LAB_CLASS_ASSET,
  LAB_CLASS_STORAGE,
  LAB_CLASS_TRADE,
  labChainNftIdFromRequestId,
  makeNewChainRequest,
  newChainRequestId,
} from '../src/shared/newchain.js'

const dirs: string[] = []

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempEngine(domainId = 'fd-newchain') {
  const dataDir = await mkdtemp(join(tmpdir(), 'dle-newchain-'))
  dirs.push(dataDir)
  const store = openArchiveStore(dataDir)
  const routeTable = labRouteTableFromPeers({ domainId, role: 'active' }, [])
  const engine = createNewChainEngine({ domainId, store, routeTable })
  return { store, routeTable, engine, dataDir, domainId }
}

test('requestId ignores createdAt and never derives NFT 42', () => {
  const salt = keccak256Utf8('dle.test.newchain.createdAt')
  const left = makeNewChainRequest({ classId: LAB_CLASS_ASSET, nonce: 7, salt, createdAt: '2026-08-15T00:00:00.000Z' })
  const right = makeNewChainRequest({ classId: LAB_CLASS_ASSET, nonce: 7, salt, createdAt: '2026-08-16T00:00:00.000Z' })
  const requestId = newChainRequestId(left)
  assert.equal(requestId, newChainRequestId(right))
  assert.notEqual(labChainNftIdFromRequestId(requestId), DLE_LAB_CHAIN_NFT_ID)
  for (let i = 0; i < 64; i += 1) {
    const id = newChainRequestId(
      makeNewChainRequest({ classId: LAB_CLASS_TRADE, nonce: i, salt: keccak256Utf8(`dle.test.nft42|${i}`) }),
    )
    assert.notEqual(labChainNftIdFromRequestId(id), DLE_LAB_CHAIN_NFT_ID)
  }
})

test('new-chain accept is idempotent and registers a lab route', async () => {
  const { engine, routeTable, store } = await tempEngine()
  const request = makeNewChainRequest({
    classId: LAB_CLASS_STORAGE,
    nonce: 1,
    salt: keccak256Utf8('dle.test.newchain.accept'),
  })
  const first = engine.accept(request)
  assert.equal(first.status, 200)
  assert.equal(first.body.ok, true)
  assert.equal(first.body.duplicate, false)
  assert.equal(first.body.notL1Nft, true)
  const chainNftId = String(first.body.chainNftId)
  assert.notEqual(chainNftId, DLE_LAB_CHAIN_NFT_ID)
  assert.equal(routeView(routeTable, chainNftId).groupId, DLE_LAB_GROUP_ID)
  assert.equal(routeView(routeTable, DLE_LAB_CHAIN_NFT_ID).groupId, DLE_LAB_GROUP_ID)
  assert.equal(liveGroupCount(routeTable), 1)
  assert.deepEqual(liveGroupIds(routeTable), [DLE_LAB_GROUP_ID])
  const second = engine.accept(request)
  assert.equal(second.status, 200)
  assert.equal(second.body.duplicate, true)
  assert.equal(second.body.chainNftId, chainNftId)
  const lookup = createHashLookupAdapter(store.hash, { table: routeTable })
  const hit = lookup.locate(String(first.body.valueHash))
  assert.equal(hit.status, 'hit')
  if (hit.status === 'hit') {
    assert.equal(hit.locator.chainNftId, chainNftId)
    assert.equal(hit.locator.kind, 'ac')
  }
})

test('asset, storage, and trade genesis each persist and reload', async () => {
  const first = await tempEngine('fd-reload')
  const classes = [LAB_CLASS_ASSET, LAB_CLASS_STORAGE, LAB_CLASS_TRADE] as const
  for (const [index, classId] of classes.entries()) {
    const accepted = first.engine.accept(
      makeNewChainRequest({
        classId,
        nonce: index + 1,
        salt: keccak256Utf8(`dle.test.newchain.class|${classId}`),
      }),
    )
    assert.equal(accepted.status, 200, String(accepted.body.error))
    assert.equal(accepted.body.ok, true)
  }
  assert.equal(first.engine.list().count, 3)
  const reloadedTable = labRouteTableFromPeers({ domainId: 'fd-reload', role: 'active' }, [])
  const reloaded = createNewChainEngine({
    domainId: 'fd-reload',
    store: first.store,
    routeTable: reloadedTable,
  })
  assert.equal(reloaded.list().count, 3)
  const health = reloaded.health()
  assert.deepEqual(health.newchainByClass, { asset: 1, storage: 1, trade: 1 })
  const chains = reloaded.list().chains as Array<{ chainNftId: string }>
  for (const row of chains) {
    assert.equal(routeView(reloadedTable, row.chainNftId).groupId, DLE_LAB_GROUP_ID)
  }
  assert.equal(liveGroupCount(reloadedTable), 1)
})

test('live group count stays 1 until a distinct fission groupId appears', () => {
  const table = labRouteTableFromPeers({ domainId: 'fd-fission', role: 'active' }, [])
  assert.equal(liveGroupCount(table), 1)
  table.groups['99'] = { groupId: 'dle.lab.group.v2', wallets: [] }
  assert.equal(liveGroupCount(table), 2)
  assert.deepEqual(liveGroupIds(table), [DLE_LAB_GROUP_ID, 'dle.lab.group.v2'])
})
