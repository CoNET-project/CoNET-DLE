import { ZERO32, type Hex } from './bytes.js'
import { NONE_ROUND } from './types.js'

export type ArchiveRoundStep = 'PROPOSE' | 'PREVOTE' | 'PRECOMMIT' | 'COMMITTED'

export interface ArchiveRoundState {
  height: number
  round: number
  step: ArchiveRoundStep
  lockedValue: Hex
  lockedRound: number
  validValue: Hex
  validRound: number
  validPrevoteQCRef: Hex
  committedAcRef: Hex
}

export type ArchiveRoundInput =
  | {
      type: 'PROPOSAL'
      value: Hex
      available: boolean
      validRound: number
      validPrevoteQCRef: Hex
    }
  | { type: 'PREVOTE_QC'; value: Hex; qcRef: Hex }
  | { type: 'PRECOMMIT_QC'; value: Hex; acRef: Hex }

export interface ArchiveRoundOutput {
  action: 'PREVOTE' | 'PRECOMMIT' | 'COMMIT'
  value: Hex
  reference: Hex
}

export interface ArchiveRoundTransition {
  state: ArchiveRoundState
  outputs: readonly ArchiveRoundOutput[]
  error?: string
}

export function createEmptyRoundState(height = 1, round = 0): ArchiveRoundState {
  return {
    height,
    round,
    step: 'PROPOSE',
    lockedValue: ZERO32,
    lockedRound: NONE_ROUND,
    validValue: ZERO32,
    validRound: NONE_ROUND,
    validPrevoteQCRef: ZERO32,
    committedAcRef: ZERO32,
  }
}

export function applyArchiveRoundInput(
  previous: ArchiveRoundState,
  input: ArchiveRoundInput,
): ArchiveRoundTransition {
  const state = { ...previous }
  switch (input.type) {
    case 'PROPOSAL': {
      if (state.step !== 'PROPOSE') {
        return { state, outputs: [], error: 'ERR_LOCK_CONFLICT' }
      }
      let vote = ZERO32
      if (input.available && input.value !== ZERO32) {
        const unlocked = state.lockedRound === NONE_ROUND
        const sameLock = state.lockedValue === input.value
        const higherJustification =
          input.validRound !== NONE_ROUND &&
          state.lockedRound !== NONE_ROUND &&
          input.validRound > state.lockedRound &&
          input.validPrevoteQCRef !== ZERO32
        if (unlocked || sameLock || higherJustification) vote = input.value
      }
      state.step = 'PREVOTE'
      return { state, outputs: [{ action: 'PREVOTE', value: vote, reference: ZERO32 }] }
    }
    case 'PREVOTE_QC': {
      if (state.step !== 'PREVOTE') {
        return { state, outputs: [], error: 'ERR_INVALID_CERTIFICATE_KIND' }
      }
      state.step = 'PRECOMMIT'
      if (input.value === ZERO32) {
        return { state, outputs: [{ action: 'PRECOMMIT', value: ZERO32, reference: ZERO32 }] }
      }
      if (input.qcRef === ZERO32) {
        return { state, outputs: [], error: 'ERR_INVALID_CERTIFICATE_REFERENCE' }
      }
      state.validValue = input.value
      state.validRound = state.round
      state.validPrevoteQCRef = input.qcRef
      state.lockedValue = input.value
      state.lockedRound = state.round
      return { state, outputs: [{ action: 'PRECOMMIT', value: input.value, reference: input.qcRef }] }
    }
    case 'PRECOMMIT_QC': {
      if (state.step !== 'PRECOMMIT') {
        return { state, outputs: [], error: 'ERR_INVALID_CERTIFICATE_KIND' }
      }
      if (input.value === ZERO32 || input.acRef === ZERO32) {
        return { state, outputs: [], error: 'ERR_INVALID_CERTIFICATE_REFERENCE' }
      }
      state.step = 'COMMITTED'
      state.committedAcRef = input.acRef
      return { state, outputs: [{ action: 'COMMIT', value: input.value, reference: input.acRef }] }
    }
  }
}
