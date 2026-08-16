import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHashLookupAdapter, indexLabHashObject, labAcLocator, labPrevoteLocator } from '../src/archive/hashPipe.js'
import { openHashStore } from '../src/archive/hashStore.js'
import { dispatchArchiveJsonRpc } from '../src/archive/jsonrpcFacade.js'
import {
  DLE_LAB_CHAIN_NFT_ID,
  DLE_LAB_GROUP_ID,
  DLE_LAB_GROUP_ID_LEGACY,
  canonicalGroupId,
  hashLookupUnavailable,
  sameGroupId,
} from '../src/shared/hashLookup.js'
import { liveGroupCount, liveGroupIds, routeView } from '../src/shared/labRoute.js'
import {
  CONET_L1_CHAIN_ID,
  DLE_COMMAND,
  DLE_JSONRPC_VERSION,
  DLE_LAB_CHAIN_ID,
  DLE_RUNTIME,
  DLE_TESTNET_CHAIN_NAME,
  chainIdHex,
  type DleArchiveInfo,
} from '../src/shared/protocol.js'

const dataDir = await mkdtemp(join(tmpdir(), 'dle-hash-'))
const store = openHashStore(dataDir)
const lookup = createHashLookupAdapter(store)
const hash = `0x${'ab'.repeat(32)}`
const unknown = `0x${'cd'.repeat(32)}`

