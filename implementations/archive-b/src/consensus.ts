import {
  ZERO32,
  type Hex,
  type MembershipView,
  type ProposalInput,
  type TendermintState,
  type VoteIntent,
} from './types.js';
import { concat, getBytes, sha256, toUtf8Bytes } from 'ethers';

export type DurableTransition = (
  event: string,
  before: TendermintState,
  after: TendermintState,
  output: VoteIntent | null,
) => Promise<void>;

function cloneState(state: TendermintState): TendermintState {
  return { ...state };
}

function error(code: string): never {
  throw new Error(code);
}

export function initialTendermintState(height = 0n, round = 0): TendermintState {
  return {
    height,
    round,
    step: 'PROPOSE',
    mode: 'VOTING',
    lockedValueHash: null,
    lockedRound: null,
    validValueHash: null,
    validRound: null,
    validPrevoteQCRef: null,
    committedValueHash: null,
    committedAcRef: null,
    rejectRef: null,
    recoveryCode: null,
  };
}

export class ArchiveTendermint {
  readonly #persist: DurableTransition;
  readonly #firstProposal = new Map<number, { proposalHash: Hex; valueHash: Hex }>();
  #state: TendermintState;
  #rejectConflictKey: string | null = null;
  #acceptQcConflictKey: string | null = null;
  #finalConflictKey: string | null = null;

  constructor(state: TendermintState, persist: DurableTransition = async () => undefined) {
    this.#state = cloneState(state);
    this.#persist = persist;
  }

  get state(): TendermintState {
    return cloneState(this.#state);
  }

  async #commit(
    event: string,
    mutate: (draft: TendermintState) => VoteIntent | null,
  ): Promise<VoteIntent | null> {
    if (this.#state.recoveryCode) error('ERR_WAL_RECOVERY_REQUIRED');
    const before = cloneState(this.#state);
    const draft = cloneState(this.#state);
    const output = mutate(draft);
    await this.#persist(event, before, draft, output);
    this.#state = draft;
    return output;
  }

  async onProposal(proposal: ProposalInput): Promise<VoteIntent> {
    if (proposal.round !== this.#state.round) error('ERR_INVALID_VALID_ROUND');
    const prior = this.#firstProposal.get(proposal.round);
    if (prior && prior.proposalHash !== proposal.proposalHash) {
      const output = await this.#commit('conflicting-proposal', (draft) => {
        draft.step = 'PREVOTE';
        return {
          step: 'PREVOTE',
          round: proposal.round,
          valueHash: null,
          prevoteQCRef: null,
          reason: 'coordinator-equivocation',
        };
      });
      return output!;
    }
    if (!prior && proposal.valid && proposal.available) {
      this.#firstProposal.set(proposal.round, {
        proposalHash: proposal.proposalHash,
        valueHash: proposal.valueHash,
      });
    }
    const output = await this.#commit('proposal', (draft) => {
      draft.step = 'PREVOTE';
      if (!proposal.valid || !proposal.available) {
        return {
          step: 'PREVOTE',
          round: proposal.round,
          valueHash: null,
          prevoteQCRef: null,
          reason: !proposal.valid ? 'invalid-proposal' : 'candidate-unavailable',
        };
      }
      const unlocked = draft.lockedValueHash === null;
      const sameLock = draft.lockedValueHash === proposal.valueHash;
      const justifiedUnlock =
        proposal.validRound !== null &&
        proposal.validPrevoteQCRef !== null &&
        proposal.validPrevoteQcVerified &&
        proposal.validRound < proposal.round &&
        (draft.lockedRound === null || proposal.validRound > draft.lockedRound);
      if (unlocked || sameLock || justifiedUnlock) {
        return {
          step: 'PREVOTE',
          round: proposal.round,
          valueHash: proposal.valueHash,
          prevoteQCRef: null,
        };
      }
      return {
        step: 'PREVOTE',
        round: proposal.round,
        valueHash: null,
        prevoteQCRef: null,
        reason: 'lock-conflict',
      };
    });
    return output!;
  }

  async onPrevoteQc(round: number, valueHash: Hex | null, qcRef: Hex): Promise<VoteIntent> {
    if (round !== this.#state.round) error('ERR_INVALID_VALID_ROUND');
    if (qcRef === ZERO32) error('ERR_SIGNING_ROOT_MISMATCH');
    const output = await this.#commit('prevote-qc', (draft) => {
      draft.step = 'PRECOMMIT';
      if (valueHash !== null) {
        draft.validValueHash = valueHash;
        draft.validRound = round;
        draft.validPrevoteQCRef = qcRef;
        draft.lockedValueHash = valueHash;
        draft.lockedRound = round;
      }
      return {
        step: 'PRECOMMIT',
        round,
        valueHash,
        prevoteQCRef: qcRef,
      };
    });
    return output!;
  }

  async onPrevoteTimeout(round: number): Promise<VoteIntent> {
    if (round !== this.#state.round) error('ERR_INVALID_VALID_ROUND');
    const output = await this.#commit('prevote-timeout', (draft) => {
      draft.step = 'PRECOMMIT';
      return {
        step: 'PRECOMMIT',
        round,
        valueHash: null,
        prevoteQCRef: null,
        reason: 'prevote-timeout',
      };
    });
    return output!;
  }

  async onPrecommitQc(round: number, valueHash: Hex | null, acRef: Hex | null = null): Promise<void> {
    if (round !== this.#state.round) error('ERR_INVALID_VALID_ROUND');
    await this.#commit('precommit-qc', (draft) => {
      if (valueHash === null) {
        draft.round += 1;
        draft.step = 'PROPOSE';
      } else {
        draft.committedValueHash = valueHash;
        draft.committedAcRef = acRef;
        draft.step = 'COMMITTED';
      }
      return null;
    });
  }

  async onPrecommitTimeoutCertificate(round: number): Promise<void> {
    if (round !== this.#state.round) error('ERR_INVALID_VALID_ROUND');
    await this.#commit('precommit-timeout-certificate', (draft) => {
      draft.round += 1;
      draft.step = 'PROPOSE';
      return null;
    });
  }

  enterRecovery(code: string): void {
    this.#state.recoveryCode = code;
    this.#state.mode = 'RECOVERY';
  }

  recordRejectCertificate(conflictKey: string): void {
    if (this.#finalConflictKey === conflictKey) error('ERR_REJECT_AFTER_FINALITY');
    this.#rejectConflictKey = conflictKey;
    this.#state.mode = 'FROZEN';
    this.#state.recoveryCode = 'ERR_REJECT_ACCEPT_CONFLICT';
    if (this.#acceptQcConflictKey === conflictKey) {
      error('ERR_REJECT_ACCEPT_CONFLICT');
    }
  }

  recordAcceptQc(conflictKey: string): void {
    this.#acceptQcConflictKey = conflictKey;
    if (this.#rejectConflictKey === conflictKey) {
      this.enterRecovery('ERR_REJECT_ACCEPT_CONFLICT');
      error('ERR_REJECT_ACCEPT_CONFLICT');
    }
  }

  recordFinalCertificate(conflictKey: string): void {
    this.#finalConflictKey = conflictKey;
  }
}

