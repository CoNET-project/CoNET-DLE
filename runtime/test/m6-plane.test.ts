import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createHashLookupAdapter,
  indexLabHashObject,
  labAcLocator,
  seedLabFissionMarker,
} from '../src/archive/hashPipe.js'
import { openHashStore } from '../src/archive/hashStore.js'
import {
  dispatchArchiveJsonRpc,
  emptyCertificateView,
  emptyTipView,
} from '../src/archive/jsonrpcFacade.js'
import {
  DLE_LAB_GROUP_ID,
  DLE_LAB_M6_GROUP_ID,
  DLE_LAB_M6_MARKER_HASH,
  DLE_LAB_M6_MARKER_NFT_ID,
  hashLookupNotFound,
  labFissionMarkerHash,
} from '../src/shared/hashLookup.js'
import { labRouteTableFromPeers, liveGroupCount, liveGroupIds } from '../src/shared/labRoute.js'
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

const root = await mkdtemp(join(tmpdir(), 'dle-m6-'))

after(async () => {
  await rm(root, { recursive: true, force: true })
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

const views = { tip: emptyTipView(), certificate: emptyCertificateView() }
const unknown = `0x${'ee'.repeat(32)}`

function twoGroupTable() {
  return labRouteTableFromPeers(
    { domainId: 'g1-a', role: 'active', url: 'http://127.0.0.1:27101' },
    [{ domainId: 'g1-b', host: '127.0.0.1', port: 27102, role: 'active' }],
    {
      planeDirectory: [
        {
          groupId: DLE_LAB_M6_GROUP_ID,
          wallets: [
            { domainId: 'g2-a', role: 'active', url: 'http://127.0.0.1:37101', labOnly: true },
          ],
        },
      ],
    },
  )
}

test('lab fission marker hash is the documented G2 constant', () => {
  assert.equal(labFissionMarkerHash(DLE_LAB_M6_GROUP_ID), DLE_LAB_M6_MARKER_HASH)
})

test('Ge=1 completed miss stays this-group notFound', async () => {
  const store = openHashStore(join(root, 'g1-only'))
  const lookup = createHashLookupAdapter(store)
  const miss = await lookup.locatePlane(unknown)
  assert.equal(miss.status, 'notFound')
  if (miss.status === 'notFound') {
    assert.equal(miss.planeWideNull, false)
    assert.equal(miss.scope, 'thisGroup')
  }
  const block = await dispatchArchiveJsonRpc(
    { jsonrpc: DLE_JSONRPC_VERSION, id: 1, method: 'eth_getBlockByHash', params: [unknown, false] },
    info,
    views,
    lookup,
  )
  assert.equal('result' in block && block.result !== null, true)
})

test('planeDirectory raises liveGroupCount to 2 without adding Clusters on new lab chains', () => {
  const table = twoGroupTable()
  assert.equal(liveGroupCount(table), 2)
  assert.deepEqual(liveGroupIds(table).sort(), [DLE_LAB_GROUP_ID, DLE_LAB_M6_GROUP_ID].sort())
})

test('Ge=2 thisGroupOnly never upgrades a miss to plane-wide null', async () => {
  const store = openHashStore(join(root, 'this-group-only'))
  const lookup = createHashLookupAdapter(store, { table: twoGroupTable(), fetchLocate: async () => {
    throw new Error('must not gather other groups')
  } })
  const miss = await lookup.locatePlane(unknown, { thisGroupOnly: true })
  assert.equal(miss.status, 'notFound')
  if (miss.status === 'notFound') {
    assert.equal(miss.planeWideNull, false)
    assert.equal(miss.scope, 'thisGroup')
  }
})

test('Ge=2 trusted notFound from every live group becomes planeWideNull', async () => {
  const store = openHashStore(join(root, 'plane-null'))
  const seen: string[] = []
  const lookup = createHashLookupAdapter(store, {
    table: twoGroupTable(),
    fetchLocate: async (url, hash) => {
      seen.push(url)
      return hashLookupNotFound(hash)
    },
  })
  const miss = await lookup.locatePlane(unknown)
  assert.equal(miss.status, 'notFound')
  if (miss.status === 'notFound') {
    assert.equal(miss.planeWideNull, true)
    assert.equal(miss.scope, 'allLiveGroups')
    assert.equal(miss.groupsChecked?.includes(DLE_LAB_GROUP_ID), true)
    assert.equal(miss.groupsChecked?.includes(DLE_LAB_M6_GROUP_ID), true)
  }
  assert.deepEqual(seen, ['http://127.0.0.1:37101'])
  const block = await dispatchArchiveJsonRpc(
    { jsonrpc: DLE_JSONRPC_VERSION, id: 2, method: 'eth_getBlockByHash', params: [unknown, false] },
    info,
    views,
    lookup,
  )
  assert.equal('result' in block && block.result === null, true)
  const tx = await dispatchArchiveJsonRpc(
    { jsonrpc: DLE_JSONRPC_VERSION, id: 3, method: 'eth_getTransactionByHash', params: [unknown] },
    info,
    views,
    lookup,
  )
  assert.equal('result' in tx && tx.result === null, true)
})

test('one live group timeout is unavailable, not plane-wide null', async () => {
  const store = openHashStore(join(root, 'timeout'))
  const lookup = createHashLookupAdapter(store, {
    table: twoGroupTable(),
    fetchLocate: async () => null,
  })
  const miss = await lookup.locatePlane(unknown)
  assert.equal(miss.status, 'unavailable')
  if (miss.status === 'unavailable') {
    assert.equal(miss.planeWideNull, false)
  }
  const block = await dispatchArchiveJsonRpc(
    { jsonrpc: DLE_JSONRPC_VERSION, id: 4, method: 'eth_getBlockByHash', params: [unknown, false] },
    info,
    views,
    lookup,
  )
  assert.equal('result' in block && block.result !== null, true)
  if ('result' in block && block.result !== null && typeof block.result === 'object') {
    assert.equal((block.result as { status?: string }).status, 'unavailable')
  }
})

test('foreign hop failure must not use a local replica as RPC truth', async () => {
  const store = openHashStore(join(root, 'foreign-hop'))
  const hash = `0x${'aa'.repeat(32)}`
  const table = labRouteTableFromPeers(
    { domainId: 'g1-a', role: 'active', url: 'http://127.0.0.1:27101' },
    [],
    {
      planeDirectory: [
        {
          groupId: DLE_LAB_M6_GROUP_ID,
          wallets: [
            { domainId: 'g2-a', role: 'active', url: 'http://127.0.0.1:37101', labOnly: true },
          ],
        },
      ],
      foreignChains: [{ chainNftId: '99', groupId: DLE_LAB_M6_GROUP_ID }],
    },
  )
  assert.equal(
    store.putLocator({
      schema: 'HashLocatorV1',
      hash,
      chainNftId: '99',
      kind: 'ac',
      height: '0x1',
      groupId: DLE_LAB_M6_GROUP_ID,
    }).ok,
    true,
  )
  assert.equal(store.putBody('99', '0x1', { secret: 'local-replica' }).ok, true)
  const seen: string[] = []
  const lookup = createHashLookupAdapter(store, {
    table,
    fetchObject: async (url, nft) => {
      seen.push(`${url}|${nft}`)
      return null
    },
  })
  const miss = await lookup.get(hash)
  assert.equal(miss.status, 'unavailable')
  if (miss.status === 'unavailable') {
    assert.equal(miss.planeWideNull, false)
    assert.equal(miss.hop?.usedLocalFallback, false)
    assert.equal(miss.hop?.groupId, DLE_LAB_M6_GROUP_ID)
  }
  assert.deepEqual(seen, ['http://127.0.0.1:37101|99'])
  assert.equal(lookup.getObjectLocal('99', '0x1').status, 'hit')
})

test('seedLabFissionMarker indexes the G2 marker on the marker nft', () => {
  const store = openHashStore(join(root, 'marker'))
  const table = labRouteTableFromPeers(
    { domainId: 'g2-a', role: 'active', url: 'http://127.0.0.1:37101' },
    [],
    { ownGroupId: DLE_LAB_M6_GROUP_ID },
  )
  const seeded = seedLabFissionMarker(store, table)
  assert.equal(seeded.ok, true)
  if (seeded.ok) assert.equal(seeded.hash, DLE_LAB_M6_MARKER_HASH)
  const lookup = createHashLookupAdapter(store, { table })
  const hit = lookup.locate(DLE_LAB_M6_MARKER_HASH)
  assert.equal(hit.status, 'hit')
  if (hit.status === 'hit') {
    assert.equal(hit.locator.chainNftId, DLE_LAB_M6_MARKER_NFT_ID)
    assert.equal(hit.locator.groupId, DLE_LAB_M6_GROUP_ID)
  }
  assert.equal(indexLabHashObject(store, labAcLocator(`0x${'11'.repeat(32)}`, '0x1', `0x${'11'.repeat(32)}`), { kind: 'ac' }).ok, true)
})
