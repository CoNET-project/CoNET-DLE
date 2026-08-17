import { concatBytes, fromHex, keccak256, uintBE, utf8, ZERO32, type Hex } from './bytes.js'
import { isHmacBftVote, verifyEip712BftVote, votesEqual } from './mac.js'
import {
  ARCHIVE_QUORUM,
  CERT_KIND_ARCHIVE,
  CERT_KIND_PREVOTE_QC,
  ERR_BFT_HMAC_CUTOVER,
  ERR_BFT_VOTE_SIG,
  ERR_INVALID_QUORUM,
  ERR_SIGNER_NOT_ACTIVE,
  ERR_WAL_DOUBLE_SIGN,
  VOTE_STEP_PRECOMMIT,
  VOTE_STEP_PREVOTE,
  type ArchiveCertificate,
  type ArchivePrevoteQc,
  type ArchiveVote,
} from './types.js'

export function membershipRootOf(activeDomainIds: readonly string[]): Hex {
  const sorted = [...activeDomainIds].sort()
  return keccak256(
    concatBytes(utf8('dle.archive.lab.membership.v1'), ...sorted.map((id) => concatBytes(uintBE(id.length, 2), utf8(id)))),
  )
}

export function topicQcRef(input: {
  kind: number
  valueHash: Hex
  membershipRoot: Hex
  height: number
  round: number
  prevoteQCRef?: Hex
}): Hex {
  return keccak256(
    concatBytes(
      utf8('dle.archive.lab.qcref.v1'),
      uintBE(input.kind, 1),
      fromHex(input.valueHash, 32),
      fromHex(input.membershipRoot, 32),
      uintBE(input.height, 8),
      uintBE(input.round, 4),
      fromHex(input.prevoteQCRef ?? ZERO32, 32),
    ),
  )
}

export function voteSlotKey(vote: Pick<ArchiveVote, 'domainId' | 'height' | 'round' | 'step'>): string {
  return `${vote.domainId}:${vote.height}:${vote.round}:${vote.step}`
}

export function acceptVote(input: {
  vote: ArchiveVote
  existing: ArchiveVote | undefined
  activeDomainIds: readonly string[]
  membershipRoot: Hex
}): { ok: true; vote: ArchiveVote } | { ok: false; error: string } {
  if (!input.activeDomainIds.includes(input.vote.domainId)) {
    return { ok: false, error: ERR_SIGNER_NOT_ACTIVE }
  }
  if (input.vote.schema !== 'DleLabVoteV1') return { ok: false, error: 'ERR_INVALID_VOTE' }
  if (input.vote.membershipRoot !== input.membershipRoot) {
    return { ok: false, error: 'ERR_MEMBERSHIP_ROOT_MISMATCH' }
  }
  if (input.vote.step !== VOTE_STEP_PREVOTE && input.vote.step !== VOTE_STEP_PRECOMMIT) {
    return { ok: false, error: 'ERR_INVALID_VOTE' }
  }
  if (isHmacBftVote(input.vote)) return { ok: false, error: ERR_BFT_HMAC_CUTOVER }
  if (!verifyEip712BftVote(input.vote)) return { ok: false, error: ERR_BFT_VOTE_SIG }
  if (input.existing !== undefined && !votesEqual(input.existing, input.vote)) {
    return { ok: false, error: ERR_WAL_DOUBLE_SIGN }
  }
  return { ok: true, vote: input.vote }
}

export function matchingVotes(input: {
  votes: readonly ArchiveVote[]
  step: number
  valueHash: Hex
  height: number
  round: number
  membershipRoot: Hex
  prevoteQCRef?: Hex
}): ArchiveVote[] {
  return input.votes.filter((vote) => {
    if (vote.step !== input.step) return false
    if (vote.height !== input.height || vote.round !== input.round) return false
    if (vote.valueHash !== input.valueHash) return false
    if (vote.membershipRoot !== input.membershipRoot) return false
    if (input.prevoteQCRef !== undefined && vote.prevoteQCRef !== input.prevoteQCRef) return false
    return true
  })
}

export function uniqueActiveSigners(votes: readonly ArchiveVote[], activeDomainIds: readonly string[]): string[] {
  const seen = new Set<string>()
  const signers: string[] = []
  for (const vote of votes) {
    if (!activeDomainIds.includes(vote.domainId)) continue
    if (seen.has(vote.domainId)) continue
    seen.add(vote.domainId)
    signers.push(vote.domainId)
  }
  return signers.sort()
}

export function hasQuorum(signers: readonly string[]): boolean {
  return signers.length >= ARCHIVE_QUORUM
}

export function buildPrevoteQc(input: {
  valueHash: Hex
  membershipRoot: Hex
  height: number
  round: number
  signers: readonly string[]
}): { ok: true; prevoteQc: ArchivePrevoteQc } | { ok: false; error: string } {
  if (!hasQuorum(input.signers)) return { ok: false, error: ERR_INVALID_QUORUM }
  const qcRef = topicQcRef({
    kind: CERT_KIND_PREVOTE_QC,
    valueHash: input.valueHash,
    membershipRoot: input.membershipRoot,
    height: input.height,
    round: input.round,
  })
  return {
    ok: true,
    prevoteQc: {
      schema: 'DleLabPrevoteQcV1',
      kind: CERT_KIND_PREVOTE_QC,
      height: input.height,
      round: input.round,
      valueHash: input.valueHash,
      membershipRoot: input.membershipRoot,
      qcRef,
      quorum: ARCHIVE_QUORUM,
      signers: [...input.signers].sort(),
      networked: true,
      labOnly: true,
      note: 'Lab networked PrevoteQC. First-class hash object (kind=prevoteQc); not an AC field alias.',
    },
  }
}

export function buildArchiveCertificate(input: {
  valueHash: Hex
  tipStateRoot: Hex
  membershipRoot: Hex
  height: number
  round: number
  prevoteQCRef: Hex
  signers: readonly string[]
}): { ok: true; certificate: ArchiveCertificate } | { ok: false; error: string } {
  if (!hasQuorum(input.signers)) return { ok: false, error: ERR_INVALID_QUORUM }
  return {
    ok: true,
    certificate: {
      schema: 'DleLabArchiveCertificateV1',
      kind: CERT_KIND_ARCHIVE,
      height: input.height,
      round: input.round,
      valueHash: input.valueHash,
      tipStateRoot: input.tipStateRoot,
      prevoteQCRef: input.prevoteQCRef,
      membershipRoot: input.membershipRoot,
      quorum: ARCHIVE_QUORUM,
      signers: [...input.signers].sort(),
      networked: true,
      modeA: true,
      labOnly: true,
      note: 'Lab networked PrecommitQC. Votes are lab EIP-712 ArchiveBftVote; not a frozen EIP-712 L1 wrapper or corpus SSZ object.',
    },
  }
}

export { CERT_KIND_PREVOTE_QC }
