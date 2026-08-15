/** Lab DLE chain id. Copied locally — never import runtime or archive-a/b. Must never equal CoNET L1 224422. */
export const DLE_LAB_CHAIN_ID = 0x44c45
export const CONET_L1_CHAIN_ID = 224422

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
  'eth_syncing',
  'eth_accounts',
  'eth_protocolVersion',
] as const

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

export const DEFAULT_ARCHIVE_URL = 'http://127.0.0.1:27101'
export const DEFAULT_ARCHIVE_PORT = 27101

export const ACTIVE_ARCHIVE_COUNT = 5
export const STANDBY_ARCHIVE_COUNT = 2
export const LAB_ARCHIVE_COUNT = ACTIVE_ARCHIVE_COUNT + STANDBY_ARCHIVE_COUNT

export function chainIdHex(chainId: number): string {
  return `0x${chainId.toString(16)}`
}

export const DLE_LAB_CHAIN_ID_HEX = chainIdHex(DLE_LAB_CHAIN_ID)
