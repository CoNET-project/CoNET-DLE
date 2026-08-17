import type { Hex } from '../../shared/bytes.js'
import type { HashLocatorV1, HashObjectKind } from '../../shared/hashLookup.js'
import type { HashIndexProofV1 } from '../../shared/hashIndexTree.js'

export const SYNC_QUORUM = 4
export const SYNC_ACTIVE_COUNT = 5
/** 0 = open every hosted `chainNftId` (lab-wide C_G). Positive = seed-selected cap. */
export const LAB_SYNC_MAX_HOSTED_CHAINS = 0
export const LAB_SYNC_OPEN_ALL_HOSTED_CHAINS = true
export const SYNC_TICK_MS = 2_000
export const SYNC_CATCHUP_BATCH = 128
export const SYNC_QUALIFIED_CATCHUP_MIN_MS = 30_000
export const LAB_HOLD_BFT_AFTER_BOOT_MS = 30 * 60_000
export const SYNC_CHALLENGE_TIMEOUT_MS = 180_000
export const SYNC_STATUS_TIMEOUT_MS = 30_000
export const SYNC_CLAIM_STALE_MS = 60_000

export const ERR_SYNC_CHALLENGE_HMAC_CUTOVER = 'ERR_SYNC_CHALLENGE_HMAC_CUTOVER'
export const ERR_SYNC_CHALLENGE_SIG = 'ERR_SYNC_CHALLENGE_SIG'
export const ERR_SYNC_CHALLENGE_SAMPLES = 'ERR_SYNC_CHALLENGE_SAMPLES'

export type SyncPhase =
  | 'SYNCING'
  | 'CLAIMED_SYNC'
  | 'STATE_CHALLENGE'
  | 'QUALIFIED'
  | 'REJECTED'

export type ChallengeSampleKind = HashObjectKind | 'hashIndex' | 'emptyInventory'

export type SyncBeaconSource = 'injected-cl-view' | 'lab-after-freeze'

export type ProductionCgSource = 'injected-l1-archiveGroupId'

/** Freeze commitment persisted before any beacon / seed / samples are known. */
export interface ArchiveSyncFreezeV1 {
  schema: 'ArchiveSyncFreezeV1'
  labOnly: true
  beaconBound: false
  waitingForClBeacon: true
  notClRandao: true
  notProductionBeacon: true
  publicrpcNotClRandao: true
  groupId: string
  candidate: string
  challenger: string
  nonce: number
  hostedChainSetRoot: Hex
  lastACRef: Hex
  membershipRoot: Hex
  hashIndexRoot: Hex
  candidateSetRoot: Hex
  freezeHex: Hex
  frozenAt: string
}

export interface ArchiveStateChallengeSampleV1 {
  chainNftId: string
  height: string
  kind: ChallengeSampleKind
  hash: string
}

export interface ArchiveStateChallengeV1 {
  schema: 'ArchiveStateChallengeV1'
  labOnly: true
  eip712: true
  hmacForgeable: false
  notClRandao: true
  notProductionSecp256k1: true
  notProductionOperatorKey: true
  labDeterministicSeatingKey: true
  notL1Settled: true
  notThirtyDayQualification: true
  groupId: string
  candidate: string
  challenger: string
  nonce: number
  hostedChainSetRoot: Hex
  lastACRef: Hex
  membershipRoot: Hex
  hashIndexRoot: Hex
  freezeHex: Hex
  labBeacon: Hex
  seed: Hex
  challengeHash: Hex
  hostedChainCount?: number
  openedChainCount?: number
  openedAllHostedChains?: boolean
  samples: ArchiveStateChallengeSampleV1[]
  samplesRoot: Hex
  signer: string
  signature: Hex
  candidateSetRoot?: Hex
  beaconSource?: SyncBeaconSource
  clViewBound?: boolean
  labBeaconAfterFreeze?: boolean
  notProductionBeacon?: true
  waitingForClBeacon?: false
  publicrpcNotClRandao?: true
  revealSalt?: Hex
  frozenAt?: string
  boundAt?: string
}

/** Pre-P15 unsigned / HMAC-labeled envelope. handleChallenge rejects this shape. */
export interface ArchiveStateHmacChallengeV1 {
  schema: 'ArchiveStateChallengeV1'
  labOnly: true
  hmacForgeable: true
  eip712?: false
  groupId: string
  candidate: string
  challenger: string
  nonce: number
  hostedChainSetRoot: Hex
  lastACRef: Hex
  membershipRoot: Hex
  hashIndexRoot: Hex
  freezeHex: Hex
  labBeacon: Hex
  seed: Hex
  challengeHash?: Hex
  hostedChainCount?: number
  openedChainCount?: number
  openedAllHostedChains?: boolean
  samples: ArchiveStateChallengeSampleV1[]
  samplesRoot?: Hex
  signer?: string
  signature?: Hex
}