after(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

const info: DleArchiveInfo = {
  command: DLE_COMMAND.archive,
  runtime: DLE_RUNTIME.nodejs,
  producesBlocks: false,
  hasTipVm: false,
  l1Isolated: true,
  l1ChainIdForbidden: CONET_L1_CHAIN_ID,
  batchSupported: true,
  chainId: DLE_LAB_CHAIN_ID,
  chainIdHex: chainIdHex(DLE_LAB_CHAIN_ID),
  chainName: DLE_TESTNET_CHAIN_NAME,
  port: 27101,
}

test('hash hit must include chainNftId and never treat a miss as plane-wide null', async () => {
  const indexed = indexLabHashObject(store, labAcLocator(hash, '0x1', hash), { kind: 'ac', height: '0x1' })
  assert.equal(indexed.ok, true)
  const hit = await lookup.get(hash)
  assert.equal(hit.status, 'hit')
  if (hit.status === 'hit') {
    assert.equal(hit.locator.chainNftId, DLE_LAB_CHAIN_NFT_ID)
    assert.equal(hit.locator.kind, 'ac')
    assert.equal(hit.object !== undefined, true)
    assert.equal(hit.hop?.usedLocalFallback, true)
    assert.equal(hit.hop?.labOnly, true)
  }
  const miss = lookup.locate(unknown)
  assert.equal(miss.status, 'notFound')
  if (miss.status === 'notFound') {
    assert.equal(miss.planeWideNull, false)
    assert.equal(miss.scope, 'thisGroup')
  }
})

test('legacy freezer body must not alias as prevoteQc', async () => {
  const legacyHash = `0x${'11'.repeat(32)}`
  const prevoteHash = `0x${'22'.repeat(32)}`
  const legacyBody = { kind: 'ac', height: '0x2', note: 'unmigrated freezer' }
  assert.equal(store.putLocator(labAcLocator(legacyHash, '0x2', legacyHash)).ok, true)
  assert.equal(store.putBody(DLE_LAB_CHAIN_NFT_ID, '0x2', legacyBody).ok, true)
  assert.equal(store.putLocator(labPrevoteLocator(prevoteHash, '0x2', legacyHash)).ok, true)
  const acHit = await lookup.get(legacyHash)
  assert.equal(acHit.status, 'hit')
  if (acHit.status === 'hit') {
    assert.equal(acHit.locator.kind, 'ac')
    assert.equal((acHit.object as { note?: string }).note, 'unmigrated freezer')
  }
  const leaked = await lookup.get(prevoteHash)
  assert.equal(leaked.status, 'unavailable')
  if (leaked.status === 'unavailable') {
    assert.equal(leaked.planeWideNull, false)
  }
})

test('prevoteQc is a first-class kind, not an AC field alias', async () => {
  const prevoteHash = `0x${'7e'.repeat(32)}`
  const indexed = indexLabHashObject(
    store,
    labPrevoteLocator(prevoteHash, '0x1', hash),
    { schema: 'DleLabPrevoteQcV1', kind: 1, qcRef: prevoteHash },
  )
  assert.equal(indexed.ok, true)
  const hit = await lookup.get(prevoteHash)
  assert.equal(hit.status, 'hit')
  if (hit.status === 'hit') {
    assert.equal(hit.locator.kind, 'prevoteQc')
    assert.equal(hit.locator.acRef, hash)
    assert.equal((hit.object as { qcRef?: string }).qcRef, prevoteHash)
  }
  const tipAlias = lookup.locate(`0x${'08'.repeat(32)}`)
  assert.equal(tipAlias.status, 'notFound')
})

test('same hash on a second chainNftId fails closed', () => {
  const conflict = store.putLocator({
    schema: 'HashLocatorV1',
    hash,
    chainNftId: '99',
    kind: 'ac',
    height: '0x1',
  })
  assert.equal(conflict.ok, false)
  if (!conflict.ok) assert.equal(conflict.error, 'ERR_HASH_NFT_CONFLICT')
})

test('JSON-RPC hash methods return this-group notFound instead of null', async () => {
  const locate = await dispatchArchiveJsonRpc(
    { jsonrpc: DLE_JSONRPC_VERSION, id: 1, method: 'dle_locateHash', params: [unknown] },
    info,
    undefined,
    lookup,
  )
  assert.equal('result' in locate, true)
  if ('result' in locate) {
    const body = locate.result as { status?: string; planeWideNull?: boolean; scope?: string }
    assert.equal(body.status, 'notFound')
    assert.equal(body.planeWideNull, false)
    assert.equal(body.scope, 'thisGroup')
  }
  const block = await dispatchArchiveJsonRpc(
    { jsonrpc: DLE_JSONRPC_VERSION, id: 2, method: 'eth_getBlockByHash', params: [unknown, false] },
    info,
    undefined,
    lookup,
  )
  assert.equal('result' in block && block.result !== null, true)
  if ('result' in block && block.result !== null && typeof block.result === 'object') {
    const body = block.result as { status?: string }
    assert.equal(body.status, 'notFound')
  }
  const noLookup = await dispatchArchiveJsonRpc(
    { jsonrpc: DLE_JSONRPC_VERSION, id: 3, method: 'eth_getBlockByHash', params: [unknown, false] },
    info,
  )
  assert.equal('result' in noLookup && noLookup.result !== null, true)
  const stub = hashLookupUnavailable('x')
  assert.equal(stub.planeWideNull, false)
})

test('bootstrap Group ID is the L1 register tx hash; legacy strings alias it', () => {
  assert.equal(canonicalGroupId(DLE_LAB_GROUP_ID_LEGACY), DLE_LAB_GROUP_ID)
  assert.equal(canonicalGroupId('1'), DLE_LAB_GROUP_ID)
  assert.equal(canonicalGroupId('0x1'), DLE_LAB_GROUP_ID)
  assert.equal(sameGroupId(DLE_LAB_GROUP_ID_LEGACY, DLE_LAB_GROUP_ID), true)
  assert.equal(sameGroupId('dle.lab.group.v2', DLE_LAB_GROUP_ID), false)
})

test('hashStore migrates a legacy groupId locator to the register hash without conflict', () => {
  const migrated = `0x${'ef'.repeat(32)}`
  const first = store.putLocator({
    schema: 'HashLocatorV1',
    hash: migrated,
    chainNftId: DLE_LAB_CHAIN_NFT_ID,
    kind: 'ac',
    height: '0x9',
    groupId: DLE_LAB_GROUP_ID_LEGACY,
  })
  assert.equal(first.ok, true)
  const second = store.putLocator({
    schema: 'HashLocatorV1',
    hash: migrated,
    chainNftId: DLE_LAB_CHAIN_NFT_ID,
    kind: 'ac',
    height: '0x9',
    groupId: DLE_LAB_GROUP_ID,
  })
  assert.equal(second.ok, true)
  assert.equal(store.getLocator(migrated)?.groupId, DLE_LAB_GROUP_ID)
})

test('routeView and liveGroupIds emit the hash even if the table still stores v1', () => {
  const table = {
    schema: 'DleLabRouteTableV1' as const,
    labOnly: true as const,
    notProductionDepin: true as const,
    l1RouteUnproven: true as const,
    ownGroupId: DLE_LAB_GROUP_ID_LEGACY,
    selfDomainId: 'a1',
    groups: {
      [DLE_LAB_CHAIN_NFT_ID]: {
        groupId: DLE_LAB_GROUP_ID_LEGACY,
        wallets: [],
      },
      '99': {
        groupId: DLE_LAB_GROUP_ID,
        wallets: [],
      },
    },
  }
  assert.equal(routeView(table, DLE_LAB_CHAIN_NFT_ID).groupId, DLE_LAB_GROUP_ID)
  assert.deepEqual(liveGroupIds(table), [DLE_LAB_GROUP_ID])
  assert.equal(liveGroupCount(table), 1)
})
