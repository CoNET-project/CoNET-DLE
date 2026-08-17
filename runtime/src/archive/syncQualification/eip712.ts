import { TypedDataEncoder, Wallet, getAddress, verifyTypedData } from 'ethers'
import { keccak256Utf8, type Hex } from '../../shared/bytes.js'

/**
 * Deployed `ArchiveCertificateVerifierV1` proxy on CoNET L1 (224422).
 * P12 / P15 / P16 / P17 / P18 bind seating, challenge, BFT vote, on-demand
 * attest, and Q_V typed-data to this `verifyingContract` only. It does **not**
 * call L1, upgrade the verifier, or settle MembershipCheckpoint.
 */
export const ARCHIVE_CERTIFICATE_VERIFIER_V1 = '0xdA06E6d06eB2816795102B18171a079E3bEA948f'

export const ARCHIVE_EIP712_NAME = 'CoNET-DLE-Archive'
export const ARCHIVE_EIP712_VERSION = '1'
export const ARCHIVE_EIP712_CHAIN_ID = 224422

export const ARCHIVE_EIP712_DOMAIN = {
  name: ARCHIVE_EIP712_NAME,
  version: ARCHIVE_EIP712_VERSION,
  chainId: ARCHIVE_EIP712_CHAIN_ID,
  verifyingContract: ARCHIVE_CERTIFICATE_VERIFIER_V1,
} as const

export const ARCHIVE_SYNC_QUALIFICATION_TYPES = {
  ArchiveSyncQualificationCertificate: [
    { name: 'groupId', type: 'string' },
    { name: 'candidate', type: 'string' },
    { name: 'challengeHash', type: 'bytes32' },
    { name: 'hostedChainSetRoot', type: 'bytes32' },
    { name: 'lastACRef', type: 'bytes32' },
    { name: 'membershipRoot', type: 'bytes32' },
    { name: 'hashIndexRoot', type: 'bytes32' },
    { name: 'accept', type: 'bool' },
  ],
}

/** P15: challenge / opening envelope. Do not put 2250 samples in the typed array. */
export const ARCHIVE_STATE_CHALLENGE_TYPES = {
  ArchiveStateChallenge: [
    { name: 'groupId', type: 'string' },
    { name: 'candidate', type: 'string' },
    { name: 'challenger', type: 'string' },
    { name: 'nonce', type: 'uint64' },
    { name: 'hostedChainSetRoot', type: 'bytes32' },
    { name: 'lastACRef', type: 'bytes32' },
    { name: 'membershipRoot', type: 'bytes32' },
    { name: 'hashIndexRoot', type: 'bytes32' },
    { name: 'freezeHex', type: 'bytes32' },
    { name: 'labBeacon', type: 'bytes32' },
    { name: 'seed', type: 'bytes32' },
    { name: 'challengeHash', type: 'bytes32' },
    { name: 'samplesRoot', type: 'bytes32' },
  ],
}

/** P16: BFT AC vote. Typed data does not include `domainId`. */
export const ARCHIVE_BFT_VOTE_TYPES = {
  ArchiveBftVote: [
    { name: 'valueHash', type: 'bytes32' },
    { name: 'height', type: 'uint64' },
    { name: 'round', type: 'uint32' },
    { name: 'step', type: 'uint8' },
    { name: 'membershipRoot', type: 'bytes32' },
    { name: 'prevoteQCRef', type: 'bytes32' },
  ],
}

/** P17: on-demand pool attest. Typed data does not include `domainId`. */
export const ARCHIVE_ONDEMAND_ATTEST_TYPES = {
  ArchiveOnDemandAttest: [
    { name: 'poolRoot', type: 'bytes32' },
    { name: 'epoch', type: 'uint64' },
    { name: 'shardId', type: 'string' },
    { name: 'roulette', type: 'bytes32' },
  ],
}

/**
 * P18: new-chain Q_V attest. Typed data does not include `validatorId`.
 * Identity is `recoverAddress` + envelope `validatorId` (request-derived
 * committee id, signed with the same seating-key derivation).
 */