export type TendermintInputV2 =
  | {
      type: 'PROPOSAL';
      value: Hex;
      validRound: number;
      validPrevoteQCRef: Hex;
      available: boolean;
    }
  | { type: 'PREVOTE_QC'; value: Hex; qcRef: Hex }
  | { type: 'PREVOTE_TIMEOUT' }
  | { type: 'PRECOMMIT_QC'; value: Hex; acRef: Hex }
  | { type: 'PRECOMMIT_TIMEOUT'; tcRef: Hex }
  | { type: 'REJECT_CERT'; rejectRef: Hex; afterFinality: boolean };

export interface TendermintOutputV2 {
  action: 'PREVOTE' | 'PRECOMMIT' | 'ENTER_ROUND' | 'COMMIT' | 'FREEZE';
  value: Hex;
  reference: Hex;
}

export function applyTendermintInput(
  previous: TendermintState,
  input: TendermintInputV2,
): { state: TendermintState; outputs: readonly TendermintOutputV2[]; error?: string } {
  const state = cloneState(previous);
  if (state.mode !== 'VOTING') return { state, outputs: [], error: 'ERR_WAL_RECOVERY_REQUIRED' };
  const nil = ZERO32;
  switch (input.type) {
    case 'PROPOSAL': {
      let value = nil;
      if (input.available && input.value !== nil) {
        const unlocked = state.lockedRound === null;
        const sameLock = state.lockedValueHash === input.value;
        const higher =
          input.validRound !== 0xffff_ffff &&
          state.lockedRound !== null &&
          input.validRound > state.lockedRound &&
          input.validPrevoteQCRef !== nil;
        if (unlocked || sameLock || higher) value = input.value;
      }
      state.step = 'PREVOTE';
      return { state, outputs: [{ action: 'PREVOTE', value, reference: nil }] };
    }
    case 'PREVOTE_QC':
      state.step = 'PRECOMMIT';
      if (input.value === nil) {
        return { state, outputs: [{ action: 'PRECOMMIT', value: nil, reference: nil }] };
      }
      if (input.qcRef === nil) return { state, outputs: [], error: 'ERR_INVALID_CERTIFICATE_REFERENCE' };
      state.validValueHash = input.value;
      state.validRound = state.round;
      state.validPrevoteQCRef = input.qcRef;
      state.lockedValueHash = input.value;
      state.lockedRound = state.round;
      return { state, outputs: [{ action: 'PRECOMMIT', value: input.value, reference: input.qcRef }] };
    case 'PREVOTE_TIMEOUT':
      state.step = 'PRECOMMIT';
      return { state, outputs: [{ action: 'PRECOMMIT', value: nil, reference: nil }] };
    case 'PRECOMMIT_QC':
      if (input.value === nil) {
        state.round += 1;
        state.step = 'PROPOSE';
        return { state, outputs: [{ action: 'ENTER_ROUND', value: nil, reference: nil }] };
      }
      if (input.acRef === nil) return { state, outputs: [], error: 'ERR_INVALID_CERTIFICATE_REFERENCE' };
      state.step = 'COMMITTED';
      state.committedValueHash = input.value;
      state.committedAcRef = input.acRef;
      return { state, outputs: [{ action: 'COMMIT', value: input.value, reference: input.acRef }] };
    case 'PRECOMMIT_TIMEOUT':
      state.round += 1;
      state.step = 'PROPOSE';
      return { state, outputs: [{ action: 'ENTER_ROUND', value: nil, reference: input.tcRef }] };
    case 'REJECT_CERT':
      state.rejectRef = input.rejectRef;
      state.mode = 'FROZEN';
      state.recoveryCode = input.afterFinality ? 'ERR_REJECT_AFTER_FINALITY' : 'ERR_REJECT_ACCEPT_CONFLICT';
      return {
        state,
        outputs: [{ action: 'FREEZE', value: nil, reference: input.rejectRef }],
        error: state.recoveryCode,
      };
  }
}

