/**
 * EIP-155 chain id for this DLE plane (CoNET-DLE Testnet).
 * Unique versus CoNET L1 224422, Base 8453, and other EVM networks.
 * `eth_chainId` / `net_version` MUST return this uint. It is not a group id.
 */
export const DLE_TESTNET_CHAIN_ID = 0x44c45
export const DLE_TESTNET_CHAIN_NAME = 'CoNET-DLE Testnet'
/** Alias kept for existing imports. Same value as DLE_TESTNET_CHAIN_ID. */
export const DLE_LAB_CHAIN_ID = DLE_TESTNET_CHAIN_ID

/** CoNET L1 chain id. DLE `/rpc` must never return this or proxy its public RPC. */
export const CONET_L1_CHAIN_ID = 224422
export const CONET_L1_CHAIN_ID_HEX = '0x36ca6'

export const DLE_FORBIDDEN_L1_RPC_HOSTS = [
  'publicrpc.conet.network',
  'rpc1.conet.network',
  'rpc.conet.network',
  'base-rpc.conet.network',
] as const

export const DLE_ZERO_HASH = `0x${'0'.repeat(64)}`
export const DLE_ZERO_ADDRESS = `0x${'0'.repeat(40)}`
export const DLE_JSONRPC_BATCH_MAX = 32
export const DLE_ARCHIVE_CLIENT_VERSION = 'conet-dle-archive/0.2.0'

export const DLE_COMMAND = {
  archive: 'archive',
  daemon: 'daemon',
} as const

export type DleCommand = (typeof DLE_COMMAND)[keyof typeof DLE_COMMAND]

export const DLE_RUNTIME = {
  nodejs: 'nodejs',
  browser: 'browser',
} as const

export type DleRuntime = (typeof DLE_RUNTIME)[keyof typeof DLE_RUNTIME]

export const DLE_JSONRPC_VERSION = '2.0' as const

export const DLE_ARCHIVE_METHODS = [
  'dle_info',
  'dle_tip',
  'dle_getArchiveCertificate',
  'dle_getWaitingPool',
  'dle_getSelectionLog',
  'eth_chainId',
  'eth_blockNumber',
  'net_version',
  'web3_clientVersion',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_getTransactionByHash',
  'dle_locateHash',
  'dle_getByHash',
  'eth_syncing',
  'eth_accounts',
  'eth_protocolVersion',
] as const

export type DleArchiveMethod = (typeof DLE_ARCHIVE_METHODS)[number]

export const DLE_REJECTED_METHODS = [
  'eth_call',
  'eth_estimateGas',
  'eth_sendRawTransaction',
  'eth_sendTransaction',
  'eth_getBalance',
  'eth_getCode',
  'eth_getStorageAt',
  'eth_getTransactionCount',
] as const

export type DleRejectedMethod = (typeof DLE_REJECTED_METHODS)[number]

export interface DleArchiveInfo {
  command: typeof DLE_COMMAND.archive
  runtime: typeof DLE_RUNTIME.nodejs
  producesBlocks: false
  hasTipVm: false
  l1Isolated: true
  l1ChainIdForbidden: typeof CONET_L1_CHAIN_ID
  batchSupported: true
  chainId: number
  chainIdHex: string
  chainName: string
  port: number
}

export interface DleTipView {
  height: string
  hash: string
  finalized: boolean
  note: string
}

export type { SelectionView as DleSelectionLogView, WaitingPoolView as DleWaitingPoolView } from './ondemand/index.js'

export interface DleCertificateView {
  available: boolean
  reason: string
  height?: string
  hash?: string
  quorum?: number
  networked?: boolean
  modeA?: boolean
  signers?: string[]
  kind?: number
  round?: number
  prevoteQCRef?: string
  hashIndexRoot?: string
  labOnly?: boolean
}

export interface DleDaemonInfo {
  command: typeof DLE_COMMAND.daemon
  runtime: DleRuntime
  archiveUrl: string
}

export interface JsonRpcRequest {
  jsonrpc: typeof DLE_JSONRPC_VERSION
  id: string | number | null
  method: string
  params?: unknown
}

export interface JsonRpcError {
  code: number
  message: string
}

export interface JsonRpcSuccess {
  jsonrpc: typeof DLE_JSONRPC_VERSION
  id: string | number | null
  result: unknown
}

export interface JsonRpcFailure {
  jsonrpc: typeof DLE_JSONRPC_VERSION
  id: string | number | null
  error: JsonRpcError
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure

export function chainIdHex(chainId: number): string {
  return `0x${chainId.toString(16)}`
}
