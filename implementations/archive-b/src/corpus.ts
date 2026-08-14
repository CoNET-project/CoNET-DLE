import { createHash } from 'node:crypto';
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ArchiveTendermint,
  applyTendermintInput,
  assertActiveMembership,
  assertProposalVoteMembershipMatch,
  assertSingleMembershipRoot,
  assertUnambiguousMembershipCheckpoint,
  initialTendermintState,
  tendermintStateRoot,
} from './consensus.js';
import {
  FramedSafetyWal,
  decodeWalFrames,
  decodeWalSafetyRecord,
  encodeWalFrame,
  type DurableVoteRecord,
} from './wal.js';
import {
  encodeProposal,
  encodeVote,
  proposalRoot,
  signingRoot,
  voteRoot,
} from './ssz.js';
import { NONE_ROUND, ZERO32, type Hex, type ProposalSignBytesV1, type VoteSignBytesV1 } from './types.js';
import {
  certificateReference,
  certificateRoot,
  certificateSigningRoot,
  encodeCertificate,
  selectCoordinator,
  selectCoordinatorDetails,
  type CertificateName,
} from './certificates.js';
import { bodyCommitment, chunksToHex, computeDaRoot, encodeRs74, reconstructRs74 } from './da.js';
import {
  applyLifecycleInput,
  lifecycleStateRoot,
  type LifecycleMachineInput,
  type LifecycleMachineState,
} from './lifecycle.js';
import { getBytes } from 'ethers';

interface SszVector {
  id: string;
  type: 'ProposalSignBytesV1' | 'VoteSignBytesV1';
  signatureDomainTag: string;
  input: Record<string, unknown>;
  canonicalSsz: Hex;
  hashTreeRoot: Hex;
  signingRoot: Hex;
}

interface Corpus {
  schema: string;
  fixture: Record<string, unknown>;
  sszVectors: SszVector[];
  stateMachineVectors: Array<{ id: string }>;
}

export interface CorpusReport {
  ok: boolean;
  corpusPath: string;
  corpusSha256: string;
  schema: string;
  sszPassed: number;
  stateMachinePassed: number;
  failures: Array<{ id: string; error: string }>;
  compatibilityGaps: string[];
}

function defaultCorpusPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '../../../conformance/corpus/DLE-Archive-Tendermint-Vectors-v2.json');
}

function hex(value: unknown): Hex {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]*$/.test(value)) throw new Error('invalid hex');
  return value.toLowerCase() as Hex;
}

function uint(value: unknown): bigint {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
    throw new Error('invalid uint');
  }
  return BigInt(value);
}

function common(fixture: Record<string, unknown>) {
  return {
    protocolVersion: hex(fixture.protocolVersion),
    l1ChainId: uint(fixture.l1ChainId),
    archiveGroupId: uint(fixture.archiveGroupId),
    chainNftId: uint(fixture.chainNftId),
    tipHeight: uint(fixture.tipHeight),
    round: Number(fixture.round),
    attemptNonce: uint(fixture.attemptNonce),
    membershipEpoch: uint(fixture.membershipEpoch),
    membershipRoot: hex(fixture.membershipRoot),
    keyEpoch: uint(fixture.keyEpoch),
  };
}

function proposalFrom(vector: SszVector, fixture: Record<string, unknown>): ProposalSignBytesV1 {
  const base = common(fixture);
  return {
    ...base,
    proposalValueHash: hex(fixture.valueHash),
    validRoundOrNone: Number(vector.input.validRoundOrNone),
    validPrevoteQCRefOrZero: hex(vector.input.validPrevoteQCRefOrZero),
  };
}

function voteFrom(vector: SszVector, fixture: Record<string, unknown>): VoteSignBytesV1 {
  const base = common(fixture);
  const step = Number(vector.input.step);
  if (step !== 1 && step !== 2) throw new Error('invalid vote step');
  return {
    ...base,
    step,
    valueHashOrZero: hex(vector.input.valueHashOrZero),
    prevoteQCRefOrZero: hex(vector.input.prevoteQCRefOrZero),
  };
}

