/** Lab DLE chain id for the ethers-shaped facade. Must never equal CoNET L1 224422. */
export const DLE_LAB_CHAIN_ID = 0x44c45

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
  'eth_chainId',
  'eth_blockNumber',
] as const

export type DleArchiveMethod = (typeof DLE_ARCHIVE_METHODS)[number]

export interface DleArchiveInfo {
  command: typeof DLE_COMMAND.archive
  runtime: typeof DLE_RUNTIME.nodejs
  producesBlocks: false
  hasTipVm: false
  chainId: number
  chainIdHex: string
  port: number
}

export interface DleTipView {
  height: string
  hash: string
  finalized: false
  note: string
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