function le(value: bigint | number, width: number): Uint8Array {
  const output = new Uint8Array(width);
  let rest = BigInt(value);
  for (let index = 0; index < width; index += 1) {
    output[index] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return output;
}

export function tendermintStateRoot(state: TendermintState): Hex {
  const step = { PROPOSE: 0, PREVOTE: 1, PRECOMMIT: 2, COMMITTED: 3 }[state.step];
  const mode = { VOTING: 0, RECOVERY: 1, FROZEN: 2 }[state.mode];
  return sha256(
    concat([
      toUtf8Bytes('dle.archive.state.v2'),
      le(state.height, 8),
      le(state.round, 4),
      le(step, 1),
      le(mode, 1),
      getBytes(state.lockedValueHash ?? ZERO32),
      le(state.lockedRound ?? 0xffff_ffff, 4),
      getBytes(state.validValueHash ?? ZERO32),
      le(state.validRound ?? 0xffff_ffff, 4),
      getBytes(state.validPrevoteQCRef ?? ZERO32),
      getBytes(state.committedAcRef ?? ZERO32),
      getBytes(state.rejectRef ?? ZERO32),
    ]),
  ) as Hex;
}

export function assertActiveMembership(
  height: bigint,
  membershipRoot: Hex,
  keyEpoch: bigint,
  view: MembershipView,
): void {
  const activatesNew = height >= view.activationHeight;
  if (activatesNew && !view.l1SwitchFinal) error('ERR_MEMBERSHIP_NOT_ACTIVE');
  const expectedRoot = activatesNew ? view.newMembershipRoot : view.oldMembershipRoot;
  const expectedEpoch = activatesNew ? view.newKeyEpoch : view.oldKeyEpoch;
  if (membershipRoot !== expectedRoot) error('ERR_MEMBERSHIP_NOT_ACTIVE');
  if (keyEpoch !== expectedEpoch) error('ERR_KEY_EPOCH_MISMATCH');
}

export function assertSingleMembershipRoot(roots: readonly Hex[]): void {
  if (new Set(roots).size !== 1) error('ERR_MIXED_MEMBERSHIP_ROOT');
}

export function assertUnambiguousMembershipCheckpoint(claimedRoots: readonly Hex[]): void {
  if (new Set(claimedRoots).size !== 1) error('ERR_AMBIGUOUS_L1_MEMBERSHIP_CHECKPOINT');
}

export function assertProposalVoteMembershipMatch(
  proposalMembershipRoot: Hex,
  voteMembershipRoot: Hex,
): void {
  if (proposalMembershipRoot !== voteMembershipRoot) error('ERR_MEMBERSHIP_ROOT_MISMATCH');
}
