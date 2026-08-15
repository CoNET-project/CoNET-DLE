import type { Hex } from './bytes.js'

export const ARCHIVE_QUORUM = 4
export const ACTIVE_ARCHIVES = 5
export const NONE_ROUND = 0xffff_ffff
export const VOTE_STEP_PREVOTE = 1
export const VOTE_STEP_PRECOMMIT = 2
export const CERT_KIND_PREVOTE_QC = 1
export const CERT_KIND_ARCHIVE = 2
export const TRADE_CLASS_ID = 3
export const EVENT_TRADE_OPENED = 0x1301
export const TRADE_STATE_NONE = 0
export const TRADE_STATE_OPEN = 1

export const ERR_FSM_NO_TRANSITION = 0x0101
export const ERR_FSM_BAD_NONCE = 0x0102
export const ERR_FSM_DOMAIN = 0x0103
export const ERR_FSM_CLAIMED_MISMATCH = 0x0104
export const ERR_TRADE_L1_NOT_FOUND = 0x1305
export const ERR_TRADE_SELLER_ORDER_MISMATCH = 0x1307
export const ERR_TRADE_ESCROW_CUSTODY = 0x1308
export const ERR_WAL_DOUBLE_SIGN = 'ERR_WAL_DOUBLE_SIGN'
export const ERR_SIGNER_NOT_ACTIVE = 'ERR_SIGNER_NOT_ACTIVE'
export const ERR_INVALID_QUORUM = 'ERR_INVALID_QUORUM'

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

export interface DepositBundle {
  schema: 'DleLabDepositBundleV1'
  event: TradeOpenedEvent
  parent: TradeParent
  l1EscrowView: L1EscrowView
  validatorQuorum: number
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
  prevoteQCRef: Hex
  mac: Hex
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
  modeAError?: number
}
