import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHashLookupAdapter, indexLabHashObject, labAcLocator } from '../src/archive/hashPipe.js'
import { openHashStore } from '../src/archive/hashStore.js'
import { dispatchArchiveJsonRpc } from '../src/archive/jsonrpcFacade.js'
import { DLE_LAB_CHAIN_NFT_ID, hashLookupUnavailable } from '../src/shared/hashLookup.js'
import {
  CONET_L1_CHAIN_ID,
  DLE_COMMAND,
  DLE_JSONRPC_VERSION,
  DLE_LAB_CHAIN_ID,
  DLE_RUNTIME,
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
  assert.equal(miss.status, 'unavailable')
  if (miss.status === 'unavailable') {
    assert.equal(miss.planeWideNull, false)
  }
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

test('JSON-RPC hash methods return unavailable instead of null', async () => {
  const locate = await dispatchArchiveJsonRpc(
    { jsonrpc: DLE_JSONRPC_VERSION, id: 1, method: 'dle_locateHash', params: [unknown] },
    info,
    undefined,
    lookup,
  )
  assert.equal('result' in locate, true)
  if ('result' in locate) {
    const body = locate.result as { status?: string; planeWideNull?: boolean }
    assert.equal(body.status, 'unavailable')
    assert.equal(body.planeWideNull, false)
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
    assert.equal(body.status, 'unavailable')
  }
  const noLookup = await dispatchArchiveJsonRpc(
    { jsonrpc: DLE_JSONRPC_VERSION, id: 3, method: 'eth_getBlockByHash', params: [unknown, false] },
    info,
  )
  assert.equal('result' in noLookup && noLookup.result !== null, true)
  const stub = hashLookupUnavailable('x')
  assert.equal(stub.planeWideNull, false)
})
