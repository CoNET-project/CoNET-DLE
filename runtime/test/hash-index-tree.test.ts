import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHashLookupAdapter, indexLabHashObject, labAcLocator } from '../src/archive/hashPipe.js'
import { openHashStore } from '../src/archive/hashStore.js'
import { dispatchArchiveJsonRpc } from '../src/archive/jsonrpcFacade.js'
import {
  emptyHashIndexRoot,
  hashIndexLeafHash,
  hashIndexRootOf,
  proveHashIndex,
  verifyHashIndexProof,
} from '../src/shared/hashIndexTree.js'
import { DLE_LAB_CHAIN_NFT_ID, DLE_LAB_GROUP_ID } from '../src/shared/hashLookup.js'
import {
  CONET_L1_CHAIN_ID,
  DLE_COMMAND,
  DLE_JSONRPC_VERSION,
  DLE_LAB_CHAIN_ID,
  DLE_RUNTIME,
  chainIdHex,
  type DleArchiveInfo,
} from '../src/shared/protocol.js'

const dataDir = await mkdtemp(join(tmpdir(), 'dle-hash-index-'))
const store = openHashStore(dataDir)
const lookup = createHashLookupAdapter(store)
const first = `0x${'11'.repeat(32)}`
const second = `0x${'88'.repeat(32)}`
const between = `0x${'44'.repeat(32)}`
const before = `0x${'00'.repeat(32)}`
const afterLast = `0x${'ff'.repeat(32)}`

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

test('empty hashIndexRoot is domain-separated and not a plane-wide null', () => {
  const empty = proveHashIndex([], afterLast)
  assert.equal('ok' in empty, false)
  if ('ok' in empty) return
  assert.equal(empty.kind, 'non-inclusion')
  if (empty.kind === 'non-inclusion') {
    assert.equal(empty.empty, true)
    assert.equal(empty.hashIndexRoot, emptyHashIndexRoot())
    assert.equal(empty.planeWideNull, false)
    assert.equal(empty.notHotGet, true)
    assert.equal(empty.committedInAc, false)
    assert.equal(verifyHashIndexProof(empty), true)
  }
})

test('inclusion and sorted-range non-inclusion verify; leaf has no body', () => {
  assert.equal(indexLabHashObject(store, labAcLocator(first, '0x1', first), { kind: 'ac' }).ok, true)
  assert.equal(indexLabHashObject(store, labAcLocator(second, '0x2', second), { kind: 'ac' }).ok, true)
  const locators = store.listLocators()
  const root = hashIndexRootOf(locators)
  const hit = proveHashIndex(locators, first)
  assert.equal('ok' in hit, false)
  if ('ok' in hit) return
  assert.equal(hit.kind, 'inclusion')
  if (hit.kind === 'inclusion') {
    assert.equal(hit.hashIndexRoot, root)
    assert.equal(hit.open.leaf.chainNftId, DLE_LAB_CHAIN_NFT_ID)
    assert.equal('body' in hit.open.leaf, false)
    assert.equal(hit.open.leafHash, hashIndexLeafHash(hit.open.leaf))
    assert.equal(verifyHashIndexProof(hit), true)
    const tampered = { ...hit, open: { ...hit.open, leafHash: second } }
    assert.equal(verifyHashIndexProof(tampered), false)
  }
  for (const [hash, expectSide] of [
    [before, 'right'],
    [between, 'both'],
    [afterLast, 'left'],
  ] as const) {
    const miss = proveHashIndex(locators, hash)
    assert.equal('ok' in miss, false)
    if ('ok' in miss) continue
    assert.equal(miss.kind, 'non-inclusion')
    if (miss.kind !== 'non-inclusion') continue
    assert.equal(miss.planeWideNull, false)
    assert.equal(miss.notHotGet, true)
    assert.equal(verifyHashIndexProof(miss), true)
    if (expectSide === 'right') {
      assert.equal(miss.right?.index, 0)
      assert.equal(miss.left, undefined)
    }
    if (expectSide === 'left') {
      assert.equal(miss.left?.index, 1)
      assert.equal(miss.right, undefined)
    }
    if (expectSide === 'both') {
      assert.equal(miss.left?.index, 0)
      assert.equal(miss.right?.index, 1)
    }
  }
})

test('hot locate stays on KV and does not open the tree', async () => {
  const located = lookup.locate(first)
  assert.equal(located.status, 'hit')
  if (located.status === 'hit') {
    assert.equal(located.locator.chainNftId, DLE_LAB_CHAIN_NFT_ID)
    assert.equal('hashIndexRoot' in located, false)
  }
  const view = lookup.hashIndexRoot()
  assert.equal(view.schema, 'DleHashIndexRootV1')
  assert.equal(view.groupId, DLE_LAB_GROUP_ID)
  assert.equal(view.notHotGet, true)
  assert.equal(view.committedInAc, false)
  assert.equal(view.leafCount, 2)
  const rpc = await dispatchArchiveJsonRpc(
    { jsonrpc: DLE_JSONRPC_VERSION, id: 1, method: 'dle_proveHash', params: [between] },
    info,
    undefined,
    lookup,
  )
  assert.equal('result' in rpc, true)
  if ('result' in rpc) {
    const body = rpc.result as { kind?: string; planeWideNull?: boolean; notHotGet?: boolean }
    assert.equal(body.kind, 'non-inclusion')
    assert.equal(body.planeWideNull, false)
    assert.equal(body.notHotGet, true)
  }
})