export const ARCHIVE_VALIDATOR_QUORUM_ATTEST_TYPES = {
  ArchiveValidatorQuorumAttest: [
    { name: 'requestId', type: 'bytes32' },
    { name: 'valueHash', type: 'bytes32' },
    { name: 'tipStateRoot', type: 'bytes32' },
    { name: 'bodyCommitment', type: 'bytes32' },
  ],
}

export type ArchiveBftVoteTyped = {
  valueHash: Hex
  height: number
  round: number
  step: number
  membershipRoot: Hex
  prevoteQCRef: Hex
}

export type ArchiveOnDemandAttestTyped = {
  poolRoot: Hex
  epoch: number
  shardId: string
  roulette: Hex
}

export type ArchiveValidatorQuorumAttestTyped = {
  requestId: Hex
  valueHash: Hex
  tipStateRoot: Hex
  bodyCommitment: Hex
}

export type ArchiveStateChallengeTyped = {
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
  samplesRoot: Hex
}

export function archiveStateChallengeMessage(input: ArchiveStateChallengeTyped): ArchiveStateChallengeTyped {
  return {
    groupId: input.groupId,
    candidate: input.candidate,
    challenger: input.challenger,
    nonce: input.nonce,
    hostedChainSetRoot: input.hostedChainSetRoot,
    lastACRef: input.lastACRef,
    membershipRoot: input.membershipRoot,
    hashIndexRoot: input.hashIndexRoot,
    freezeHex: input.freezeHex,
    labBeacon: input.labBeacon,
    seed: input.seed,
    challengeHash: input.challengeHash,
    samplesRoot: input.samplesRoot,
  }
}

export type ArchiveSyncQualificationCertificateMessage = {
  groupId: string
  candidate: string
  challengeHash: Hex
  hostedChainSetRoot: Hex
  lastACRef: Hex
  membershipRoot: Hex
  hashIndexRoot: Hex
  accept: boolean
}

export const LAB_SEATING_OPERATOR_PREFIX = 'dle.archive.lab.seating.operator.v1|'

export function labSeatingPrivateKey(domainId: string): Hex {
  return keccak256Utf8(`${LAB_SEATING_OPERATOR_PREFIX}${domainId}`)
}

export function labSeatingWallet(domainId: string): Wallet {
  return new Wallet(labSeatingPrivateKey(domainId))
}

export function labSeatingAddress(domainId: string): string {
  return labSeatingWallet(domainId).address
}

export function hashSyncQualificationCertificate(
  message: ArchiveSyncQualificationCertificateMessage,
): Hex {
  return TypedDataEncoder.hash(
    ARCHIVE_EIP712_DOMAIN,
    ARCHIVE_SYNC_QUALIFICATION_TYPES,
    message,
  ) as Hex
}

export function signSyncQualificationCertificate(
  domainId: string,
  message: ArchiveSyncQualificationCertificateMessage,
): Hex {
  const digest = hashSyncQualificationCertificate(message)
  return labSeatingWallet(domainId).signingKey.sign(digest).serialized as Hex
}

export function recoverSyncQualificationSigner(
  message: ArchiveSyncQualificationCertificateMessage,
  signature: string,
): string {
  return getAddress(verifyTypedData(ARCHIVE_EIP712_DOMAIN, ARCHIVE_SYNC_QUALIFICATION_TYPES, message, signature))
}

export function hashArchiveStateChallenge(message: ArchiveStateChallengeTyped): Hex {
  return TypedDataEncoder.hash(
    ARCHIVE_EIP712_DOMAIN,
    ARCHIVE_STATE_CHALLENGE_TYPES,
    archiveStateChallengeMessage(message),
  ) as Hex
}

export function signArchiveStateChallenge(domainId: string, message: ArchiveStateChallengeTyped): Hex {
  const digest = hashArchiveStateChallenge(message)
  return labSeatingWallet(domainId).signingKey.sign(digest).serialized as Hex
}

export function recoverArchiveStateChallenge(message: ArchiveStateChallengeTyped, signature: string): string {
  return getAddress(
    verifyTypedData(ARCHIVE_EIP712_DOMAIN, ARCHIVE_STATE_CHALLENGE_TYPES, archiveStateChallengeMessage(message), signature),
  )
}

