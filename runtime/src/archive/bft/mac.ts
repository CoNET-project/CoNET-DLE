import { createHmac, createHash, timingSafeEqual } from 'node:crypto'
import { concatBytes, fromHex, toHex, uintBE, utf8, type Hex } from './bytes.js'
import type { ArchiveVote } from './types.js'

function macKey(domainId: string): Buffer {
  return createHash('sha256').update(`dle.archive.lab.mac.v1|${domainId}`, 'utf8').digest()
}

export function voteCanonicalBytes(vote: Omit<ArchiveVote, 'mac' | 'schema'>): Uint8Array {
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

export function signLabVote(vote: Omit<ArchiveVote, 'mac' | 'schema'>): Hex {
  const digest = createHmac('sha256', macKey(vote.domainId)).update(voteCanonicalBytes(vote)).digest()
  return toHex(digest)
}

export function verifyLabVote(vote: ArchiveVote): boolean {
  const expected = fromHex(signLabVote(vote), 32)
  let actual: Uint8Array
  try {
    actual = fromHex(vote.mac, 32)
  } catch {
    return false
  }
  if (actual.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
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
    left.mac === right.mac
  )
}
