import { concat, getBytes, sha256, toUtf8Bytes } from 'ethers';
import { ZERO32, type ArchiveLifecycleState, type Hex } from './types.js';

export interface ArchiveGroupRoster {
  groupId: bigint;
  active: readonly string[];
  standbys: readonly string[];
  activeOperatorDomains: readonly string[];
  standbyOperatorDomains: readonly string[];
  assignmentFrozen: boolean;
}

export interface LifecycleContext {
  uniqueExitNonce?: boolean;
  assignedRoundsDrained?: boolean;
  latestAcAndDaPreserved?: boolean;
  standbyZeroSynced?: boolean;
  bothStandbysReady?: boolean;
  membershipCertificateValid?: boolean;
  l1MembershipSwitchFinal?: boolean;
  liabilitiesExpired?: boolean;
}

const NEXT: Record<ArchiveLifecycleState, ArchiveLifecycleState | null> = {
  ACTIVE: 'EXIT_REQUESTED',
  EXIT_REQUESTED: 'DRAINING',
  DRAINING: 'STANDBY_SYNCING',
  STANDBY_SYNCING: 'HANDOVER_READY',
  HANDOVER_READY: 'MEMBERSHIP_SWITCHED',
  MEMBERSHIP_SWITCHED: 'UNBONDING',
  UNBONDING: 'EXITED',
  EXITED: null,
};

function requireCondition(condition: boolean | undefined, message: string): void {
  if (!condition) throw new Error(message);
}

export function validateFivePlusTwo(roster: ArchiveGroupRoster): void {
  if (roster.active.length !== 5 || roster.standbys.length !== 2) {
    throw new Error('ERR_INVALID_FIVE_PLUS_TWO_ROSTER');
  }
  const identities = [...roster.active, ...roster.standbys].map((value) => value.toLowerCase());
  if (new Set(identities).size !== 7) throw new Error('ERR_ROSTER_OVERLAP');
  const operators = [
    ...roster.activeOperatorDomains,
    ...roster.standbyOperatorDomains,
  ].map((value) => value.toLowerCase());
  if (operators.length !== 7 || new Set(operators).size !== 7) {
    throw new Error('ERR_OPERATOR_DOMAIN_OVERLAP');
  }
}

export function canAcceptNewChain(roster: ArchiveGroupRoster): boolean {
  try {
    validateFivePlusTwo(roster);
    return !roster.assignmentFrozen;
  } catch {
    return false;
  }
}

export function advanceArchiveLifecycle(
  current: ArchiveLifecycleState,
  context: LifecycleContext,
): ArchiveLifecycleState {
  const next = NEXT[current];
  if (!next) throw new Error('ERR_LIFECYCLE_TERMINAL');
  switch (current) {
    case 'ACTIVE':
      requireCondition(context.uniqueExitNonce, 'ERR_EXIT_NONCE');
      break;
    case 'EXIT_REQUESTED':
      break;
    case 'DRAINING':
      requireCondition(context.assignedRoundsDrained, 'ERR_DRAIN_INCOMPLETE');
      requireCondition(context.latestAcAndDaPreserved, 'ERR_HANDOVER_DATA_INCOMPLETE');
      break;
    case 'STANDBY_SYNCING':
      requireCondition(context.standbyZeroSynced, 'ERR_STANDBY_NOT_SYNCED');
      requireCondition(context.bothStandbysReady, 'ERR_STANDBY_NOT_READY');
      break;
    case 'HANDOVER_READY':
      requireCondition(context.membershipCertificateValid, 'ERR_MEMBERSHIP_CERTIFICATE');
      requireCondition(context.l1MembershipSwitchFinal, 'ERR_MEMBERSHIP_NOT_ACTIVE');
      break;
    case 'MEMBERSHIP_SWITCHED':
      break;
    case 'UNBONDING':
      requireCondition(context.liabilitiesExpired, 'ERR_UNBONDING_LIABILITY');
      break;
    case 'EXITED':
      throw new Error('ERR_LIFECYCLE_TERMINAL');
  }
  return next;
}

export function emergencyPromotion(roster: ArchiveGroupRoster, readyStandbys: number): ArchiveGroupRoster {
  validateFivePlusTwo(roster);
  if (readyStandbys < 1) throw new Error('ERR_NO_READY_STANDBY');
  return {
    ...roster,
    assignmentFrozen: readyStandbys < 2,
  };
}

