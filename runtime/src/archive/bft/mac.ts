import { createHmac, createHash } from 'node:crypto'
import { getAddress } from 'ethers'
import {
  labSeatingAddress,
  recoverArchiveBftVote,
  signArchiveBftVote,
  type ArchiveBftVoteTyped,
} from '../syncQualification/eip712.js'
import { concatBytes, fromHex, toHex, uintBE, utf8, type Hex } from './bytes.js'
import type { ArchiveVote } from './types.js'

export type ArchiveBftVoteUnsigned = {
  domainId: string
  height: number
  round: number
  step: number
  valueHash: Hex
  membershipRoot: Hex
  prevoteQCRef: Hex
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function macKey(domainId: string): Buffer {
  return createHash('sha256').update(`dle.archive.lab.mac.v1|${domainId}`, 'utf8').digest()
}

export function voteCanonicalBytes(vote: ArchiveBftVoteUnsigned): Uint8Array {
  return concatBytes(
    utf8('dle.archive.lab.vote.v1'),
    fromHex(vote.valueHash, 32),
    uintBE(vote.height, 8),
    uintBE(vote.round, 4),
    uintBE(vote.step, 1),
    utf8(vote.domainId),
    fromHex(vote.membershipRoot, 32),
    fromHex(vote.prevoteQCRef, 32),
  )
}

/** Legacy HMAC. Tests use this to prove P16 cutover. New votes must not use it. */
export function signHmacLabVote(vote: ArchiveBftVoteUnsigned): Hex {
  const digest = createHmac('sha256', macKey(vote.domainId)).update(voteCanonicalBytes(vote)).digest()
  return toHex(digest)
}

export function makeHmacLabVote(vote: ArchiveBftVoteUnsigned): ArchiveVote {
  return {
    schema: 'DleLabVoteV1',
    ...vote,
    hmacForgeable: true,
    eip712: false,
    mac: signHmacLabVote(vote),
  }
}

export function isHmacBftVote(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (value.schema !== 'DleLabVoteV1') return false
  if (value.hmacForgeable === true) return true
  if (typeof value.mac === 'string' && value.eip712 !== true) return true
  if (value.eip712 !== true) return true
  if (typeof value.signature !== 'string') return true
  return false
}

export function archiveBftVoteTyped(vote: ArchiveBftVoteUnsigned): ArchiveBftVoteTyped {
  return {
    valueHash: vote.valueHash,
    height: vote.height,
    round: vote.round,
    step: vote.step,
    membershipRoot: vote.membershipRoot,
    prevoteQCRef: vote.prevoteQCRef,
  }
}

export function signLabVote(vote: ArchiveBftVoteUnsigned): Hex {
  return signArchiveBftVote(vote.domainId, archiveBftVoteTyped(vote))
}

export function makeLabBftVote(vote: ArchiveBftVoteUnsigned): ArchiveVote {
  const signer = labSeatingAddress(vote.domainId)
  return {
    schema: 'DleLabVoteV1',
    ...vote,
    eip712: true,
    hmacForgeable: false,
    labDeterministicSeatingKey: true,
    notProductionOperatorKey: true,
    notL1Settled: true,
    signer,
    signature: signLabVote(vote),
  }
}

export function recoverLabBftVoteSigner(vote: ArchiveVote): string {
  if (typeof vote.signature !== 'string') throw new Error('ERR_BFT_VOTE_SIG')
  return recoverArchiveBftVote(archiveBftVoteTyped(vote), vote.signature)
}

export function verifyEip712BftVote(vote: ArchiveVote): boolean {
  if (vote.schema !== 'DleLabVoteV1') return false
  if (vote.eip712 !== true || vote.hmacForgeable !== false) return false
  if (typeof vote.signature !== 'string' || typeof vote.signer !== 'string') return false
  try {
    const recovered = getAddress(recoverLabBftVoteSigner(vote))
    const expected = getAddress(labSeatingAddress(vote.domainId))
    return recovered === expected && getAddress(vote.signer) === expected
  } catch {
    return false
  }
}

export function verifyLabVote(vote: ArchiveVote): boolean {
  return verifyEip712BftVote(vote)
}

export function votesEqual(left: ArchiveVote, right: ArchiveVote): boolean {
  return (
    left.domainId === right.domainId &&
    left.height === right.height &&
    left.round === right.round &&
    left.step === right.step &&
    left.valueHash === right.valueHash &&
    left.membershipRoot === right.membershipRoot &&
    left.prevoteQCRef === right.prevoteQCRef &&
    (left.signature ?? '') === (right.signature ?? '') &&
    (left.signer ?? '') === (right.signer ?? '') &&
    (left.mac ?? '') === (right.mac ?? '')
  )
}

export function parseArchiveVote(value: unknown): ArchiveVote | null {
  if (!isRecord(value) || value.schema !== 'DleLabVoteV1') return null
  if (typeof value.domainId !== 'string') return null
  if (typeof value.height !== 'number' || typeof value.round !== 'number' || typeof value.step !== 'number') {
    return null
  }
  if (
    typeof value.valueHash !== 'string' ||
    typeof value.membershipRoot !== 'string' ||
    typeof value.prevoteQCRef !== 'string'
  ) {
    return null
  }
  const hasMac = typeof value.mac === 'string'
  const hasSig = typeof value.signature === 'string' && typeof value.signer === 'string'
  if (!hasMac && !hasSig) return null
  const vote: ArchiveVote = {
    schema: 'DleLabVoteV1',
    domainId: value.domainId,
    height: value.height,
    round: value.round,
    step: value.step,
    valueHash: value.valueHash as Hex,
    membershipRoot: value.membershipRoot as Hex,
    prevoteQCRef: value.prevoteQCRef as Hex,
  }
  if (typeof value.eip712 === 'boolean') vote.eip712 = value.eip712
  if (typeof value.hmacForgeable === 'boolean') vote.hmacForgeable = value.hmacForgeable
  if (typeof value.labDeterministicSeatingKey === 'boolean') {
    vote.labDeterministicSeatingKey = value.labDeterministicSeatingKey
  }
  if (typeof value.notProductionOperatorKey === 'boolean') {
    vote.notProductionOperatorKey = value.notProductionOperatorKey
  }
  if (typeof value.notL1Settled === 'boolean') vote.notL1Settled = value.notL1Settled
  if (hasMac) vote.mac = value.mac as Hex
  if (hasSig) {
    vote.signature = value.signature as Hex
    vote.signer = value.signer
  }
  return vote
}
