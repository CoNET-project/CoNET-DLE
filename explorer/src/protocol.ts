/**
 * EIP-155 chain id for CoNET-DLE Testnet. Copied locally — never import runtime.
 * Distinguishes this plane from CoNET L1 224422. Not a group id.
 */
export const DLE_TESTNET_CHAIN_ID = 0x44c45
export const DLE_TESTNET_CHAIN_NAME = 'CoNET-DLE Testnet'
export const DLE_LAB_CHAIN_ID = DLE_TESTNET_CHAIN_ID
export const CONET_L1_CHAIN_ID = 224422
export const DLE_LAB_CHAIN_NFT_ID = '42'

/** User-visible Group ID = L1 bootstrap register tx hash. Copied from l1Routing. */
export const DLE_BOOTSTRAP_GROUP_REGISTER_TX_HASH =
  '0x3076a806de71ab75b2d48063cc3f1e7d8f8e3d54cb1d45a7469c75c9276f2ad0'
export const DLE_LAB_GROUP_ID = DLE_BOOTSTRAP_GROUP_REGISTER_TX_HASH
export const DLE_LAB_GROUP_ID_LEGACY = 'dle.lab.group.v1'
/** Laboratory keccak used before G2’s L1 register. Copied from runtime — never import runtime. */
export const DLE_LAB_M6_GROUP_ID_LEGACY =
  '0x7b3b8eb959dcc0f75a309fcc16e7f840efe76dc27f2ef0d4eca8b8617f9b1a07'
/** User-visible G2 Group ID = L1 register tx. Copied from the CoNET deploy snapshot. */
export const DLE_G2_GROUP_REGISTER_TX_HASH =
  '0xf781f2c23fe3b3dac09dc3e1929016b0af200ee93978e916df64d750876d5153'
export const DLE_LAB_M6_GROUP_ID = DLE_G2_GROUP_REGISTER_TX_HASH

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
  'dle_getObject',
  'dle_route',
  'dle_historyProviders',
  'dle_archivesOf',
  'dle_chainsOf',
  'dle_getHashIndexRoot',
  'dle_proveHash',
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

export const HASH32_RE = /^0x[0-9a-fA-F]{64}$/

/** Copied from runtime hashLookup — never import runtime. */
export function normalizeHash32(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!HASH32_RE.test(trimmed)) return null
  return trimmed.toLowerCase()
}

export function canonicalGroupId(raw: string): string {
  const trimmed = raw.trim()
  const lower = trimmed.toLowerCase()
  if (lower === DLE_LAB_GROUP_ID_LEGACY || lower === '1' || lower === '0x1') {
    return DLE_LAB_GROUP_ID
  }
  if (lower === DLE_LAB_M6_GROUP_ID_LEGACY || lower === '2' || lower === '0x2') {
    return DLE_G2_GROUP_REGISTER_TX_HASH
  }
  return normalizeHash32(trimmed) ?? trimmed
}

export function sameGroupId(a: string, b: string): boolean {
  return canonicalGroupId(a) === canonicalGroupId(b)
}

export const DEFAULT_ARCHIVE_URL = 'http://127.0.0.1:27101'
export const DEFAULT_ARCHIVE_PORT = 27101

export const ACTIVE_ARCHIVE_COUNT = 5
export const STANDBY_ARCHIVE_COUNT = 2
export const LAB_ARCHIVE_COUNT = ACTIVE_ARCHIVE_COUNT + STANDBY_ARCHIVE_COUNT

export function chainIdHex(chainId: number): string {
  return `0x${chainId.toString(16)}`
}

export const DLE_LAB_CHAIN_ID_HEX = chainIdHex(DLE_LAB_CHAIN_ID)
