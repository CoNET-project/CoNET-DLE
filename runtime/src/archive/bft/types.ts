import type { Hex } from './bytes.js'

export const ARCHIVE_QUORUM = 4
export const ACTIVE_ARCHIVES = 5
export const NONE_ROUND = 0xffff_ffff
export const VOTE_STEP_PREVOTE = 1
export const VOTE_STEP_PRECOMMIT = 2
export const CERT_KIND_PREVOTE_QC = 1
export const CERT_KIND_ARCHIVE = 2
export const ASSET_CLASS_ID = 1
export const STORAGE_CLASS_ID = 2
export const TRADE_CLASS_ID = 3
export const EVENT_ASSET_OPENED = 0x1101
export const EVENT_STORAGE_OPENED = 0x1201
export const EVENT_TRADE_OPENED = 0x1301
export const EVENT_TRADE_MATCH_PROPOSED = 0x1302
export const EVENT_TRADE_MATCH_CERTIFIED = 0x1303
export const EVENT_TRADE_SETTLEMENT_SUBMITTED = 0x1304
export const EVENT_TRADE_SETTLED = 0x1305
export const EVENT_TRADE_SETTLEMENT_FAILED = 0x1306
export const TRADE_STATE_NONE = 0
export const TRADE_STATE_OPEN = 1
export const TRADE_STATE_MATCH_PROPOSED = 2
export const TRADE_STATE_MATCH_CERTIFIED = 3
export const TRADE_STATE_SETTLEMENT_SUBMITTED = 4
export const TRADE_STATE_SETTLED = 5
export const TRADE_STATE_SETTLEMENT_FAILED = 6
export const ASSET_STATE_NONE = 0
export const ASSET_STATE_OPEN = 1
export const STORAGE_STATE_NONE = 0
export const STORAGE_STATE_OPEN = 1

export const ERR_FSM_NO_TRANSITION = 0x0101
export const ERR_FSM_BAD_NONCE = 0x0102
export const ERR_FSM_DOMAIN = 0x0103
export const ERR_FSM_CLAIMED_MISMATCH = 0x0104
export const ERR_ASSET_L1_NOT_FOUND = 0x1105
export const ERR_ASSET_BURN_NOT_ACTIVATED = 0x1106
export const ERR_ASSET_VIEW_MISMATCH = 0x1107
export const ERR_STORAGE_L1_NOT_FOUND = 0x1205
export const ERR_STORAGE_INDEX_MISSING = 0x1206
export const ERR_STORAGE_VIEW_MISMATCH = 0x1207
export const ERR_TRADE_L1_NOT_FOUND = 0x1305
export const ERR_TRADE_SELLER_ORDER_MISMATCH = 0x1307
export const ERR_TRADE_ESCROW_CUSTODY = 0x1308
export const ERR_TRADE_MATCH_INVALID = 0x1309
export const ERR_TRADE_CERT_QUORUM = 0x130a
export const ERR_TRADE_SETTLE_REPLAY = 0x130b
export const ERR_TRADE_BAD_PHASE = 0x130c
export const ERR_WAL_DOUBLE_SIGN = 'ERR_WAL_DOUBLE_SIGN'
export const ERR_SIGNER_NOT_ACTIVE = 'ERR_SIGNER_NOT_ACTIVE'
export const ERR_INVALID_QUORUM = 'ERR_INVALID_QUORUM'
export const ERR_BFT_HMAC_CUTOVER = 'ERR_BFT_HMAC_CUTOVER'
export const ERR_BFT_VOTE_SIG = 'ERR_BFT_VOTE_SIG'
export const ERR_BFT_HASH_INDEX_ROOT = 'ERR_BFT_HASH_INDEX_ROOT'

export const ASSET_STATE_PATHS = [
  '/state',
  '/nonce',
  '/owner',
  '/assetToken',
  '/burnId',
  '/notionalUsdc6',
] as const

export const STORAGE_STATE_PATHS = [
  '/state',
  '/nonce',
  '/owner',
  '/contentIndexHash',
  '/accessPriceGb',
] as const

export const TRADE_STATE_PATHS = [
  '/state',
  '/nonce',
  '/sellerOrderHash',
  '/subjectNftContract',
  '/subjectNftId',
  '/seller',
  '/sellerNonce',
  '/buyer',
  '/buyerConstraint',
  '/quoteAsset',
  '/quoteAmount',
  '/tradeFeeAmount',
  '/feePolicyHash',
  '/deadline',
  '/paymentAuthHash',
  '/l1TxHash',
  '/candidateHash',
  '/certificateHash',
  '/scanner',
  '/clearingPrice',
  '/settlementCalldataHash',
] as const

export interface TradeParent {
  state: number
  nonce: bigint
  tipStateRoot: Hex
}

export interface TradeOpenedFields {
  sellerOrderHash: Hex
  subjectNftContract: Hex
  subjectNftId: Hex
  seller: Hex
  quoteAsset: Hex
  quoteAmount: bigint
  buyerConstraint: Hex
  feePolicyHash: Hex
  deadline: bigint
  sellerNonce: bigint
}

