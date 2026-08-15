import test from 'node:test'
import assert from 'node:assert/strict'
import { keccak256Utf8, ZERO32 } from '../src/archive/bft/bytes.js'
import { signLabVote } from '../src/archive/bft/mac.js'
import {
  acceptVote,
  hasQuorum,
  matchingVotes,
  membershipRootOf,
  uniqueActiveSigners,
} from '../src/archive/bft/quorum.js'
import { applyArchiveRoundInput, createEmptyRoundState } from '../src/archive/bft/tendermint.js'
import {
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
    prevoteQCRef: step === VOTE_STEP_PRECOMMIT ? QC_REF : ZERO32,
  }
  return { schema: 'DleLabVoteV1', ...unsigned, mac: signLabVote(unsigned) }
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
