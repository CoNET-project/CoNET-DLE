import { createHash } from 'node:crypto';
import { concat, getBytes, hexlify, keccak256, toUtf8Bytes } from 'ethers';
import {
  NONE_ROUND,
  ProposalSignBytesV1,
  VoteSignBytesV1,
  ZERO32,
  type Hex,
} from './types.js';

export type ContainerFieldKind =
  | 'bytes32'
  | 'uint8'
  | 'uint16'
  | 'uint32'
  | 'uint64'
  | 'uint256'
  | 'bytes32x5'
  | 'bytes65x5';
type FieldKind = ContainerFieldKind;
type FixedRecord = Record<string, unknown>;

interface Field {
  readonly name: string;
  readonly kind: FieldKind;
}

const WIDTH: Record<FieldKind, number> = {
  bytes32: 32,
  uint8: 1,
  uint16: 2,
  uint32: 4,
  uint64: 8,
  uint256: 32,
  bytes32x5: 160,
  bytes65x5: 325,
};

const PROPOSAL_FIELDS = [
  ['protocolVersion', 'bytes32'],
  ['l1ChainId', 'uint64'],
  ['archiveGroupId', 'uint64'],
  ['chainNftId', 'uint256'],
  ['tipHeight', 'uint64'],
  ['round', 'uint32'],
  ['proposalValueHash', 'bytes32'],
  ['validRoundOrNone', 'uint32'],
  ['validPrevoteQCRefOrZero', 'bytes32'],
  ['attemptNonce', 'uint64'],
  ['membershipEpoch', 'uint64'],
  ['membershipRoot', 'bytes32'],
  ['keyEpoch', 'uint64'],
] as const satisfies ReadonlyArray<readonly [string, FieldKind]>;

const VOTE_FIELDS = [
  ['protocolVersion', 'bytes32'],
  ['l1ChainId', 'uint64'],
  ['archiveGroupId', 'uint64'],
  ['chainNftId', 'uint256'],
  ['tipHeight', 'uint64'],
  ['round', 'uint32'],
  ['step', 'uint8'],
  ['valueHashOrZero', 'bytes32'],
  ['attemptNonce', 'uint64'],
  ['membershipEpoch', 'uint64'],
  ['membershipRoot', 'bytes32'],
  ['keyEpoch', 'uint64'],
  ['prevoteQCRefOrZero', 'bytes32'],
] as const satisfies ReadonlyArray<readonly [string, FieldKind]>;

function fields(spec: ReadonlyArray<readonly [string, FieldKind]>): Field[] {
  return spec.map(([name, kind]) => ({ name, kind }));
}

function asUint(value: unknown, bits: number, field: string): bigint {
  const parsed =
    typeof value === 'bigint'
      ? value
      : typeof value === 'number' && Number.isSafeInteger(value)
        ? BigInt(value)
        : typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)
          ? BigInt(value)
          : null;
  if (parsed === null || parsed < 0n || parsed >= 1n << BigInt(bits)) {
    throw new Error(`ERR_INVALID_CANONICAL_SSZ:${field}`);
  }
  return parsed;
}

function encodeLittleEndian(value: bigint, width: number): Uint8Array {
  const out = new Uint8Array(width);
  let remaining = value;
  for (let i = 0; i < width; i += 1) {
    out[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}

function decodeLittleEndian(bytes: Uint8Array): bigint {
  let value = 0n;
  for (let i = bytes.length - 1; i >= 0; i -= 1) {
    value = (value << 8n) | BigInt(bytes[i] ?? 0);
  }
  return value;
}

function encodeField(kind: FieldKind, value: unknown, name: string): Uint8Array {
  if (kind === 'bytes32') {
    if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
      throw new Error(`ERR_INVALID_CANONICAL_SSZ:${name}`);
    }
    return getBytes(value);
  }
  if (kind === 'bytes32x5' || kind === 'bytes65x5') {
    const width = kind === 'bytes32x5' ? 32 : 65;
    if (
      !Array.isArray(value) ||
      value.length !== 5 ||
      value.some(
        (item) =>
          typeof item !== 'string' ||
          !new RegExp(`^0x[0-9a-fA-F]{${width * 2}}$`).test(item),
      )
    ) {
      throw new Error(`ERR_INVALID_CANONICAL_SSZ:${name}`);
    }
    return getBytes(concat(value as string[]));
  }
  return encodeLittleEndian(asUint(value, WIDTH[kind] * 8, name), WIDTH[kind]);
}

function assertExactKeys(value: FixedRecord, schema: Field[]): void {
  const expected = new Set(schema.map((field) => field.name));
  const actual = Object.keys(value);
  if (actual.length !== expected.size || actual.some((key) => !expected.has(key))) {
    throw new Error('ERR_INVALID_CANONICAL_SSZ:fields');
  }
}

function encodeContainer(value: FixedRecord, schema: Field[]): Uint8Array {
  assertExactKeys(value, schema);
  return getBytes(
    concat(schema.map((field) => encodeField(field.kind, value[field.name], field.name))),
  );
}

function sha256(bytes: Uint8Array): Uint8Array {
  return createHash('sha256').update(bytes).digest();
}

function fieldRoot(kind: FieldKind, encoded: Uint8Array): Uint8Array {
  if (kind === 'bytes32' || kind === 'uint256') return encoded;
  if (kind === 'bytes32x5') {
    return merkleize(Array.from({ length: 5 }, (_, index) => encoded.slice(index * 32, index * 32 + 32)));
  }
  if (kind === 'bytes65x5') {
    return merkleize(
      Array.from({ length: 5 }, (_, index) => {
        const signature = encoded.slice(index * 65, index * 65 + 65);
        const tail = new Uint8Array(32);
        tail[0] = signature[64] ?? 0;
        return merkleize([
          signature.slice(0, 32),
          signature.slice(32, 64),
          tail,
        ]);
      }),
    );
  }
  const chunk = new Uint8Array(32);
  chunk.set(encoded);
  return chunk;
}

function merkleize(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 0) return new Uint8Array(32);
  let width = 1;
  while (width < chunks.length) width *= 2;
  let level = Array.from({ length: width }, (_, index) => chunks[index] ?? new Uint8Array(32));
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(sha256(getBytes(concat([level[i]!, level[i + 1]!]))));
    }
    level = next;
  }
  return level[0]!;
}

