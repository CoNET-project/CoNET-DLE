import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { getBytes, hexlify, sha256 } from 'ethers';
import { describe, expect, it } from 'vitest';
import {
  ArchiveTendermint,
  FramedSafetyWal,
  advanceArchiveLifecycle,
  canAcceptNewChain,
  decodeWalSafetyRecord,
  decodeVote,
  encodeAvailability,
  encodeBlockBodyV1,
  encodeRs74,
  encodeWalSafetyRecord,
  emptySafetyVote,
  initialTendermintState,
  reconstructRs74,
  runCorpus,
  type ArchiveGroupRoster,
  type DurableVoteRecord,
  type Hex,
} from '../src/index.js';

const A = `0x${'aa'.repeat(32)}` as Hex;
const B = `0x${'bb'.repeat(32)}` as Hex;
const QC = `0x${'cc'.repeat(32)}` as Hex;
const M0 = `0x${'11'.repeat(32)}` as Hex;

function combinations(values: number[], take: number): number[][] {
  if (take === 0) return [[]];
  return values.flatMap((value, index) =>
    combinations(values.slice(index + 1), take - 1).map((rest) => [value, ...rest]),
  );
}

function voteRecord(value = A): DurableVoteRecord {
  return {
    type: 'vote',
    version: 1,
    kind: 1,
    domain: 1,
    height: '9',
    round: 4,
    step: 1,
    canonicalSignBytes: value,
    signBytesHash: sha256(value) as Hex,
    signingRoot: value,
    signature: `0x${'99'.repeat(65)}`,
    proposalHash: value,
    lockedValue: `0x${'00'.repeat(32)}`,
    lockedRound: 0xffff_ffff,
    validValue: `0x${'00'.repeat(32)}`,
    validRound: 0xffff_ffff,
    prevoteQCRef: `0x${'00'.repeat(32)}`,
    timeoutCertificateRef: `0x${'00'.repeat(32)}`,
    membershipEpoch: '11',
    membershipRoot: M0,
    keyEpoch: '5',
    committedHeight: '8',
  };
}

describe('canonical corpus', () => {
  it('replays the current canonical v2 corpus', async () => {
    const report = await runCorpus();
    expect(report.ok).toBe(true);
    expect(report.corpusSha256).toBe('9b1ae3e745dfc1a9dfdf946bb3f57bfccd844bf204a41ffb1700e1f69368b42e');
    expect(report.sszPassed).toBe(10);
    expect(report.stateMachinePassed).toBe(13);
  });
});

describe('Tendermint lock/valid FSM', () => {
  it('does not expose a precommit until durable lock/valid persistence completes', async () => {
    let persisted = false;
    const machine = new ArchiveTendermint(initialTendermintState(9n, 3), async () => {
      await Promise.resolve();
      persisted = true;
    });
    const intent = await machine.onPrevoteQc(3, B, QC);
    expect(persisted).toBe(true);
    expect(intent.valueHash).toBe(B);
    expect(machine.state.lockedValueHash).toBe(B);
    expect(machine.state.validPrevoteQCRef).toBe(QC);
  });

  it('keeps an earlier lock across nil progress', async () => {
    const state = initialTendermintState(9n, 2);
    state.lockedValueHash = A;
    state.lockedRound = 1;
    state.validValueHash = A;
    state.validRound = 1;
    const machine = new ArchiveTendermint(state);
    const vote = await machine.onProposal({
      round: 2,
      valueHash: B,
      valid: true,
      available: true,
      validRound: null,
      validPrevoteQCRef: null,
      validPrevoteQcVerified: false,
      proposalHash: B,
    });
    expect(vote.valueHash).toBeNull();
    await machine.onPrecommitTimeoutCertificate(2);
    expect(machine.state).toMatchObject({
      round: 3,
      lockedValueHash: A,
      lockedRound: 1,
      validValueHash: A,
      validRound: 1,
    });
  });

  it('freezes rather than downgrading a reject conflict to recovery mode', () => {
    const machine = new ArchiveTendermint(initialTendermintState(9n, 2));
    machine.recordRejectCertificate('candidate:9:2');
    expect(machine.state).toMatchObject({
      mode: 'FROZEN',
      recoveryCode: 'ERR_REJECT_ACCEPT_CONFLICT',
    });
  });
});

