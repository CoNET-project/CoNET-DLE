import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createNewChainEngine } from '../src/archive/newchain/engine.js'
import { createHashLookupAdapter } from '../src/archive/hashPipe.js'
import { ERR_INVENTORY_FROZEN, setInventoryCatalogFrozen } from '../src/archive/inventoryFreeze.js'
import { ERR_NEWCHAIN_STANDBY_NOT_READY } from '../src/archive/syncQualification/types.js'
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
  setInventoryCatalogFrozen(false)
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempEngine(domainId = 'fd-newchain', officialStandbysReady?: () => boolean) {
  const dataDir = await mkdtemp(join(tmpdir(), 'dle-newchain-'))
  dirs.push(dataDir)
  const store = openArchiveStore(dataDir)
  const routeTable = labRouteTableFromPeers({ domainId, role: 'active' }, [])
  const engine = createNewChainEngine({ domainId, store, routeTable, officialStandbysReady })
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
  const valueHit = lookup.locate(String(first.body.valueHash))
  assert.equal(valueHit.status, 'notFound')
  const tipHit = lookup.locate(String(first.body.tipStateRoot))
  assert.equal(tipHit.status, 'hit')
  if (tipHit.status === 'hit') {
    assert.equal(tipHit.locator.chainNftId, chainNftId)
    assert.equal(tipHit.locator.kind, 'tipStateRoot')
  }
  const quorum = first.body.validatorQuorum as {
    schema?: string
    quorum?: number
    attestations?: unknown[]
    eip712?: boolean
    hmacForgeable?: boolean
    validatorQuorumEip712?: boolean
  }
  assert.equal(quorum.schema, 'DleLabValidatorQuorumV1')
  assert.equal(quorum.quorum, 5)
  assert.equal(quorum.eip712, true)
  assert.equal(quorum.hmacForgeable, false)
  assert.equal(quorum.validatorQuorumEip712, true)
  assert.equal(Array.isArray(quorum.attestations) && quorum.attestations.length >= 5, true)
  assert.equal(first.body.archiveCertificatePending, true)
  assert.equal(first.body.archiveCertificate, null)
})

test('new-chain accept rejects a fresh request while inventory is frozen', async () => {
  const { engine } = await tempEngine('fd-frozen')
  const existing = makeNewChainRequest({
    classId: LAB_CLASS_ASSET,
    nonce: 2,
    salt: keccak256Utf8('dle.test.newchain.frozen.existing'),
  })
  assert.equal(engine.accept(existing).status, 200)
  setInventoryCatalogFrozen(true, 'challenge-open')
  const duplicate = engine.accept(existing)
  assert.equal(duplicate.status, 200)
  assert.equal(duplicate.body.duplicate, true)
  const fresh = engine.accept(
    makeNewChainRequest({
      classId: LAB_CLASS_TRADE,
      nonce: 3,
      salt: keccak256Utf8('dle.test.newchain.frozen.fresh'),
    }),
  )
  assert.equal(fresh.status, 409)
  assert.equal(fresh.body.error, ERR_INVENTORY_FROZEN)
  setInventoryCatalogFrozen(false)
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
  assert.equal(health.newchainValidatorQuorum, 5)
  assert.equal(health.newchainValidatorQuorumEip712, true)
  assert.equal(health.newchainHmacForgeable, false)
  assert.equal(health.newchainArchivePending, 3)
  assert.equal(health.newchainArchiveCertified, 0)
  const chains = reloaded.list().chains as Array<{ chainNftId: string }>
  for (const row of chains) {
    assert.equal(routeView(reloadedTable, row.chainNftId).groupId, DLE_LAB_GROUP_ID)
  }
  assert.equal(liveGroupCount(reloadedTable), 1)
})

test('new-chain accept waits for official standbys when the callback is present', async () => {
  let ready = false
  const { engine } = await tempEngine('fd-standby-gate', () => ready)
  const request = makeNewChainRequest({
    classId: LAB_CLASS_ASSET,
    nonce: 9,
    salt: keccak256Utf8('dle.test.newchain.standby.gate'),
  })
  const blocked = engine.accept(request)
  assert.equal(blocked.status, 409)
  assert.equal(blocked.body.error, ERR_NEWCHAIN_STANDBY_NOT_READY)
  const health = engine.health()
  assert.equal(health.newchainOfficialStandbysReady, false)
  assert.equal(health.newchainStandbyReadyEip712, true)
  ready = true
  const accepted = engine.accept(request)
  assert.equal(accepted.status, 200)
  assert.equal(accepted.body.ok, true)
  ready = false
  const duplicate = engine.accept(request)
  assert.equal(duplicate.status, 200)
  assert.equal(duplicate.body.duplicate, true)
})

test('live group count stays 1 until a distinct fission groupId appears', () => {
  const table = labRouteTableFromPeers({ domainId: 'fd-fission', role: 'active' }, [])
  assert.equal(liveGroupCount(table), 1)
  table.groups['99'] = { groupId: 'dle.lab.group.v2', wallets: [] }
  assert.equal(liveGroupCount(table), 2)
  assert.deepEqual(liveGroupIds(table), [DLE_LAB_GROUP_ID, 'dle.lab.group.v2'])
})
