import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { getAddress } from 'ethers'
import { concatBytes, fromHex, toHex, utf8, ZERO32, type Hex } from '../../shared/bytes.js'
import {
  labSeatingAddress,
  recoverSyncQualificationSigner,
  signSyncQualificationCertificate,
  type ArchiveSyncQualificationCertificateMessage,
} from './eip712.js'
import type {
  ArchiveSyncHmacVoteV1,
  ArchiveSyncQualificationCertificateV1,
  ArchiveSyncVoteV1,
} from './types.js'
import { SYNC_QUORUM } from './types.js'

function macKey(domainId: string): Buffer {
  return createHash('sha256').update(`dle.archive.lab.sync.mac.v1|${domainId}`, 'utf8').digest()
}

function hmacVoteCanonicalBytes(vote: {
  domainId: string
  candidate: string
  challengeHash: Hex
  accept: boolean
  membershipRoot: Hex
}): Uint8Array {
  return concatBytes(
    utf8('dle.archive.lab.sync.vote.v1'),
    utf8(vote.domainId),
    utf8(vote.candidate),
    fromHex(vote.challengeHash, 32),
    utf8(vote.accept ? '1' : '0'),
    fromHex(vote.membershipRoot, 32),
  )
}

export function signHmacSyncVote(vote: {
  domainId: string
  candidate: string
  challengeHash: Hex
  accept: boolean
  membershipRoot: Hex
}): Hex {
  return toHex(createHmac('sha256', macKey(vote.domainId)).update(hmacVoteCanonicalBytes(vote)).digest())
}

export function makeHmacSyncVote(input: {
  domainId: string
  candidate: string
  challengeHash: Hex
  accept: boolean
  membershipRoot: Hex
}): ArchiveSyncHmacVoteV1 {
  return {
    schema: 'ArchiveSyncVoteV1',
    labOnly: true,
    hmacForgeable: true,
    notProductionSecp256k1: true,
    domainId: input.domainId,
    candidate: input.candidate,
    challengeHash: input.challengeHash,
    accept: input.accept,
    membershipRoot: input.membershipRoot,
    mac: signHmacSyncVote(input),
  }
}