function rootContainer(value: FixedRecord, schema: Field[]): Hex {
  assertExactKeys(value, schema);
  const roots = schema.map((field) =>
    fieldRoot(field.kind, encodeField(field.kind, value[field.name], field.name)),
  );
  return hexlify(merkleize(roots)) as Hex;
}

function decodeContainer(bytes: Uint8Array, schema: Field[]): FixedRecord {
  const expectedLength = schema.reduce((sum, field) => sum + WIDTH[field.kind], 0);
  if (bytes.length !== expectedLength) throw new Error('ERR_INVALID_CANONICAL_SSZ:length');
  let offset = 0;
  const decoded: FixedRecord = {};
  for (const field of schema) {
    const end = offset + WIDTH[field.kind];
    const part = bytes.slice(offset, end);
    decoded[field.name] =
      field.kind === 'bytes32'
        ? (hexlify(part) as Hex)
        : field.kind === 'bytes32x5'
          ? Array.from({ length: 5 }, (_, index) => hexlify(part.slice(index * 32, index * 32 + 32)) as Hex)
          : field.kind === 'bytes65x5'
            ? Array.from({ length: 5 }, (_, index) => hexlify(part.slice(index * 65, index * 65 + 65)) as Hex)
        : field.kind === 'uint8' || field.kind === 'uint32'
          ? Number(decodeLittleEndian(part))
          : decodeLittleEndian(part);
    offset = end;
  }
  return decoded;
}

export function validateProposal(value: ProposalSignBytesV1): void {
  if (value.proposalValueHash === ZERO32) throw new Error('ERR_NIL_ENCODING');
  const noValidRound = value.validRoundOrNone === NONE_ROUND;
  if (noValidRound !== (value.validPrevoteQCRefOrZero === ZERO32)) {
    throw new Error('ERR_INVALID_VALID_ROUND');
  }
  if (!noValidRound && value.validRoundOrNone >= value.round) {
    throw new Error('ERR_INVALID_VALID_ROUND');
  }
}

export function validateVote(value: VoteSignBytesV1): void {
  const isNil = value.valueHashOrZero === ZERO32;
  if (value.step === 1 && value.prevoteQCRefOrZero !== ZERO32) {
    throw new Error('ERR_NIL_ENCODING');
  }
  if (value.step === 2 && !isNil && value.prevoteQCRefOrZero === ZERO32) {
    throw new Error('ERR_NIL_ENCODING');
  }
}

export function encodeProposal(value: ProposalSignBytesV1): Hex {
  validateProposal(value);
  return hexlify(encodeContainer(value as unknown as FixedRecord, fields(PROPOSAL_FIELDS))) as Hex;
}

export function encodeVote(value: VoteSignBytesV1): Hex {
  validateVote(value);
  return hexlify(encodeContainer(value as unknown as FixedRecord, fields(VOTE_FIELDS))) as Hex;
}

export function proposalRoot(value: ProposalSignBytesV1): Hex {
  validateProposal(value);
  return rootContainer(value as unknown as FixedRecord, fields(PROPOSAL_FIELDS));
}

export function voteRoot(value: VoteSignBytesV1): Hex {
  validateVote(value);
  return rootContainer(value as unknown as FixedRecord, fields(VOTE_FIELDS));
}

export function signingRoot(domainTag: string, objectRoot: Hex): Hex {
  return keccak256(concat([toUtf8Bytes(domainTag), getBytes(objectRoot)])) as Hex;
}

export function encodeDeclaredContainer(
  value: Record<string, unknown>,
  schema: ReadonlyArray<readonly [string, ContainerFieldKind]>,
): Hex {
  return hexlify(encodeContainer(value, fields(schema))) as Hex;
}

export function declaredContainerRoot(
  value: Record<string, unknown>,
  schema: ReadonlyArray<readonly [string, ContainerFieldKind]>,
): Hex {
  return rootContainer(value, fields(schema));
}

export function decodeProposal(canonicalSsz: Hex): ProposalSignBytesV1 {
  const decoded = decodeContainer(getBytes(canonicalSsz), fields(PROPOSAL_FIELDS));
  const value = decoded as unknown as ProposalSignBytesV1;
  validateProposal(value);
  return value;
}

export function decodeVote(canonicalSsz: Hex): VoteSignBytesV1 {
  const decoded = decodeContainer(getBytes(canonicalSsz), fields(VOTE_FIELDS));
  const value = decoded as unknown as VoteSignBytesV1;
  validateVote(value);
  return value;
}