export interface TradeMatchFields {
  candidateHash: Hex
  certificateHash: Hex
  sellOrderHash: Hex
  buyOrderHash: Hex
  scanner: Hex
  clearingPrice: bigint
  feeAmount: bigint
  scannerReward: bigint
  committeeReward: bigint
  feePolicyHash: Hex
  settlementCalldataHash: Hex
  quorum: number
  signerCount: number
}

export interface L1EscrowView extends TradeOpenedFields {
  live: boolean
  settlementOwnsSubject: boolean
}

export interface TradeOpenedEvent extends TradeOpenedFields {
  version: number
  classId: number
  eventType: number
  tipId: Hex
  nonce: bigint
}

export interface TradeMatchEvent extends TradeMatchFields {
  version: number
  classId: number
  eventType: number
  tipId: Hex
  nonce: bigint
}

export interface DepositBundle {
  schema: 'DleLabDepositBundleV1'
  event: TradeOpenedEvent
  parent: TradeParent
  l1EscrowView: L1EscrowView
  validatorQuorum: number
  claimedTipStateRoot?: Hex
  claimedValueHash?: Hex
  selectionLogRef?: Hex
  committee?: Hex[]
  standbys?: Hex[]
}

export interface AssetOpenedFields {
  owner: Hex
  assetToken: Hex
  burnId: Hex
  notionalUsdc6: bigint
}

export interface L1AssetBurnView extends AssetOpenedFields {
  live: boolean
  burnActivated: boolean
}

export interface AssetOpenedEvent extends AssetOpenedFields {
  version: number
  classId: number
  eventType: number
  tipId: Hex
  nonce: bigint
}

export interface StorageOpenedFields {
  owner: Hex
  contentIndexHash: Hex
  accessPriceGb: bigint
}

export interface L1StorageView extends StorageOpenedFields {
  live: boolean
  contentIndexPresent: boolean
}

export interface StorageOpenedEvent extends StorageOpenedFields {
  version: number
  classId: number
  eventType: number
  tipId: Hex
  nonce: bigint
}

export interface AssetGenesisBundle {
  schema: 'DleLabAssetGenesisBundleV1'
  event: AssetOpenedEvent
  parent: TradeParent
  l1AssetView: L1AssetBurnView
  claimedTipStateRoot?: Hex
  claimedValueHash?: Hex
}

export interface StorageGenesisBundle {
  schema: 'DleLabStorageGenesisBundleV1'
  event: StorageOpenedEvent
  parent: TradeParent
  l1StorageView: L1StorageView
  claimedTipStateRoot?: Hex
  claimedValueHash?: Hex
}

export type ModeAResult =
  | {
      ok: true
      nextState: number
      nonce: bigint
      tipStateRoot: Hex
      valueHash: Hex
      bodyCommitment: Hex
      eventBytes: Uint8Array
    }
  | { ok: false; code: number; reason: string }

export interface ArchiveVote {
  schema: 'DleLabVoteV1'
  domainId: string
  height: number
  round: number
  step: number
  valueHash: Hex
  membershipRoot: Hex
  hashIndexRoot: Hex
  prevoteQCRef: Hex
  eip712?: boolean
  hmacForgeable?: boolean
  labDeterministicSeatingKey?: boolean
  notProductionOperatorKey?: boolean
  notL1Settled?: boolean
  signer?: string
  signature?: Hex
  /** Legacy HMAC only. New votes omit this; `acceptVote` rejects HMAC. */
  mac?: Hex
}

export interface ArchivePrevoteQc {
  schema: 'DleLabPrevoteQcV1'
  kind: typeof CERT_KIND_PREVOTE_QC
  height: number
  round: number
  valueHash: Hex
  membershipRoot: Hex
  hashIndexRoot: Hex
  qcRef: Hex
  quorum: number
  signers: string[]
  networked: true
  labOnly: true
  note: string
}

export interface ArchiveCertificate {
  schema: 'DleLabArchiveCertificateV1'
  kind: typeof CERT_KIND_ARCHIVE
  height: number
  round: number
  valueHash: Hex
  tipStateRoot: Hex
  prevoteQCRef: Hex
  membershipRoot: Hex
  hashIndexRoot: Hex
  quorum: number
  signers: string[]
  networked: true
  modeA: true
  labOnly: true
  note: string
}

export interface BftPeer {
  domainId: string
  host: string
  port: number
  role: string
}

export interface BftStatus {
  schema: 'DleLabBftStatusV1'
  networked: true
  processStarted: boolean
  modeA: true
  modeAAccepted: boolean
  role: string
  voted: boolean
  step: string
  height: number
  round: number
  prevoteCount: number
  precommitCount: number
  certificateAvailable: boolean
  valueHash: Hex
  quorum: number
  labOnly: true
  eip712: true
  hmacForgeable: false
  bftEip712: true
  modeAError?: number
}
