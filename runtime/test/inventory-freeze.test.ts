import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { indexLabHashObject, labChainObjectLocator } from '../src/archive/hashPipe.js'
import {
  ERR_INVENTORY_FROZEN,
  ERR_OPERATOR_INVENTORY_FREEZE_REQUIRED,
  OPERATOR_INVENTORY_FREEZE_FILENAME,
  OPERATOR_INVENTORY_FREEZE_SCHEMA,
  loadOperatorInventoryFreeze,
  operatorInventoryFrozen,
  parseOperatorInventoryFreezePost,
  persistOperatorInventoryFreeze,
  resetInventoryFreezeForTests,
  resolveInventoryFreezeState,
  setInventoryCatalogFrozen,
  setOperatorInventoryFreeze,
} from '../src/archive/inventoryFreeze.js'
import { openArchiveStore, type ArchiveStore } from '../src/archive/store.js'
import { createSyncQualificationEngine } from '../src/archive/syncQualification/index.js'
import { keccak256Utf8 } from '../src/shared/bytes.js'
import { DLE_LAB_GROUP_ID } from '../src/shared/hashLookup.js'
import { labRouteTableFromPeers } from '../src/shared/labRoute.js'

const dirs: string[] = []

after(async () => {
  resetInventoryFreezeForTests()
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempStore(): Promise<ArchiveStore> {
  const dir = await mkdtemp(join(tmpdir(), 'dle-freeze-'))
  dirs.push(dir)
  return openArchiveStore(dir)
}

function h(label: string): string {
  return keccak256Utf8(`dle.lab.freeze.test|${label}`)
}

test('frozen catalogue rejects new locators and still allows first-write-wins plus catch-up putLocator', async () => {
  setInventoryCatalogFrozen(false)
  const store = await tempStore()
  const existingHash = h('existing')
  const locator = labChainObjectLocator('block', existingHash, '42', '0x1', h('ac'), DLE_LAB_GROUP_ID)
  assert.equal(indexLabHashObject(store.hash, locator, { kind: 'block', hash: existingHash }).ok, true)
  setInventoryCatalogFrozen(true, 'unseated-active')
  const replay = indexLabHashObject(store.hash, locator, { kind: 'block', hash: existingHash })
  assert.equal(replay.ok, true)
  const freshHash = h('fresh')
  const frozen = indexLabHashObject(
    store.hash,
    labChainObjectLocator('block', freshHash, '42', '0x2', h('ac'), DLE_LAB_GROUP_ID),
    { kind: 'block', hash: freshHash },
  )
  assert.equal(frozen.ok, false)
  if (!frozen.ok) assert.equal(frozen.error, ERR_INVENTORY_FROZEN)
  const catchUp = h('catch-up')
  assert.equal(
    store.hash.putLocator(labChainObjectLocator('block', catchUp, '42', '0x3', h('ac'), DLE_LAB_GROUP_ID)).ok,
    true,
  )
  setInventoryCatalogFrozen(false)
})

test('inventoryShouldFreeze is true while the local active is unseated', async () => {
  setInventoryCatalogFrozen(false)
  const store = await tempStore()
  const engine = createSyncQualificationEngine({
    domainId: 'a1',
    role: 'active',
    peers: [],
    store,
    table: labRouteTableFromPeers(
      { domainId: 'a1', role: 'active' },
      [],
      { ownGroupId: DLE_LAB_GROUP_ID },
    ),
    tickMs: 10_000,
  })
  assert.equal(engine.inventoryShouldFreeze(), true)
  assert.equal(engine.hasUnseatedActive(), true)
})

test('operator freeze stays sticky over auto-unfreeze, persists, and still allows catch-up putLocator', async () => {
  resetInventoryFreezeForTests()
  const dir = await mkdtemp(join(tmpdir(), 'dle-operator-freeze-'))
  dirs.push(dir)
  persistOperatorInventoryFreeze(dir, true)
  const persisted = JSON.parse(readFileSync(join(dir, OPERATOR_INVENTORY_FREEZE_FILENAME), 'utf8')) as {
    schema: string
    frozen: boolean
    reason: string
  }
  assert.equal(persisted.schema, OPERATOR_INVENTORY_FREEZE_SCHEMA)
  assert.equal(persisted.frozen, true)
  assert.equal(persisted.reason, 'operator')
  assert.equal(loadOperatorInventoryFreeze(dir), true)
  assert.equal(operatorInventoryFrozen(), true)
  const sticky = resolveInventoryFreezeState(false)
  assert.equal(sticky.frozen, true)
  assert.equal(sticky.reason, 'operator')
  setInventoryCatalogFrozen(sticky.frozen, sticky.reason)
  const store = await openArchiveStore(dir)
  const freshHash = h('operator-fresh')
  const frozen = indexLabHashObject(
    store.hash,
    labChainObjectLocator('block', freshHash, '42', '0x2', h('ac'), DLE_LAB_GROUP_ID),
    { kind: 'block', hash: freshHash },
  )
  assert.equal(frozen.ok, false)
  if (!frozen.ok) assert.equal(frozen.error, ERR_INVENTORY_FROZEN)
  const catchUp = h('operator-catch-up')
  assert.equal(
    store.hash.putLocator(labChainObjectLocator('block', catchUp, '42', '0x3', h('ac'), DLE_LAB_GROUP_ID)).ok,
    true,
  )
  persistOperatorInventoryFreeze(dir, false)
  assert.equal(existsSync(join(dir, OPERATOR_INVENTORY_FREEZE_FILENAME)), false)
  assert.equal(loadOperatorInventoryFreeze(dir), false)
  resetInventoryFreezeForTests()
})

test('operator freeze HTTP accepts only frozen:true', () => {
  resetInventoryFreezeForTests()
  assert.deepEqual(parseOperatorInventoryFreezePost({ frozen: true }), { ok: true, frozen: true })
  assert.deepEqual(parseOperatorInventoryFreezePost({ frozen: false }), {
    ok: false,
    error: ERR_OPERATOR_INVENTORY_FREEZE_REQUIRED,
  })
  assert.equal(parseOperatorInventoryFreezePost(null).ok, false)
  setOperatorInventoryFreeze(false)
})