export function verifyHmacSyncVote(vote: ArchiveSyncHmacVoteV1): boolean {
  if (vote.schema !== 'ArchiveSyncVoteV1' || vote.hmacForgeable !== true) return false
  let actual: Uint8Array
  try {
    actual = fromHex(vote.mac, 32)
  } catch {
    return false
  }
  const expected = fromHex(signHmacSyncVote(vote), 32)
  if (actual.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
}

export function isHmacSeatingVote(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  if (row.schema !== 'ArchiveSyncVoteV1') return false
  if (typeof row.mac === 'string') return true
  if (row.hmacForgeable === true) return true
  return row.eip712 !== true
}

function voteMessage(vote: ArchiveSyncQualificationCertificateMessage): ArchiveSyncQualificationCertificateMessage {
  return {
    groupId: vote.groupId,
    candidate: vote.candidate,
    challengeHash: vote.challengeHash,
    hostedChainSetRoot: vote.hostedChainSetRoot,
    lastACRef: vote.lastACRef,
    membershipRoot: vote.membershipRoot,
    hashIndexRoot: vote.hashIndexRoot,
    accept: vote.accept,
  }
}

export function makeSyncVote(input: {
  domainId: string
  candidate: string
  challengeHash: Hex
  accept: boolean
  membershipRoot: Hex
  groupId?: string
  hostedChainSetRoot?: Hex
  lastACRef?: Hex
  hashIndexRoot?: Hex
}): ArchiveSyncVoteV1 {
  const message = voteMessage({
    groupId: input.groupId ?? '',
    candidate: input.candidate,
    challengeHash: input.challengeHash,
    hostedChainSetRoot: input.hostedChainSetRoot ?? ZERO32,
    lastACRef: input.lastACRef ?? ZERO32,
    membershipRoot: input.membershipRoot,
    hashIndexRoot: input.hashIndexRoot ?? ZERO32,
    accept: input.accept,
  })
  const signer = labSeatingAddress(input.domainId)
  return {
    schema: 'ArchiveSyncVoteV1',
    labOnly: true,
    eip712: true,
    hmacForgeable: false,
    notProductionSecp256k1: true,
    notProductionOperatorKey: true,
    labDeterministicSeatingKey: true,
    notL1Settled: true,
    domainId: input.domainId,
    ...message,
    signer,
    signature: signSyncQualificationCertificate(input.domainId, message),
  }
}

export function recoverSyncVoteSigner(vote: ArchiveSyncVoteV1): string {
  return recoverSyncQualificationSigner(voteMessage(vote), vote.signature)
}

export function verifyEip712SeatingVote(vote: ArchiveSyncVoteV1, accept: boolean): boolean {
  if (vote.schema !== 'ArchiveSyncVoteV1') return false
  if (vote.eip712 !== true || vote.hmacForgeable !== false) return false
  if (vote.accept !== accept) return false
  if (typeof vote.signature !== 'string' || typeof vote.signer !== 'string') return false
  try {
    const recovered = getAddress(recoverSyncVoteSigner(vote))
    const expected = getAddress(labSeatingAddress(vote.domainId))
    return recovered === expected && getAddress(vote.signer) === expected
  } catch {
    return false
  }
}

export function verifySyncVote(vote: ArchiveSyncVoteV1): boolean {
  return verifyEip712SeatingVote(vote, true)
}

export function verifySyncRejectVote(vote: ArchiveSyncVoteV1): boolean {
  return verifyEip712SeatingVote(vote, false)
}

export function signCandidateAcceptance(input: {
  candidate: string
  challengeHash: Hex
  membershipRoot: Hex
  groupId?: string
  hostedChainSetRoot?: Hex
  lastACRef?: Hex
  hashIndexRoot?: Hex
}): Hex {
  return makeSyncVote({
    domainId: input.candidate,
    candidate: input.candidate,
    challengeHash: input.challengeHash,
    accept: true,
    membershipRoot: input.membershipRoot,
    groupId: input.groupId,
    hostedChainSetRoot: input.hostedChainSetRoot,
    lastACRef: input.lastACRef,
    hashIndexRoot: input.hashIndexRoot,
  }).signature
}

export function uniqueAcceptingSigners(
  votes: readonly ArchiveSyncVoteV1[],
  activeDomainIds: readonly string[],
  candidate: string,
  challengeHash: Hex,
  membershipRoot: Hex,
  roots?: {
    groupId: string
    hostedChainSetRoot: Hex
    lastACRef: Hex
    hashIndexRoot: Hex
  },
): string[] {
  const signers = new Set<string>()
  for (const vote of votes) {
    if (vote.candidate !== candidate) continue
    if (vote.challengeHash !== challengeHash) continue
    if (vote.membershipRoot !== membershipRoot) continue
    if (roots !== undefined) {
      if (vote.groupId !== roots.groupId) continue
      if (vote.hostedChainSetRoot !== roots.hostedChainSetRoot) continue
      if (vote.lastACRef !== roots.lastACRef) continue
      if (vote.hashIndexRoot !== roots.hashIndexRoot) continue
    }
    if (vote.domainId === candidate) continue
    if (!activeDomainIds.includes(vote.domainId)) continue
    if (!verifySyncVote(vote)) continue
    signers.add(vote.domainId)
  }
  return [...signers].sort()
}

export function hasSyncQuorum(signers: readonly string[]): boolean {
  return signers.length >= SYNC_QUORUM
}

export function buildCertificate(input: {
  groupId: string
  candidate: string
  challengeHash: Hex
  hostedChainSetRoot: Hex
  lastACRef: Hex
  membershipRoot: Hex
  hashIndexRoot: Hex
  votes: ArchiveSyncVoteV1[]
  activeDomainIds: readonly string[]
}): ArchiveSyncQualificationCertificateV1 | { ok: false; reason: string } {
  const roots = {
    groupId: input.groupId,
    hostedChainSetRoot: input.hostedChainSetRoot,
    lastACRef: input.lastACRef,
    hashIndexRoot: input.hashIndexRoot,
  }
  const signers = uniqueAcceptingSigners(
    input.votes,
    input.activeDomainIds,
    input.candidate,
    input.challengeHash,
    input.membershipRoot,
    roots,
  )
  if (!hasSyncQuorum(signers)) return { ok: false, reason: 'ERR_SYNC_QUORUM' }
  const accepted = input.votes.filter((vote) => signers.includes(vote.domainId))
  return {
    schema: 'ArchiveSyncQualificationCertificateV1',
    labOnly: true,
    eip712: true,
    hmacForgeable: false,
    notProductionSecp256k1: true,
    notProductionOperatorKey: true,
    labDeterministicSeatingKey: true,
    notL1Settled: true,
    notThirtyDayQualification: true,
    groupId: input.groupId,
    candidate: input.candidate,
    challengeHash: input.challengeHash,
    hostedChainSetRoot: input.hostedChainSetRoot,
    lastACRef: input.lastACRef,
    membershipRoot: input.membershipRoot,
    hashIndexRoot: input.hashIndexRoot,
    votes: accepted,
    candidateAcceptance: signCandidateAcceptance({
      candidate: input.candidate,
      challengeHash: input.challengeHash,
      membershipRoot: input.membershipRoot,
      groupId: input.groupId,
      hostedChainSetRoot: input.hostedChainSetRoot,
      lastACRef: input.lastACRef,
      hashIndexRoot: input.hashIndexRoot,
    }),
    issuedAt: new Date().toISOString(),
  }
}
