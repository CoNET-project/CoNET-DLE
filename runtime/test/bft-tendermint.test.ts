import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { keccak256Utf8, ZERO32 } from '../src/archive/bft/bytes.js'
import { createArchiveBftEngine } from '../src/archive/bft/engine.js'
import { openArchiveStore } from '../src/archive/store.js'
import { labSeatingAddress } from '../src/archive/syncQualification/eip712.js'
import {
  isHmacBftVote,
  makeHmacLabVote,
  makeLabBftVote,
  parseArchiveVote,
  recoverLabBftVoteSigner,
  verifyEip712BftVote,
} from '../src/archive/bft/mac.js'
import { emptyHashIndexRoot, hashIndexCommittedInAc } from '../src/shared/hashIndexTree.js'
import {
  acceptVote,
  matchingVotes,
  membershipRootOf,
  topicQcRef,
  uniqueActiveSigners,
  hasQuorum,
} from '../src/archive/bft/quorum.js'
import { applyArchiveRoundInput, createEmptyRoundState } from '../src/archive/bft/tendermint.js'
import {
  ARCHIVE_QUORUM,
  CERT_KIND_ARCHIVE,
  CERT_KIND_PREVOTE_QC,
  ERR_BFT_HASH_INDEX_ROOT,
  ERR_BFT_HMAC_CUTOVER,
  ERR_BFT_VOTE_SIG,
  ERR_WAL_DOUBLE_SIGN,
  NONE_ROUND,
  VOTE_STEP_PRECOMMIT,
  VOTE_STEP_PREVOTE,
  type ArchiveVote,
} from '../src/archive/bft/types.js'

const VALUE_A = keccak256Utf8('value-a')
const VALUE_B = keccak256Utf8('value-b')
const QC_REF = keccak256Utf8('qc-ref')
const ACTIVE = ['fd-01', 'fd-02', 'fd-03', 'fd-04', 'fd-05']

function voteOf(domainId: string, step: number, valueHash = VALUE_A): ArchiveVote {
  const unsigned = {
    domainId,
    height: 1,
    round: 0,
    step,
    valueHash,
    membershipRoot: membershipRootOf(ACTIVE),
    hashIndexRoot: ZERO32,
    prevoteQCRef: step === VOTE_STEP_PRECOMMIT ? QC_REF : ZERO32,
  }
  return makeLabBftVote(unsigned)
}

test('unlocked proposal prevotes the available value and four prevotes lock then commit', () => {
  let state = createEmptyRoundState()
  const proposed = applyArchiveRoundInput(state, {
    type: 'PROPOSAL',
    value: VALUE_A,
    available: true,
    validRound: NONE_ROUND,
    validPrevoteQCRef: ZERO32,
  })
  assert.equal(proposed.outputs[0]?.action, 'PREVOTE')
  assert.equal(proposed.outputs[0]?.value, VALUE_A)
  state = proposed.state
  const locked = applyArchiveRoundInput(state, { type: 'PREVOTE_QC', value: VALUE_A, qcRef: QC_REF })
  assert.equal(locked.state.lockedValue, VALUE_A)
  assert.equal(locked.outputs[0]?.action, 'PRECOMMIT')
  state = locked.state
  const committed = applyArchiveRoundInput(state, { type: 'PRECOMMIT_QC', value: VALUE_A, acRef: keccak256Utf8('ac') })
  assert.equal(committed.state.step, 'COMMITTED')
})

test('lock conflict prevotes nil unless a higher validRound QC exists', () => {
  let state = createEmptyRoundState()
  state = applyArchiveRoundInput(state, {
    type: 'PROPOSAL',
    value: VALUE_A,
    available: true,
    validRound: NONE_ROUND,
    validPrevoteQCRef: ZERO32,
  }).state
  state = applyArchiveRoundInput(state, { type: 'PREVOTE_QC', value: VALUE_A, qcRef: QC_REF }).state
  state = { ...state, step: 'PROPOSE' }
  const conflict = applyArchiveRoundInput(state, {
    type: 'PROPOSAL',
    value: VALUE_B,
    available: true,
    validRound: NONE_ROUND,
    validPrevoteQCRef: ZERO32,
  })
  assert.equal(conflict.outputs[0]?.value, ZERO32)
  const justified = applyArchiveRoundInput(state, {
    type: 'PROPOSAL',
    value: VALUE_B,
    available: true,
    validRound: 1,
    validPrevoteQCRef: keccak256Utf8('higher'),
  })
  assert.equal(justified.outputs[0]?.value, VALUE_B)
})