export interface ArchiveStateChallengeAnswerV1 {
  schema: 'ArchiveStateChallengeAnswerV1'
  labOnly: true
  candidate: string
  nonce: number
  seed: Hex
  hostedChainSetRoot: Hex
  lastACRef: Hex
  membershipRoot: Hex
  hashIndexRoot: Hex
  objects: unknown[]
  indexProofs: HashIndexProofV1[]
  hopUsed: boolean
  localOnly: true
}

export interface ArchiveSyncVoteV1 {
  schema: 'ArchiveSyncVoteV1'
  labOnly: true
  eip712: true
  hmacForgeable: false
  notProductionSecp256k1: true
  notProductionOperatorKey: true
  labDeterministicSeatingKey: true
  notL1Settled: true
  domainId: string
  groupId: string
  candidate: string
  challengeHash: Hex
  hostedChainSetRoot: Hex
  lastACRef: Hex
  membershipRoot: Hex
  hashIndexRoot: Hex
  accept: boolean
  signer: string
  signature: Hex
}

/** Pre-P12 seating envelope. After cutover, `handleVote` / `handleReject` reject this shape. */
export interface ArchiveSyncHmacVoteV1 {
  schema: 'ArchiveSyncVoteV1'
  labOnly: true
  hmacForgeable: true
  notProductionSecp256k1: true
  domainId: string
  candidate: string
  challengeHash: Hex
  accept: boolean
  membershipRoot: Hex
  mac: Hex
}

export interface ArchiveSyncQualificationCertificateV1 {
  schema: 'ArchiveSyncQualificationCertificateV1'
  labOnly: true
  eip712: true
  hmacForgeable: false
  notProductionSecp256k1: true
  notProductionOperatorKey: true
  labDeterministicSeatingKey: true
  notL1Settled: true
  notThirtyDayQualification: true
  groupId: string
  candidate: string
  challengeHash: Hex
  hostedChainSetRoot: Hex
  lastACRef: Hex
  membershipRoot: Hex
  hashIndexRoot: Hex
  votes: ArchiveSyncVoteV1[]
  candidateAcceptance: Hex
  issuedAt: string
}

export interface SyncInventoryV1 {
  schema: 'DleLabSyncInventoryV1'
  labOnly: true
  lastQuorumOkIsNotSeating: true
  domainId: string
  groupId: string
  hostedChainSetRoot: Hex
  lastACRef: Hex
  membershipRoot: Hex
  hashIndexRoot: Hex
  leafCount: number
  chainNftIds: string[]
  locators: HashLocatorV1[]
}

export interface SyncStatusV1 {
  schema: 'ArchiveSyncQualificationLabV1'
  labOnly: true
  lastQuorumOkIsNotSeating: true
  notThirtyDayQualification: true
  hmacForgeable: false
  seatingEip712: true
  challengeEip712: true
  notL1Settled: true
  notClRandao: true
  freezeBeforeBeacon: true
  labBeaconAfterFreeze: true
  notProductionBeacon: true
  publicrpcNotClRandao: true
  labHostedSetNotProductionCg: true
  publicrpcNotProductionCg: true
  productionCgAvailable: boolean
  productionCgSource?: ProductionCgSource
  domainId: string
  role: string
  phase: SyncPhase
  seatingQualified: boolean
  groupId: string
  hostedChainSetRoot: Hex
  lastACRef: Hex
  membershipRoot: Hex
  hashIndexRoot: Hex
  leafCount: number
  nonce: number
  holdClaimed: boolean
  rejectReason: string | null
  certificate: ArchiveSyncQualificationCertificateV1 | null
  pendingChallenge: ArchiveStateChallengeV1 | null
}

export interface SyncRosterRowV1 {
  domainId: string
  role?: string
  phase: SyncPhase
  seatingQualified: boolean
  lastQuorumOkIsNotSeating: true
  groupId?: string
  leafCount?: number
  hostedChainSetRoot?: Hex
  lastACRef?: Hex
  membershipRoot?: Hex
  hashIndexRoot?: Hex
}

export interface SyncPeer {
  domainId: string
  role: string
  url: string
}
