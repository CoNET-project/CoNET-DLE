#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { getBytes, hexlify } from 'ethers';
import { applyTendermintInput, tendermintStateRoot } from './consensus.js';
import { runCorpus } from './corpus.js';
import { chunksToHex, encodeAvailability, reconstructRs74 } from './da.js';
import { advanceArchiveLifecycle } from './lifecycle.js';
import { encodeProposal, encodeVote, proposalRoot, signingRoot, voteRoot } from './ssz.js';
import type {
  ArchiveLifecycleState,
  Hex,
  ProposalSignBytesV1,
  TendermintState,
  VoteSignBytesV1,
} from './types.js';
import { NONE_ROUND, ZERO32 } from './types.js';

type JsonObject = Record<string, unknown>;

function toHex(value: unknown): Hex {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]*$/.test(value)) throw new Error('invalid hex');
  return value.toLowerCase() as Hex;
}

function toBigInt(value: unknown): bigint {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
    throw new Error('invalid integer');
  }
  return BigInt(value);
}

function proposal(value: JsonObject): ProposalSignBytesV1 {
  return {
    protocolVersion: toHex(value.protocolVersion),
    l1ChainId: toBigInt(value.l1ChainId),
    archiveGroupId: toBigInt(value.archiveGroupId),
    chainNftId: toBigInt(value.chainNftId),
    tipHeight: toBigInt(value.tipHeight),
    round: Number(value.round),
    proposalValueHash: toHex(value.proposalValueHash),
    validRoundOrNone: Number(value.validRoundOrNone),
    validPrevoteQCRefOrZero: toHex(value.validPrevoteQCRefOrZero),
    attemptNonce: toBigInt(value.attemptNonce),
    membershipEpoch: toBigInt(value.membershipEpoch),
    membershipRoot: toHex(value.membershipRoot),
    keyEpoch: toBigInt(value.keyEpoch),
  };
}

function vote(value: JsonObject): VoteSignBytesV1 {
  const step = Number(value.step);
  if (step !== 1 && step !== 2) throw new Error('invalid vote step');
  return {
    protocolVersion: toHex(value.protocolVersion),
    l1ChainId: toBigInt(value.l1ChainId),
    archiveGroupId: toBigInt(value.archiveGroupId),
    chainNftId: toBigInt(value.chainNftId),
    tipHeight: toBigInt(value.tipHeight),
    round: Number(value.round),
    step,
    valueHashOrZero: toHex(value.valueHashOrZero),
    attemptNonce: toBigInt(value.attemptNonce),
    membershipEpoch: toBigInt(value.membershipEpoch),
    membershipRoot: toHex(value.membershipRoot),
    keyEpoch: toBigInt(value.keyEpoch),
    prevoteQCRefOrZero: toHex(value.prevoteQCRefOrZero),
  };
}

function fsmState(value: JsonObject): TendermintState {
  const locked = toHex(value.lockedValue);
  const valid = toHex(value.validValue);
  const validRef = toHex(value.validPrevoteQCRef);
  const committed = toHex(value.committedAcRef);
  const reject = toHex(value.rejectRef);
  return {
    height: toBigInt(value.height),
    round: Number(value.round),
    step: value.step as TendermintState['step'],
    mode: value.mode as TendermintState['mode'],
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

function fsmWireState(state: TendermintState): JsonObject {
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

async function dispatch(request: JsonObject): Promise<unknown> {
  switch (request.op) {
    case 'corpus.run':
      return runCorpus(
        typeof request.path === 'string' ? request.path : process.env.CORPUS_PATH,
      );
    case 'ssz.proposal': {
      const value = proposal(request.value as JsonObject);
      const root = proposalRoot(value);
      const domainTag =
        typeof request.domainTag === 'string' ? request.domainTag : 'dle.archive.proposal.v1';
      return { canonicalSsz: encodeProposal(value), hashTreeRoot: root, signingRoot: signingRoot(domainTag, root) };
    }
    case 'ssz.vote': {
      const value = vote(request.value as JsonObject);
      const root = voteRoot(value);
      const domainTag = typeof request.domainTag === 'string' ? request.domainTag : 'dle.archive.vote.v1';
      return { canonicalSsz: encodeVote(value), hashTreeRoot: root, signingRoot: signingRoot(domainTag, root) };
    }
    case 'da.encode': {
      const body = getBytes(toHex(request.bodyHex));
      const encoded = encodeAvailability(body);
      return { ...encoded, chunks: chunksToHex(encoded.chunks) };
    }
    case 'da.reconstruct': {
      if (!Array.isArray(request.chunks)) throw new Error('chunks must be an array');
      const selected = request.chunks.map((entry) => {
        const item = entry as JsonObject;
        return { index: Number(item.index), chunk: getBytes(toHex(item.chunkHex)) };
      });
      return {
        bodyHex: hexlify(reconstructRs74(selected, Number(request.payloadLength))),
      };
    }
    case 'fsm.replay': {
      if (!Array.isArray(request.inputs)) throw new Error('inputs must be an array');
      let state = fsmState(request.initial as JsonObject);
      const outputs: unknown[] = [];
      const errors: string[] = [];
      for (const input of request.inputs) {
        const transition = applyTendermintInput(state, input as Parameters<typeof applyTendermintInput>[1]);
        state = transition.state;
        outputs.push(...transition.outputs);
        if (transition.error) errors.push(transition.error);
      }
      return { state: fsmWireState(state), outputs, errors, stateRoot: tendermintStateRoot(state) };
    }
    case 'lifecycle.advance':
      return {
        state: advanceArchiveLifecycle(
          request.state as ArchiveLifecycleState,
          (request.context ?? {}) as JsonObject,
        ),
      };
    default:
      throw new Error('ERR_UNKNOWN_OPERATION');
  }
}

function stringify(value: unknown): string {
  return JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item));
}

async function main(): Promise<void> {
  if (process.argv.includes('--corpus')) {
    const report = await runCorpus();
    process.stdout.write(`${stringify(report)}\n`);
    process.exitCode = report.ok ? 0 : 1;
    return;
  }
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    let id: unknown = null;
    try {
      const request = JSON.parse(line) as JsonObject;
      id = request.id ?? null;
      const result = await dispatch(request);
      process.stdout.write(`${stringify({ id, ok: true, result })}\n`);
    } catch (error) {
      process.stdout.write(
        `${stringify({
          id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })}\n`,
      );
    }
  }
}

void main();