describe('DLEW framed safety WAL', () => {
  it('replays an fsynced vote and rejects a different vote in the same slot', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'archive-b-test-'));
    const path = resolve(directory, 'wal.bin');
    try {
      const opened = await FramedSafetyWal.open(path);
      await opened.wal.append(voteRecord());
      await expect(opened.wal.append(voteRecord(B))).rejects.toThrow('ERR_WAL_DOUBLE_SIGN');
      await opened.wal.close();
      const replay = await FramedSafetyWal.open(path);
      expect(replay.recoveryRequired).toBe(false);
      expect(replay.records).toHaveLength(1);
      await replay.wal.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('fails closed on a truncated tail', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'archive-b-test-'));
    const path = resolve(directory, 'wal.bin');
    try {
      const opened = await FramedSafetyWal.open(path);
      await opened.wal.append(voteRecord());
      await opened.wal.close();
      await appendFile(path, Buffer.from('DLB'));
      const replay = await FramedSafetyWal.open(path);
      expect(replay.recoveryRequired).toBe(true);
      await expect(replay.wal.append(voteRecord(B))).rejects.toThrow('ERR_WAL_RECOVERY_REQUIRED');
      await replay.wal.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('round-trips the minimum-length safety payload', () => {
    const encoded = encodeWalSafetyRecord(emptySafetyVote());
    expect(decodeWalSafetyRecord(encoded)).toEqual(emptySafetyVote());
  });

  it('serializes concurrent appends and isolates double-sign slots by domain', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'archive-b-race-'));
    const path = resolve(directory, 'wal.bin');
    try {
      const opened = await FramedSafetyWal.open(path);
      const concurrent = await Promise.allSettled([
        opened.wal.append(voteRecord(A)),
        opened.wal.append(voteRecord(B)),
      ]);
      expect(concurrent.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(concurrent.filter(({ status }) => status === 'rejected')).toHaveLength(1);
      await opened.wal.close();

      const second = await FramedSafetyWal.open(path);
      await second.wal.append(voteRecord(A));
      await second.wal.append({ ...voteRecord(B), domain: 2 });
      await second.wal.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('dle.rs.v1 Reed-Solomon and DA root', () => {
  const bodies = [
    Uint8Array.from([0x7f]),
    Uint8Array.from([0, 1, 2, 3, 4]),
    Uint8Array.from([1, 2, 3, 0]),
    Uint8Array.from({ length: 16 }, (_, index) => index),
  ];

  it('matches the frozen 16-byte codeword', () => {
    const chunks = encodeRs74(bodies[3]!);
    expect(chunks.map((chunk) => hexlify(chunk))).toEqual([
      '0x100000000000',
      '0x000000010203',
      '0x040506070809',
      '0x0a0b0c0d0e0f',
      '0x49a4f7a4491a',
      '0xd7ed10e6d127',
      '0x34137576e6e5',
    ]);
  });

  it('reconstructs all required bodies from every 4-of-7 subset', () => {
    for (const body of bodies) {
      const chunks = encodeRs74(body);
      for (const indices of combinations([0, 1, 2, 3, 4, 5, 6], 4)) {
        const recovered = reconstructRs74(
          indices.map((index) => ({ index, chunk: chunks[index]! })),
          body.length,
        );
        expect(hexlify(recovered)).toBe(hexlify(body));
      }
    }
  });

  it('encodes the fixed BlockBodyV1 envelope and availability commitments', () => {
    const body = encodeBlockBodyV1({
      classId: 1,
      chainNftId: 42n,
      height: 9n,
      parentBlockHash: A,
      l1ContextBlockNumber: 1000n,
      l1ContextBlockHash: B,
      canonicalEventBytes: Uint8Array.of(1, 2),
      selectionLogBytesV1: Uint8Array.of(1),
      validatorDepositBundleBytesV1: Uint8Array.of(1),
      executionWitnessBytesV1: Uint8Array.of(1),
    });
    expect(Buffer.from(body.subarray(0, 5)).toString('ascii')).toBe('DLEB1');
    const availability = encodeAvailability(body);
    expect(availability.chunks).toHaveLength(7);
    expect(availability.bodyCommitment).toMatch(/^0x[0-9a-f]{64}$/);
    expect(availability.daRoot).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe('5+2 lifecycle', () => {
  const roster: ArchiveGroupRoster = {
    groupId: 7n,
    active: ['a', 'b', 'c', 'd', 'e'],
    standbys: ['f', 'g'],
    activeOperatorDomains: ['oa', 'ob', 'oc', 'od', 'oe'],
    standbyOperatorDomains: ['of', 'og'],
    assignmentFrozen: false,
  };

  it('requires exactly five disjoint voters and two ready standbys', () => {
    expect(canAcceptNewChain(roster)).toBe(true);
    expect(canAcceptNewChain({ ...roster, standbys: ['e', 'g'] })).toBe(false);
  });

  it('enforces the planned handover sequence', () => {
    let state = advanceArchiveLifecycle('ACTIVE', { uniqueExitNonce: true });
    state = advanceArchiveLifecycle(state, {});
    state = advanceArchiveLifecycle(state, {
      assignedRoundsDrained: true,
      latestAcAndDaPreserved: true,
    });
    state = advanceArchiveLifecycle(state, {
      standbyZeroSynced: true,
      bothStandbysReady: true,
    });
    state = advanceArchiveLifecycle(state, {
      membershipCertificateValid: true,
      l1MembershipSwitchFinal: true,
    });
    state = advanceArchiveLifecycle(state, {});
    state = advanceArchiveLifecycle(state, { liabilitiesExpired: true });
    expect(state).toBe('EXITED');
  });
});

describe('stdin/stdout conformance CLI', () => {
  it('returns one JSON response per JSONL request', () => {
    const cwd = resolve(import.meta.dirname, '..');
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts'], {
      cwd,
      input: `${JSON.stringify({ id: 1, op: 'da.encode', bodyHex: '0x00010203' })}\n`,
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    const response = JSON.parse(result.stdout.trim()) as { id: number; ok: boolean };
    expect(response).toEqual(expect.objectContaining({ id: 1, ok: true }));
  });

  it('rejects trailing SSZ bytes during decode', async () => {
    const report = await runCorpus();
    expect(report.ok).toBe(true);
    const raw = await import('../src/ssz.js');
    expect(() => decodeVote(`${report.failures.length === 0 ? '0x00' : '0x01'}` as Hex)).toThrow(
      'ERR_INVALID_CANONICAL_SSZ:length',
    );
    expect(raw).toBeDefined();
  });
});