test('three matching votes are not a 4-of-5 quorum; four are', () => {
  const three = ACTIVE.slice(0, 3).map((id) => voteOf(id, VOTE_STEP_PREVOTE))
  const four = ACTIVE.slice(0, 4).map((id) => voteOf(id, VOTE_STEP_PREVOTE))
  const root = membershipRootOf(ACTIVE)
  assert.equal(
    hasQuorum(
      uniqueActiveSigners(
        matchingVotes({
          votes: three,
          step: VOTE_STEP_PREVOTE,
          valueHash: VALUE_A,
          height: 1,
          round: 0,
          membershipRoot: root,
        }),
        ACTIVE,
      ),
    ),
    false,
  )
  assert.equal(
    hasQuorum(
      uniqueActiveSigners(
        matchingVotes({
          votes: four,
          step: VOTE_STEP_PREVOTE,
          valueHash: VALUE_A,
          height: 1,
          round: 0,
          membershipRoot: root,
        }),
        ACTIVE,
      ),
    ),
    true,
  )
})

test('same slot with different bytes is double-sign', () => {
  const first = voteOf('fd-01', VOTE_STEP_PREVOTE, VALUE_A)
  const second = voteOf('fd-01', VOTE_STEP_PREVOTE, VALUE_B)
  const accepted = acceptVote({
    vote: second,
    existing: first,
    activeDomainIds: ACTIVE,
    membershipRoot: membershipRootOf(ACTIVE),
  })
  assert.equal(accepted.ok, false)
  if (!accepted.ok) assert.equal(accepted.error, ERR_WAL_DOUBLE_SIGN)
})

test('standby domain is not an active signer', () => {
  const vote = voteOf('fd-standby', VOTE_STEP_PRECOMMIT)
  const accepted = acceptVote({
    vote,
    existing: undefined,
    activeDomainIds: ACTIVE,
    membershipRoot: membershipRootOf(ACTIVE),
  })
  assert.equal(accepted.ok, false)
})

test('P16 cutover rejects HMAC and unsigned BFT votes', () => {
  const unsigned = {
    domainId: 'fd-01',
    height: 1,
    round: 0,
    step: VOTE_STEP_PREVOTE,
    valueHash: VALUE_A,
    membershipRoot: membershipRootOf(ACTIVE),
    hashIndexRoot: ZERO32,
    prevoteQCRef: ZERO32,
  }
  const hmac = makeHmacLabVote(unsigned)
  assert.equal(isHmacBftVote(hmac), true)
  const hmacAccepted = acceptVote({
    vote: hmac,
    existing: undefined,
    activeDomainIds: ACTIVE,
    membershipRoot: unsigned.membershipRoot,
  })
  assert.equal(hmacAccepted.ok, false)
  if (!hmacAccepted.ok) assert.equal(hmacAccepted.error, ERR_BFT_HMAC_CUTOVER)

  const labeledHmac = { ...makeLabBftVote(unsigned), hmacForgeable: true as const }
  const labeled = acceptVote({
    vote: labeledHmac,
    existing: undefined,
    activeDomainIds: ACTIVE,
    membershipRoot: unsigned.membershipRoot,
  })
  assert.equal(labeled.ok, false)
  if (!labeled.ok) assert.equal(labeled.error, ERR_BFT_HMAC_CUTOVER)
})