export interface LifecycleMachineState {
  phase:
    | 'ACTIVE'
    | 'EXIT_REQUESTED'
    | 'DRAINING'
    | 'STANDBY_SYNCING'
    | 'HANDOVER_READY'
    | 'MEMBERSHIP_SWITCHED';
  membershipEpoch: number;
  keyEpoch: number;
  active: readonly Hex[];
  standby: readonly Hex[];
  exiting: Hex;
  promoted: Hex;
}

export type LifecycleMachineInput =
  | { type: 'REQUEST_EXIT'; member: Hex }
  | { type: 'BEGIN_DRAIN' }
  | { type: 'BEGIN_STANDBY_SYNC' }
  | { type: 'MARK_HANDOVER_READY' }
  | { type: 'ACTIVATE_SWITCH' };

export function applyLifecycleInput(
  previous: LifecycleMachineState,
  input: LifecycleMachineInput,
): LifecycleMachineState {
  if (previous.active.length !== 5 || previous.standby.length > 2) {
    throw new Error('ERR_LIFECYCLE_TRANSITION');
  }
  const state: LifecycleMachineState = {
    ...previous,
    active: [...previous.active],
    standby: [...previous.standby],
  };
  switch (input.type) {
    case 'REQUEST_EXIT':
      if (state.phase !== 'ACTIVE' || !state.active.includes(input.member)) {
        throw new Error('ERR_LIFECYCLE_TRANSITION');
      }
      return { ...state, phase: 'EXIT_REQUESTED', exiting: input.member };
    case 'BEGIN_DRAIN':
      if (state.phase !== 'EXIT_REQUESTED') throw new Error('ERR_LIFECYCLE_TRANSITION');
      return { ...state, phase: 'DRAINING' };
    case 'BEGIN_STANDBY_SYNC':
      if (state.phase !== 'DRAINING' || !state.standby[0]) throw new Error('ERR_LIFECYCLE_TRANSITION');
      return { ...state, phase: 'STANDBY_SYNCING', promoted: state.standby[0] };
    case 'MARK_HANDOVER_READY':
      if (state.phase !== 'STANDBY_SYNCING') throw new Error('ERR_LIFECYCLE_TRANSITION');
      return { ...state, phase: 'HANDOVER_READY' };
    case 'ACTIVATE_SWITCH': {
      if (state.phase !== 'HANDOVER_READY') throw new Error('ERR_LIFECYCLE_TRANSITION');
      const replacement = state.active.indexOf(state.exiting);
      if (replacement < 0 || state.promoted === ZERO32) throw new Error('ERR_LIFECYCLE_TRANSITION');
      const active = [...state.active];
      active[replacement] = state.promoted;
      if (new Set(active).size !== 5) throw new Error('ERR_LIFECYCLE_TRANSITION');
      return {
        ...state,
        phase: 'MEMBERSHIP_SWITCHED',
        membershipEpoch: state.membershipEpoch + 1,
        keyEpoch: state.keyEpoch + 1,
        active,
        standby: state.standby.slice(1),
      };
    }
  }
}

function le(value: number, width: number): Uint8Array {
  const bytes = new Uint8Array(width);
  let remaining = BigInt(value);
  for (let index = 0; index < width; index += 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

export function lifecycleStateRoot(state: LifecycleMachineState): Hex {
  const phase = [
    'ACTIVE',
    'EXIT_REQUESTED',
    'DRAINING',
    'STANDBY_SYNCING',
    'HANDOVER_READY',
    'MEMBERSHIP_SWITCHED',
  ].indexOf(state.phase);
  if (phase < 0 || state.active.length !== 5 || state.standby.length > 2) {
    throw new Error('ERR_LIFECYCLE_TRANSITION');
  }
  return sha256(
    concat([
      toUtf8Bytes('dle.archive.lifecycle.v1'),
      le(phase, 1),
      le(state.membershipEpoch, 8),
      le(state.keyEpoch, 8),
      ...state.active.map((value) => getBytes(value)),
      le(state.standby.length, 1),
      ...state.standby.map((value) => getBytes(value)),
      ...Array.from({ length: 2 - state.standby.length }, () => getBytes(ZERO32)),
      getBytes(state.exiting),
      getBytes(state.promoted),
    ]),
  ) as Hex;
}
