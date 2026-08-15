/** CoNET L1 Global Archive Routing Registry — copied into this subproject. */
export const CONET_L1_RPC_URLS = [
  'https://rpc1.conet.network',
  'https://publicrpc.conet.network',
] as const

export const CONET_BLOCKSCOUT_ADDRESS_URL = 'https://mainnet.conet.network/address/'

/** Canonical UUPS proxy. Empty until the CoNET deploy script writes the live address. */
export const CONET_GLOBAL_ARCHIVE_ROUTING_REGISTRY = '0x8B261eAECdFfeE9e7aC9fFe73386B0d6C9E76AfB'

export const BOOTSTRAP_GROUP_ID = 1

export const ARCHIVE_ROSTER_DOMAIN_IDS = [
  'fd-01-ionos-45',
  'fd-02-ionos-189',
  'fd-03-ionos-98',
  'fd-04-hosthatch-tokyo1',
  'fd-05-hosthatch-tokyo2',
  'fd-06-ionos-174',
  'fd-07-ionos-207',
] as const

export const ARCHIVES_OF_SELECTOR = '0xd3a448be'
export const LIVE_GROUP_IDS_SELECTOR = '0x7e847d92'