test('P16 recoverAddress binds the seating key; tampered signature fails SIG', () => {
  const vote = voteOf('fd-02', VOTE_STEP_PREVOTE)
  assert.equal(vote.eip712, true)
  assert.equal(vote.hmacForgeable, false)
  assert.equal(vote.signer, labSeatingAddress('fd-02'))
  assert.equal(verifyEip712BftVote(vote), true)
  assert.equal(recoverLabBftVoteSigner(vote), labSeatingAddress('fd-02'))
  const accepted = acceptVote({
    vote,
    existing: undefined,
    activeDomainIds: ACTIVE,
    membershipRoot: membershipRootOf(ACTIVE),
  })
  assert.equal(accepted.ok, true)

  const wrongSigner = { ...vote, signer: labSeatingAddress('fd-03') }
  const mismatched = acceptVote({
    vote: wrongSigner,
    existing: undefined,
    activeDomainIds: ACTIVE,
    membershipRoot: membershipRootOf(ACTIVE),
  })
  assert.equal(mismatched.ok, false)
  if (!mismatched.ok) assert.equal(mismatched.error, ERR_BFT_VOTE_SIG)

  const tampered = {
    ...vote,
    signature: `0x${'11'.repeat(65)}` as typeof vote.signature,
  }
  const bad = acceptVote({
    vote: tampered,
    existing: undefined,
    activeDomainIds: ACTIVE,
    membershipRoot: membershipRootOf(ACTIVE),
  })
  assert.equal(bad.ok, false)
  if (!bad.ok) assert.equal(bad.error, ERR_BFT_VOTE_SIG)
})

