import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { indexLabHashObject, labChainObjectLocator } from '../src/archive/hashPipe.js'
import {
  ERR_INVENTORY_FROZEN,
  setInventoryCatalogFrozen,
} from '../src/archive/inventoryFreeze.js'
import { openArchiveStore, type ArchiveStore } from '../src/archive/store.js'
import { createSyncQualificationEngine } from '../src/archive/syncQualification/index.js'
import { keccak256Utf8 } from '../src/shared/bytes.js'
import { DLE_LAB_GROUP_ID } from '../src/shared/hashLookup.js'
import { labRouteTableFromPeers } from '../src/shared/labRoute.js'

const dirs: string[] = []

after(async () => {
  setInventoryCatalogFrozen(false)
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