function expect(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function errorCode(action: () => unknown): string | null {
  try {
    action();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const A = `0x${'aa'.repeat(32)}` as Hex;
const B = `0x${'bb'.repeat(32)}` as Hex;
const QC = `0x${'cc'.repeat(32)}` as Hex;
const M0 = `0x${'11'.repeat(32)}` as Hex;
const M1 = `0x${'22'.repeat(32)}` as Hex;

function proposal(valueHash: Hex, round: number, overrides: Partial<Parameters<ArchiveTendermint['onProposal']>[0]> = {}) {
  return {
    round,
    valueHash,
    valid: true,
    available: true,
    validRound: null,
    validPrevoteQCRef: null,
    validPrevoteQcVerified: false,
    proposalHash: valueHash,
    ...overrides,
  };
}

function voteRecord(value = A): DurableVoteRecord {
  const signBytesHash = `0x${createHash('sha256').update(getBytes(value)).digest('hex')}` as Hex;
  return {
    type: 'vote',
    version: 1,
    kind: 1,
    domain: 1,
    height: '9',
    round: 4,
    step: 1,
    canonicalSignBytes: value,
    signBytesHash,
    signingRoot: value,
    signature: `0x${'99'.repeat(65)}`,
    proposalHash: value,
    lockedValue: ZERO32,
    lockedRound: NONE_ROUND,
    validValue: ZERO32,
    validRound: NONE_ROUND,
    prevoteQCRef: ZERO32,
    timeoutCertificateRef: ZERO32,
    membershipEpoch: '11',
    membershipRoot: M0,
    keyEpoch: '5',
    committedHeight: '8',
  };
}

async function walCase(id: string): Promise<void> {
  const directory = await mkdtemp(resolve(tmpdir(), 'dle-archive-b-'));
  const path = resolve(directory, 'safety.wal');
  try {
    if (id === 'TM-WAL-CRASH-BEFORE-FSYNC') {
      const opened = await FramedSafetyWal.open(path);
      expect(opened.records.length === 0 && !opened.recoveryRequired, 'pre-fsync vote became durable');
      await opened.wal.close();
      return;
    }
    const opened = await FramedSafetyWal.open(path);
    await opened.wal.append(voteRecord());
    if (id === 'TM-WAL-CRASH-BEFORE-SEND') {
      await expectReject(opened.wal.append(voteRecord(B)), 'ERR_WAL_DOUBLE_SIGN');
    }
    if (id === 'TM-WAL-CRASH-AFTER-QC-BEFORE-PRECOMMIT-SEND') {
      await opened.wal.append({
        type: 'state',
        domain: 'dle.archive.vote.v1',
        height: '9',
        state: {
          lockedValueHash: A,
          lockedRound: 4,
          validValueHash: A,
          validRound: 4,
          validPrevoteQCRef: QC,
        },
      });
    }
    if (id === 'TM-WAL-AC-DURABLE-BEFORE-HEIGHT-ADVANCE') {
      await opened.wal.append({
        type: 'archive-certificate',
        domain: 'dle.archive.ac.v1',
        height: '9',
        state: { ac: A, nextHeight: '10' },
      });
    }
    await opened.wal.close();
    if (id === 'TM-WAL-PARTIAL-OR-CORRUPT-RECORD') {
      await appendFile(path, Buffer.from([0x44, 0x4c, 0x42]));
    }
    const replay = await FramedSafetyWal.open(path);
    if (id === 'TM-WAL-PARTIAL-OR-CORRUPT-RECORD') {
      expect(replay.recoveryRequired, 'corrupt tail did not enter recovery');
    } else if (id === 'TM-WAL-CRASH-AFTER-QC-BEFORE-PRECOMMIT-SEND') {
      expect(
        replay.records.some(
          (record) =>
            record.type === 'state' &&
            record.state.lockedValueHash === A &&
            record.state.validPrevoteQCRef === QC,
        ),
        'lock/QC state not replayed',
      );
    } else if (id === 'TM-WAL-AC-DURABLE-BEFORE-HEIGHT-ADVANCE') {
      expect(
        replay.records.some(
          (record) =>
            record.type === 'archive-certificate' &&
            record.state.ac === A &&
            record.state.nextHeight === '10',
        ),
        'archive certificate transition not replayed',
      );
    } else {
      expect(!replay.recoveryRequired && replay.records.length >= 1, 'durable record not replayed');
    }
    await replay.wal.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function expectReject(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error instanceof Error && error.message === code, `expected ${code}`);
  }
}

async function semanticCase(id: string): Promise<void> {
  if (id.startsWith('TM-WAL-')) return walCase(id);
  if (id === 'TM-NORMAL-COMMIT') {
    const machine = new ArchiveTendermint(initialTendermintState(9n));
    expect((await machine.onProposal(proposal(A, 0))).valueHash === A, 'normal prevote');
    expect((await machine.onPrevoteQc(0, A, QC)).valueHash === A, 'normal precommit');
    await machine.onPrecommitQc(0, A);
    expect(machine.state.committedValueHash === A, 'normal commit');
    return;
  }
  if (id === 'TM-NIL-VOTES') {
    const state = initialTendermintState(9n, 2);
    state.lockedValueHash = A;
    state.lockedRound = 1;
    state.validValueHash = A;
    state.validRound = 1;
    const machine = new ArchiveTendermint(state);
    expect((await machine.onProposal(proposal(B, 2, { valid: false }))).valueHash === null, 'nil prevote');
    expect((await machine.onPrevoteQc(2, null, QC)).valueHash === null, 'nil precommit');
    await machine.onPrecommitQc(2, null);
    expect(machine.state.round === 3 && machine.state.lockedValueHash === A, 'nil round lock preservation');
    return;
  }
  if (id === 'TM-LOCK-CONFLICT' || id === 'TM-SAME-VALUE-LOCK' || id === 'TM-HIGHER-VALID-ROUND') {
    const round = id === 'TM-HIGHER-VALID-ROUND' ? 3 : 2;
    const state = initialTendermintState(9n, round);
    state.lockedValueHash = A;
    state.lockedRound = 1;
    const machine = new ArchiveTendermint(state);
    const same = id === 'TM-SAME-VALUE-LOCK';
    const higher = id === 'TM-HIGHER-VALID-ROUND';
    const intent = await machine.onProposal(
      proposal(same ? A : B, round, higher
        ? { validRound: 2, validPrevoteQCRef: QC, validPrevoteQcVerified: true }
        : {}),
    );
    expect(intent.valueHash === (id === 'TM-LOCK-CONFLICT' ? null : same ? A : B), id);
    expect(machine.state.lockedValueHash === A && machine.state.lockedRound === 1, 'proposal changed lock');
    return;
  }
  if (id === 'TM-PROPOSAL-DOES-NOT-LOCK') {
    const machine = new ArchiveTendermint(initialTendermintState(9n, 3));
    const intent = await machine.onProposal(
      proposal(B, 3, { validRound: 2, validPrevoteQCRef: QC, validPrevoteQcVerified: true }),
    );
    expect(intent.valueHash === B && machine.state.lockedValueHash === null, id);
    return;
  }
  if (id === 'TM-CURRENT-ROUND-QC-SETS-VALID-AND-LOCK') {
    const machine = new ArchiveTendermint(initialTendermintState(9n, 3));
    await machine.onPrevoteQc(3, B, QC);
    expect(machine.state.lockedValueHash === B && machine.state.validValueHash === B, id);
    return;
  }
  if (id === 'TM-TIMEOUT-PRESERVES-LOCK-AND-VALID') {
    const state = initialTendermintState(9n, 2);
    state.lockedValueHash = A;
    state.lockedRound = 1;
    state.validValueHash = A;
    state.validRound = 1;
    const machine = new ArchiveTendermint(state);
    await machine.onPrecommitTimeoutCertificate(2);
    expect(machine.state.round === 3 && machine.state.lockedValueHash === A, id);
    return;
  }
  if (id === 'TM-MEMBERSHIP-H' || id === 'TM-MEMBERSHIP-H-PLUS-1' || id === 'TM-OLD-ROOT-NEW-KEY-EPOCH') {
    const view = {
      activationHeight: 10n,
      oldMembershipRoot: M0,
      oldKeyEpoch: 5n,
      newMembershipRoot: M1,
      newKeyEpoch: 6n,
      l1SwitchFinal: true,
    };
    if (id === 'TM-MEMBERSHIP-H') {
      assertActiveMembership(9n, M0, 5n, view);
      expect(errorCode(() => assertActiveMembership(9n, M1, 6n, view)) === 'ERR_MEMBERSHIP_NOT_ACTIVE', id);
      expect(
        errorCode(() => assertSingleMembershipRoot([M0, M1])) ===
          'ERR_MIXED_MEMBERSHIP_ROOT',
        id,
      );
    } else if (id === 'TM-MEMBERSHIP-H-PLUS-1') {
      assertActiveMembership(10n, M1, 6n, view);
      expect(errorCode(() => assertActiveMembership(10n, M0, 5n, view)) === 'ERR_MEMBERSHIP_NOT_ACTIVE', id);
      expect(
        errorCode(() => assertProposalVoteMembershipMatch(M1, M0)) ===
          'ERR_MEMBERSHIP_ROOT_MISMATCH',
        id,
      );
    } else {
      expect(errorCode(() => assertActiveMembership(10n, M1, 5n, view)) === 'ERR_KEY_EPOCH_MISMATCH', id);
    }
    return;
  }
  if (id === 'TM-DUAL-ROOT-SAME-HEIGHT') {
    expect(
      errorCode(() => assertUnambiguousMembershipCheckpoint([M0, M1])) ===
        'ERR_AMBIGUOUS_L1_MEMBERSHIP_CHECKPOINT',
      id,
    );
    return;
  }
  if (id.startsWith('TM-REJECT-')) {
    const machine = new ArchiveTendermint(initialTendermintState(9n));
    if (id === 'TM-REJECT-AFTER-AC') {
      machine.recordFinalCertificate('candidate');
      expect(errorCode(() => machine.recordRejectCertificate('candidate')) === 'ERR_REJECT_AFTER_FINALITY', id);
    } else {
      machine.recordRejectCertificate('candidate');
      expect(machine.state.recoveryCode === 'ERR_REJECT_ACCEPT_CONFLICT', id);
      expect(errorCode(() => machine.recordAcceptQc('candidate')) === 'ERR_REJECT_ACCEPT_CONFLICT', id);
    }
    return;
  }
  throw new Error('unsupported semantic vector');
}

const V1_FIXTURE: Record<string, unknown> = {
  protocolVersion: '0x06c8ad5ba4b5da846bda64f2f14ed297a12fd7d4bc9b2f7e0c28ca572dd8483f',
  l1ChainId: '224422',
  archiveGroupId: '7',
  chainNftId: '42',
  tipHeight: '9',
  round: 2,
  valueHash: '0xc22aa4e9f8a69f660a9ede9d91a069ae2fddc679a3ccd48f67654db6643f9493',
  attemptNonce: '3',
  membershipEpoch: '11',
  membershipRoot: `0x${'11'.repeat(32)}`,
  keyEpoch: '5',
};

function checkLegacySsz(vector: SszVector, fixture: Record<string, unknown>): void {
  const object =
    vector.type === 'ProposalSignBytesV1'
      ? proposalFrom(vector, fixture)
      : voteFrom(vector, fixture);
  const canonical =
    vector.type === 'ProposalSignBytesV1'
      ? encodeProposal(object as ProposalSignBytesV1)
      : encodeVote(object as VoteSignBytesV1);
  const root =
    vector.type === 'ProposalSignBytesV1'
      ? proposalRoot(object as ProposalSignBytesV1)
      : voteRoot(object as VoteSignBytesV1);
  expect(canonical === vector.canonicalSsz.toLowerCase(), 'canonical SSZ mismatch');
  expect(root === vector.hashTreeRoot.toLowerCase(), 'hash_tree_root mismatch');
  expect(
    signingRoot(vector.signatureDomainTag, root) === vector.signingRoot.toLowerCase(),
    'signing root mismatch',
  );
}

function toMachineState(value: Record<string, unknown>): import('./types.js').TendermintState {
  const locked = hex(value.lockedValue);
  const valid = hex(value.validValue);
  const validRef = hex(value.validPrevoteQCRef);
  const committed = hex(value.committedAcRef);
  const reject = hex(value.rejectRef);
  return {
    height: uint(value.height),
    round: Number(value.round),
    step: value.step as 'PROPOSE' | 'PREVOTE' | 'PRECOMMIT' | 'COMMITTED',
    mode: value.mode as 'VOTING' | 'RECOVERY' | 'FROZEN',
    lockedValueHash: locked === ZERO32 ? null : locked,
    lockedRound: Number(value.lockedRound) === NONE_ROUND ? null : Number(value.lockedRound),
    validValueHash: valid === ZERO32 ? null : valid,
    validRound: Number(value.validRound) === NONE_ROUND ? null : Number(value.validRound),
    validPrevoteQCRef: validRef === ZERO32 ? null : validRef,
    committedValueHash: null,
    committedAcRef: committed === ZERO32 ? null : committed,
    rejectRef: reject === ZERO32 ? null : reject,
    recoveryCode: null,
  };
}

function machineWireState(state: ReturnType<typeof toMachineState>): Record<string, unknown> {
  return {
    height: Number(state.height),
    round: state.round,
    step: state.step,
    mode: state.mode,
    lockedValue: state.lockedValueHash ?? ZERO32,
    lockedRound: state.lockedRound ?? NONE_ROUND,
    validValue: state.validValueHash ?? ZERO32,
    validRound: state.validRound ?? NONE_ROUND,
    validPrevoteQCRef: state.validPrevoteQCRef ?? ZERO32,
    committedAcRef: state.committedAcRef ?? ZERO32,
    rejectRef: state.rejectRef ?? ZERO32,
  };
}

async function runV2Corpus(corpus: Record<string, any>, failures: Array<{ id: string; error: string }>) {
  let sszPassed = 0;
  let stateMachinePassed = 0;
  const run = async (id: string, action: () => void | Promise<void>, category: 'ssz' | 'state') => {
    try {
      await action();
      if (category === 'ssz') sszPassed += 1;
      else stateMachinePassed += 1;
    } catch (error) {
      failures.push({ id, error: error instanceof Error ? error.message : String(error) });
    }
  };

  for (const vector of corpus.compatibility?.legacyProposalVoteVectors ?? []) {
    await run(vector.id, () => checkLegacySsz(vector as SszVector, V1_FIXTURE), 'ssz');
  }
  for (const vector of corpus.certificateVectors ?? []) {
    await run(vector.id, () => {
      const name = vector.container as CertificateName;
      expect(encodeCertificate(name, vector.input) === vector.canonicalSsz.toLowerCase(), 'certificate SSZ');
      expect(certificateRoot(name, vector.input) === vector.hashTreeRoot.toLowerCase(), 'certificate root');
      expect(
        certificateSigningRoot(name, vector.input) === vector.signingRoot.toLowerCase(),
        'certificate signing root',
      );
      expect(
        certificateReference(name, vector.input) === vector.certificateRef.toLowerCase(),
        'certificate reference',
      );
    }, 'ssz');
  }
  for (const vector of corpus.coordinatorVectors ?? []) {
    await run(vector.id, () => {
      const input = vector.input;
      const actual = selectCoordinatorDetails(
        uint(input.archiveGroupId),
        uint(input.chainNftId),
        uint(input.tipHeight),
        uint(input.attemptNonce),
        hex(input.membershipRoot),
        Number(input.round),
        input.roster.map(hex),
      );
      expect(JSON.stringify(actual.canonicalRoster) === JSON.stringify(vector.expected.canonicalRoster), 'roster');
      expect(actual.digest === vector.expected.digest, 'coordinator digest');
      expect(actual.sample.toString() === vector.expected.sample, 'coordinator sample');
      expect(actual.index === vector.expected.index, 'coordinator index');
      expect(actual.coordinator === vector.expected.coordinator, 'coordinator');
      expect(actual.counter === vector.expected.counter, 'coordinator counter');
    }, 'state');
  }
  for (const vector of corpus.walVectors ?? []) {
    await run(vector.id, () => {
      const bytes = getBytes(vector.frame);
      if (vector.input) {
        const encoded = encodeWalFrame(
          uint(vector.input.sequence),
          Number(vector.input.flags),
          getBytes(vector.input.payload),
        );
        expect(Buffer.from(encoded).equals(Buffer.from(bytes)), 'WAL frame bytes');
        const frames = decodeWalFrames(encoded);
        expect(frames.length === 1, 'WAL frame count');
        decodeWalSafetyRecord(frames[0]!.payload);
      } else {
        let rejected = false;
        try {
          decodeWalFrames(bytes);
        } catch {
          rejected = true;
        }
        expect(rejected, 'corrupt WAL accepted');
      }
    }, 'state');
  }
  for (const vector of corpus.rsVectors ?? []) {
    await run(vector.id, () => {
      const body = getBytes(vector.body);
      const shards = encodeRs74(body);
      expect(JSON.stringify(chunksToHex(shards)) === JSON.stringify(vector.shards), 'RS shards');
      expect(bodyCommitment(body) === vector.bodyCommitment, 'body commitment');
      expect(computeDaRoot(shards, body.length) === vector.daRoot, 'DA root');
      for (const selection of corpus.rsReconstructionSets ?? []) {
        const rebuilt = reconstructRs74(
          selection.map((index: number) => ({ index, chunk: shards[index]! })),
          body.length,
        );
        expect(Buffer.from(rebuilt).equals(Buffer.from(body)), `RS reconstruction ${selection.join(',')}`);
      }
    }, 'state');
  }
  for (const vector of corpus.stateMachineVectors ?? []) {
    await run(vector.id, () => {
      let state = toMachineState(vector.initial);
      const outputs: unknown[] = [];
      const errors: string[] = [];
      for (const input of vector.inputs) {
        const transition = applyTendermintInput(state, input);
        state = transition.state;
        outputs.push(...transition.outputs);
        if (transition.error) errors.push(transition.error);
      }
      expect(JSON.stringify(machineWireState(state)) === JSON.stringify(vector.expected.state), 'FSM state');
      expect(JSON.stringify(outputs) === JSON.stringify(vector.expected.outputs), 'FSM outputs');
      expect(JSON.stringify(errors) === JSON.stringify(vector.expected.errors), 'FSM errors');
      expect(tendermintStateRoot(state) === vector.expected.stateRoot, 'FSM state root');
    }, 'state');
  }
  for (const vector of corpus.lifecycleVectors ?? []) {
    await run(vector.id, () => {
      let state = vector.initial as LifecycleMachineState;
      for (const input of vector.inputs) {
        state = applyLifecycleInput(state, input as LifecycleMachineInput);
      }
      expect(JSON.stringify(state) === JSON.stringify(vector.expected.state), 'lifecycle state');
      expect(lifecycleStateRoot(state) === vector.expected.stateRoot, 'lifecycle root');
    }, 'state');
  }
  return { sszPassed, stateMachinePassed };
}

export async function runCorpus(path = process.env.CORPUS_PATH ?? defaultCorpusPath()): Promise<CorpusReport> {
  const raw = await readFile(path);
  const parsed = JSON.parse(raw.toString('utf8')) as Record<string, any>;
  const corpus = parsed as unknown as Corpus;
  const failures: Array<{ id: string; error: string }> = [];
  let sszPassed = 0;
  let stateMachinePassed = 0;
  if (Array.isArray(parsed.certificateVectors)) {
    const counts = await runV2Corpus(parsed, failures);
    return {
      ok: failures.length === 0,
      corpusPath: resolve(path),
      corpusSha256: createHash('sha256').update(raw).digest('hex'),
      schema: String(parsed.schema),
      sszPassed: counts.sszPassed,
      stateMachinePassed: counts.stateMachinePassed,
      failures,
      compatibilityGaps: [],
    };
  }
  for (const vector of corpus.sszVectors ?? []) {
    try {
      checkLegacySsz(vector, corpus.fixture);
      sszPassed += 1;
    } catch (error) {
      failures.push({ id: vector.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  for (const vector of corpus.stateMachineVectors ?? []) {
    try {
      await semanticCase(vector.id);
      stateMachinePassed += 1;
    } catch (error) {
      failures.push({ id: vector.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return {
    ok: failures.length === 0,
    corpusPath: resolve(path),
    corpusSha256: createHash('sha256').update(raw).digest('hex'),
    schema: corpus.schema,
    sszPassed,
    stateMachinePassed,
    failures,
    compatibilityGaps: [
      'v1 corpus has no machine-readable QC/TC/AC/Reject SSZ containers or certificate-reference vectors',
      'v1 corpus has no machine-readable WAL frame vectors; Archive-B uses the canonical DLEW v2 frame',
      'v1 corpus has no DA or 5+2 lifecycle vectors; these are tested from the current whitepaper freeze',
      'signature mapping remains SSZ signingRoot only because the final SSZ-to-EIP-712 story is not frozen',
    ],
  };
}