test('P16 keep-only restores a disk HMAC certificate and labels status EIP-712', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'dle-p16-bft-'))
  try {
    const store = openArchiveStore(dataDir)
    store.persistBftState({
      schema: 'DleLabBftStateV1',
      votes: ACTIVE.slice(0, 4).map((domainId) =>
        makeHmacLabVote({
          domainId,
          height: 1,
          round: 0,
          step: VOTE_STEP_PREVOTE,
          valueHash: VALUE_A,
          membershipRoot: membershipRootOf(ACTIVE),
          hashIndexRoot: ZERO32,
          prevoteQCRef: ZERO32,
        }),
      ),
      certificate: {
        schema: 'DleLabArchiveCertificateV1',
        kind: CERT_KIND_ARCHIVE,
        height: 1,
        round: 0,
        valueHash: VALUE_A,
        tipStateRoot: VALUE_B,
        prevoteQCRef: QC_REF,
        membershipRoot: membershipRootOf(ACTIVE),
        quorum: ARCHIVE_QUORUM,
        signers: ACTIVE.slice(0, 4),
        networked: true,
        modeA: true,
        labOnly: true,
        note: 'legacy hmac ac',
      },
      prevoteQc: null,
    })
    const engine = createArchiveBftEngine({
      domainId: 'fd-01',
      role: 'active',
      peers: [],
      store,
    })
    assert.equal(engine.certificate() !== null, true)
    const status = engine.status()
    assert.equal(status.certificateAvailable, true)
    assert.equal(status.eip712, true)
    assert.equal(status.hmacForgeable, false)
    assert.equal(status.bftEip712, true)
    assert.equal(status.prevoteCount, 0)
    assert.equal(engine.certificate()?.hashIndexRoot, ZERO32)
    assert.equal(hashIndexCommittedInAc(engine.certificate()), false)
    assert.equal(engine.facadeViews().certificate.hashIndexRoot, ZERO32)
    engine.stop()
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('P21 HMAC cutover still wins over a wrong expected hashIndexRoot', () => {
  const unsigned = {
    domainId: 'fd-01',
    height: 1,
    round: 0,
    step: VOTE_STEP_PREVOTE,
    valueHash: VALUE_A,
    membershipRoot: membershipRootOf(ACTIVE),
    hashIndexRoot: ZERO32,
    prevoteQCRef: ZERO32,
  }
  const hmac = makeHmacLabVote(unsigned)
  const accepted = acceptVote({
    vote: hmac,
    existing: undefined,
    activeDomainIds: ACTIVE,
    membershipRoot: unsigned.membershipRoot,
    expectedHashIndexRoot: VALUE_A,
  })
  assert.equal(accepted.ok, false)
  if (!accepted.ok) assert.equal(accepted.error, ERR_BFT_HMAC_CUTOVER)
})

test('P21 bad signature is reported before hashIndexRoot mismatch', () => {
  const vote = voteOf('fd-01', VOTE_STEP_PREVOTE)
  const tampered = {
    ...vote,
    hashIndexRoot: VALUE_A,
    signature: `0x${'11'.repeat(65)}` as typeof vote.signature,
  }
  const accepted = acceptVote({
    vote: tampered,
    existing: undefined,
    activeDomainIds: ACTIVE,
    membershipRoot: membershipRootOf(ACTIVE),
    expectedHashIndexRoot: ZERO32,
  })
  assert.equal(accepted.ok, false)
  if (!accepted.ok) assert.equal(accepted.error, ERR_BFT_VOTE_SIG)
})

test('P21 wrong expected hashIndexRoot is ERR_BFT_HASH_INDEX_ROOT', () => {
  const vote = voteOf('fd-01', VOTE_STEP_PREVOTE)
  const accepted = acceptVote({
    vote,
    existing: undefined,
    activeDomainIds: ACTIVE,
    membershipRoot: membershipRootOf(ACTIVE),
    expectedHashIndexRoot: VALUE_A,
  })
  assert.equal(accepted.ok, false)
  if (!accepted.ok) assert.equal(accepted.error, ERR_BFT_HASH_INDEX_ROOT)
})

test('P21 different hashIndexRoot values produce different topicQcRef', () => {
  const base = {
    kind: CERT_KIND_PREVOTE_QC,
    valueHash: VALUE_A,
    membershipRoot: membershipRootOf(ACTIVE),
    height: 1,
    round: 0,
  }
  assert.notEqual(topicQcRef({ ...base, hashIndexRoot: ZERO32 }), topicQcRef({ ...base, hashIndexRoot: VALUE_A }))
})

test('P21 missing vote hashIndexRoot parses as ZERO32; invalid present field fails', () => {
  const vote = voteOf('fd-03', VOTE_STEP_PREVOTE)
  const { hashIndexRoot: _omitted, ...withoutRoot } = vote
  const parsed = parseArchiveVote(withoutRoot)
  assert.equal(parsed?.hashIndexRoot, ZERO32)
  assert.equal(parseArchiveVote({ ...vote, hashIndexRoot: '0xzz' }), null)
})

test('P21 matchingVotes filters on hashIndexRoot when provided', () => {
  const zero = voteOf('fd-01', VOTE_STEP_PREVOTE)
  const other = makeLabBftVote({
    domainId: 'fd-02',
    height: 1,
    round: 0,
    step: VOTE_STEP_PREVOTE,
    valueHash: VALUE_A,
    membershipRoot: membershipRootOf(ACTIVE),
    hashIndexRoot: VALUE_A,
    prevoteQCRef: ZERO32,
  })
  const root = membershipRootOf(ACTIVE)
  assert.equal(
    matchingVotes({
      votes: [zero, other],
      step: VOTE_STEP_PREVOTE,
      valueHash: VALUE_A,
      height: 1,
      round: 0,
      membershipRoot: root,
      hashIndexRoot: ZERO32,
    }).length,
    1,
  )
  assert.equal(
    matchingVotes({
      votes: [zero, other],
      step: VOTE_STEP_PREVOTE,
      valueHash: VALUE_A,
      height: 1,
      round: 0,
      membershipRoot: root,
    }).length,
    2,
  )
})

test('P21 persist AC with emptyHashIndexRoot exposes overlay true', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'dle-p21-bft-'))
  const emptyRoot = emptyHashIndexRoot()
  try {
    const store = openArchiveStore(dataDir)
    store.persistBftState({
      schema: 'DleLabBftStateV1',
      votes: [],
      certificate: {
        schema: 'DleLabArchiveCertificateV1',
        kind: CERT_KIND_ARCHIVE,
        height: 1,
        round: 0,
        valueHash: VALUE_A,
        tipStateRoot: VALUE_B,
        prevoteQCRef: QC_REF,
        membershipRoot: membershipRootOf(ACTIVE),
        hashIndexRoot: emptyRoot,
        quorum: ARCHIVE_QUORUM,
        signers: ACTIVE.slice(0, 4),
        networked: true,
        modeA: true,
        labOnly: true,
        note: 'p21 empty hash index ac',
      },
      prevoteQc: null,
    })
    const engine = createArchiveBftEngine({
      domainId: 'fd-01',
      role: 'active',
      peers: [],
      store,
    })
    assert.equal(engine.certificate()?.hashIndexRoot, emptyRoot)
    assert.notEqual(emptyRoot, ZERO32)
    assert.equal(hashIndexCommittedInAc(engine.certificate()), true)
    assert.equal(engine.facadeViews().certificate.hashIndexRoot, emptyRoot)
    engine.stop()
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})
