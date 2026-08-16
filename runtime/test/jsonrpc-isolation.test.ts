import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'
import { dispatchArchiveJsonRpc, dispatchArchiveJsonRpcEnvelope } from '../src/archive/jsonrpcFacade.js'
import {
  CONET_L1_CHAIN_ID,
  CONET_L1_CHAIN_ID_HEX,
  DLE_COMMAND,
  DLE_FORBIDDEN_L1_RPC_HOSTS,
  DLE_JSONRPC_VERSION,
  DLE_LAB_CHAIN_ID,
  DLE_RUNTIME,
  DLE_TESTNET_CHAIN_NAME,
  chainIdHex,
  type DleArchiveInfo,
} from '../src/shared/protocol.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

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

test('archive JSON-RPC facade source never names L1 public RPC hosts', async () => {
  const files = [
    'src/archive/jsonrpcFacade.ts',
    'src/archive/http.ts',
    'src/archive/hashStore.ts',
    'src/archive/hashPipe.ts',
    'src/shared/hashLookup.ts',
    'src/shared/labRoute.ts',
    'src/archive/hop1.ts',
    'src/shared/jsonrpc.ts',
    'src/archive/bft/engine.ts',
    'src/archive/bft/modeA.ts',
    'src/archive/bft/labCandidate.ts',
    'src/archive/ondemand/engine.ts',
    'src/archive/ondemand/mac.ts',
    'src/shared/ondemand/encoding.ts',
    'src/daemon/core.ts',
  ]
  for (const relative of files) {
    const source = await readFile(join(ROOT, relative), 'utf8')
    for (const host of DLE_FORBIDDEN_L1_RPC_HOSTS) {
      assert.equal(source.includes(host), false, `${relative} mentions ${host}`)
    }
  }
})

test('facade never advertises CoNET L1 chain id 224422', async () => {
  const chainId = await dispatchArchiveJsonRpc(
    { jsonrpc: DLE_JSONRPC_VERSION, id: 1, method: 'eth_chainId' },
    info,
  )
  assert.equal('result' in chainId && chainId.result, chainIdHex(DLE_LAB_CHAIN_ID))
  assert.notEqual(chainIdHex(DLE_LAB_CHAIN_ID), CONET_L1_CHAIN_ID_HEX)
  const poisoned = await dispatchArchiveJsonRpc(
    { jsonrpc: DLE_JSONRPC_VERSION, id: 2, method: 'eth_chainId' },
    { ...info, chainId: CONET_L1_CHAIN_ID, chainIdHex: CONET_L1_CHAIN_ID_HEX },
  )
  assert.equal('error' in poisoned, true)
})

test('empty and oversized batches are invalid JSON-RPC requests', async () => {
  const empty = await dispatchArchiveJsonRpcEnvelope([], info)
  assert.equal(empty.ok, false)
  const huge = await dispatchArchiveJsonRpcEnvelope(
    Array.from({ length: 33 }, (_, id) => ({
      jsonrpc: DLE_JSONRPC_VERSION,
      id,
      method: 'eth_chainId',
    })),
    info,
  )
  assert.equal(huge.ok, false)
})
