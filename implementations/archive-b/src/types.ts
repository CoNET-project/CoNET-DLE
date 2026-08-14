export type Hex = `0x${string}`;

export const ZERO32 = `0x${'00'.repeat(32)}` as Hex;
export const NONE_ROUND = 0xffff_ffff;

export interface ProposalSignBytesV1 {
  protocolVersion: Hex;
  l1ChainId: bigint;
  archiveGroupId: bigint;
  chainNftId: bigint;
  tipHeight: bigint;
  round: number;
  proposalValueHash: Hex;
  validRoundOrNone: number;
  validPrevoteQCRefOrZero: Hex;
  attemptNonce: bigint;
  membershipEpoch: bigint;
  membershipRoot: Hex;
  keyEpoch: bigint;
}

export interface VoteSignBytesV1 {
  protocolVersion: Hex;
  l1ChainId: bigint;
  archiveGroupId: bigint;
  chainNftId: bigint;
  tipHeight: bigint;
  round: number;
  step: 1 | 2;
  valueHashOrZero: Hex;
  attemptNonce: bigint;
  membershipEpoch: bigint;
  membershipRoot: Hex;
  keyEpoch: bigint;
  prevoteQCRefOrZero: Hex;
}

export type ConsensusStep = 'PROPOSE' | 'PREVOTE' | 'PRECOMMIT' | 'COMMITTED';

export interface TendermintState {
  height: bigint;
  round: number;
  step: ConsensusStep;
  mode: 'VOTING' | 'RECOVERY' | 'FROZEN';
  lockedValueHash: Hex | null;
  lockedRound: number | null;
  validValueHash: Hex | null;
  validRound: number | null;
  validPrevoteQCRef: Hex | null;
  committedValueHash: Hex | null;
  committedAcRef: Hex | null;
  rejectRef: Hex | null;
  recoveryCode: string | null;
}

export interface ProposalInput {
  round: number;
  valueHash: Hex;
  valid: boolean;
  available: boolean;
  validRound: number | null;
  validPrevoteQCRef: Hex | null;
  validPrevoteQcVerified: boolean;
  proposalHash: Hex;
}

export interface VoteIntent {
  step: 'PREVOTE' | 'PRECOMMIT';
  round: number;
  valueHash: Hex | null;
  prevoteQCRef: Hex | null;
  reason?: string;
}

export interface MembershipView {
  activationHeight: bigint;
  oldMembershipRoot: Hex;
  oldKeyEpoch: bigint;
  newMembershipRoot: Hex;
  newKeyEpoch: bigint;
  l1SwitchFinal: boolean;
}

export type ArchiveLifecycleState =
  | 'ACTIVE'
  | 'EXIT_REQUESTED'
  | 'DRAINING'
  | 'STANDBY_SYNCING'
  | 'HANDOVER_READY'
  | 'MEMBERSHIP_SWITCHED'
  | 'UNBONDING'
  | 'EXITED';