export function archiveBftVoteMessage(input: ArchiveBftVoteTyped): ArchiveBftVoteTyped {
  return {
    valueHash: input.valueHash,
    height: input.height,
    round: input.round,
    step: input.step,
    membershipRoot: input.membershipRoot,
    prevoteQCRef: input.prevoteQCRef,
  }
}

export function hashArchiveBftVote(message: ArchiveBftVoteTyped): Hex {
  return TypedDataEncoder.hash(ARCHIVE_EIP712_DOMAIN, ARCHIVE_BFT_VOTE_TYPES, archiveBftVoteMessage(message)) as Hex
}

export function signArchiveBftVote(domainId: string, message: ArchiveBftVoteTyped): Hex {
  const digest = hashArchiveBftVote(message)
  return labSeatingWallet(domainId).signingKey.sign(digest).serialized as Hex
}

export function recoverArchiveBftVote(message: ArchiveBftVoteTyped, signature: string): string {
  return getAddress(verifyTypedData(ARCHIVE_EIP712_DOMAIN, ARCHIVE_BFT_VOTE_TYPES, archiveBftVoteMessage(message), signature))
}

export function archiveOnDemandAttestMessage(input: ArchiveOnDemandAttestTyped): ArchiveOnDemandAttestTyped {
  return {
    poolRoot: input.poolRoot,
    epoch: input.epoch,
    shardId: input.shardId,
    roulette: input.roulette,
  }
}

export function hashArchiveOnDemandAttest(message: ArchiveOnDemandAttestTyped): Hex {
  return TypedDataEncoder.hash(
    ARCHIVE_EIP712_DOMAIN,
    ARCHIVE_ONDEMAND_ATTEST_TYPES,
    archiveOnDemandAttestMessage(message),
  ) as Hex
}

export function signArchiveOnDemandAttest(domainId: string, message: ArchiveOnDemandAttestTyped): Hex {
  const digest = hashArchiveOnDemandAttest(message)
  return labSeatingWallet(domainId).signingKey.sign(digest).serialized as Hex
}

export function recoverArchiveOnDemandAttest(message: ArchiveOnDemandAttestTyped, signature: string): string {
  return getAddress(
    verifyTypedData(
      ARCHIVE_EIP712_DOMAIN,
      ARCHIVE_ONDEMAND_ATTEST_TYPES,
      archiveOnDemandAttestMessage(message),
      signature,
    ),
  )
}

export function archiveValidatorQuorumAttestMessage(
  input: ArchiveValidatorQuorumAttestTyped,
): ArchiveValidatorQuorumAttestTyped {
  return {
    requestId: input.requestId,
    valueHash: input.valueHash,
    tipStateRoot: input.tipStateRoot,
    bodyCommitment: input.bodyCommitment,
  }
}

export function hashArchiveValidatorQuorumAttest(message: ArchiveValidatorQuorumAttestTyped): Hex {
  return TypedDataEncoder.hash(
    ARCHIVE_EIP712_DOMAIN,
    ARCHIVE_VALIDATOR_QUORUM_ATTEST_TYPES,
    archiveValidatorQuorumAttestMessage(message),
  ) as Hex
}

/** `id` is the request-derived committee validatorId, not an archive domainId. */
export function signArchiveValidatorQuorumAttest(id: string, message: ArchiveValidatorQuorumAttestTyped): Hex {
  const digest = hashArchiveValidatorQuorumAttest(message)
  return labSeatingWallet(id).signingKey.sign(digest).serialized as Hex
}

export function recoverArchiveValidatorQuorumAttest(
  message: ArchiveValidatorQuorumAttestTyped,
  signature: string,
): string {
  return getAddress(
    verifyTypedData(
      ARCHIVE_EIP712_DOMAIN,
      ARCHIVE_VALIDATOR_QUORUM_ATTEST_TYPES,
      archiveValidatorQuorumAttestMessage(message),
      signature,
    ),
  )
}
