import { concat, getBytes, hexlify, keccak256, sha256, toUtf8Bytes } from 'ethers';
import type { Hex } from './types.js';

const GENERATOR: readonly (readonly number[])[] = [
  [0x01, 0x00, 0x00, 0x00],
  [0x00, 0x01, 0x00, 0x00],
  [0x00, 0x00, 0x01, 0x00],
  [0x00, 0x00, 0x00, 0x01],
  [0x52, 0xf7, 0x02, 0xa6],
  [0xf7, 0x07, 0x04, 0xf5],
  [0x02, 0x04, 0xd5, 0xd2],
] as const;

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
let fieldElement = 1;
for (let i = 0; i < 255; i += 1) {
  EXP[i] = fieldElement;
  LOG[fieldElement] = i;
  fieldElement <<= 1;
  if ((fieldElement & 0x100) !== 0) fieldElement ^= 0x11d;
}
for (let i = 255; i < EXP.length; i += 1) EXP[i] = EXP[i - 255]!;

export interface BlockBodyV1 {
  classId: 1 | 2 | 3;
  chainNftId: bigint;
  height: bigint;
  parentBlockHash: Hex;
  l1ContextBlockNumber: bigint;
  l1ContextBlockHash: Hex;
  canonicalEventBytes: Uint8Array;
  selectionLogBytesV1: Uint8Array;
  validatorDepositBundleBytesV1: Uint8Array;
  executionWitnessBytesV1: Uint8Array;
}

export interface EncodedAvailability {
  payloadLength: bigint;
  chunkSize: number;
  chunks: readonly Uint8Array[];
  bodyCommitment: Hex;
  daRoot: Hex;
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a]! + LOG[b]!]!;
}

function gfInv(value: number): number {
  if (value === 0) throw new Error('singular matrix');
  return EXP[255 - LOG[value]!]!;
}

function invertMatrix(input: readonly (readonly number[])[]): number[][] {
  const size = input.length;
  const augmented = input.map((row, r) => [
    ...row,
    ...Array.from({ length: size }, (_, c) => (r === c ? 1 : 0)),
  ]);
  for (let column = 0; column < size; column += 1) {
    const pivot = augmented.findIndex((row, index) => index >= column && row![column] !== 0);
    if (pivot < 0) throw new Error('singular matrix');
    [augmented[column], augmented[pivot]] = [augmented[pivot]!, augmented[column]!];
    const inverse = gfInv(augmented[column]![column]!);
    augmented[column] = augmented[column]!.map((value) => gfMul(value, inverse));
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row]![column]!;
      if (factor === 0) continue;
      augmented[row] = augmented[row]!.map(
        (value, index) => value ^ gfMul(factor, augmented[column]![index]!),
      );
    }
  }
  return augmented.map((row) => row.slice(size));
}

function be(value: bigint, width: number): Uint8Array {
  if (value < 0n || value >= 1n << BigInt(width * 8)) throw new Error('integer overflow');
  const out = new Uint8Array(width);
  let remaining = value;
  for (let i = width - 1; i >= 0; i -= 1) {
    out[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}

function le(value: bigint, width: number): Uint8Array {
  return be(value, width).reverse();
}

function bytes32(value: Hex): Uint8Array {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error('expected bytes32');
  return getBytes(value);
}

function join(parts: readonly Uint8Array[]): Uint8Array {
  return getBytes(concat(parts));
}

function lp32(value: Uint8Array): Uint8Array {
  if (value.length > 0xffff_ffff) throw new Error('length overflow');
  return join([be(BigInt(value.length), 4), value]);
}

export function encodeBlockBodyV1(body: BlockBodyV1): Uint8Array {
  if (body.canonicalEventBytes.length === 0) throw new Error('empty event body');
  return join([
    toUtf8Bytes('DLEB1'),
    be(1n, 2),
    Uint8Array.of(body.classId),
    be(body.chainNftId, 32),
    be(body.height, 8),
    bytes32(body.parentBlockHash),
    be(body.l1ContextBlockNumber, 8),
    bytes32(body.l1ContextBlockHash),
    lp32(body.canonicalEventBytes),
    lp32(body.selectionLogBytesV1),
    lp32(body.validatorDepositBundleBytesV1),
    lp32(body.executionWitnessBytesV1),
  ]);
}

export function bodyCommitment(bodyBytes: Uint8Array): Hex {
  return sha256(
    concat([toUtf8Bytes('dle.body.v1'), le(BigInt(bodyBytes.length), 8), bodyBytes]),
  ) as Hex;
}

function encodeCodeword(codeword: Uint8Array): readonly Uint8Array[] {
  const chunkSize = Math.ceil(codeword.length / 4);
  const padded = new Uint8Array(chunkSize * 4);
  padded.set(codeword);
  const data = Array.from({ length: 4 }, (_, index) =>
    padded.slice(index * chunkSize, (index + 1) * chunkSize),
  );
  return GENERATOR.map((row) => {
    const chunk = new Uint8Array(chunkSize);
    for (let offset = 0; offset < chunkSize; offset += 1) {
      let encoded = 0;
      for (let column = 0; column < 4; column += 1) {
        encoded ^= gfMul(row[column]!, data[column]![offset]!);
      }
      chunk[offset] = encoded;
    }
    return chunk;
  });
}

export function encodeRs74(bodyBytes: Uint8Array): readonly Uint8Array[] {
  return encodeCodeword(join([le(BigInt(bodyBytes.length), 8), bodyBytes]));
}

export function encodeRs74Legacy(bodyBytes: Uint8Array): readonly Uint8Array[] {
  if (bodyBytes.length === 0) throw new Error('empty body');
  return encodeCodeword(bodyBytes);
}

export function reconstructRs74(
  selected: readonly { index: number; chunk: Uint8Array }[],
  payloadLength: number,
): Uint8Array {
  if (selected.length !== 4 || new Set(selected.map(({ index }) => index)).size !== 4) {
    throw new Error('exactly four distinct chunks required');
  }
  if (selected.some(({ index }) => index < 0 || index >= 7)) throw new Error('invalid chunk index');
  const codewordLength = payloadLength + 8;
  const chunkSize = Math.ceil(codewordLength / 4);
  if (selected.some(({ chunk }) => chunk.length !== chunkSize)) throw new Error('chunk size mismatch');
  const inverse = invertMatrix(selected.map(({ index }) => GENERATOR[index]!));
  const data = Array.from({ length: 4 }, () => new Uint8Array(chunkSize));
  for (let row = 0; row < 4; row += 1) {
    for (let offset = 0; offset < chunkSize; offset += 1) {
      let decoded = 0;
      for (let column = 0; column < 4; column += 1) {
        decoded ^= gfMul(inverse[row]![column]!, selected[column]!.chunk[offset]!);
      }
      data[row]![offset] = decoded;
    }
  }
  const codeword = join(data).slice(0, codewordLength);
  let declaredLength = 0n;
  for (const byte of codeword.slice(0, 8).reverse()) declaredLength = (declaredLength << 8n) | BigInt(byte);
  if (declaredLength !== BigInt(payloadLength)) throw new Error('payload length prefix mismatch');
  return codeword.slice(8);
}

export function computeDaRoot(chunks: readonly Uint8Array[], bodyLength: number): Hex {
  if (chunks.length !== 7) throw new Error('expected seven chunks');
  const length = le(BigInt(bodyLength), 8);
  let level: Hex[] = chunks.map(
    (chunk, index) =>
      sha256(
        concat([Uint8Array.of(0), le(BigInt(index), 4), length, chunk]),
      ) as Hex,
  );
  level.push(sha256(Uint8Array.of(2)) as Hex);
  while (level.length > 1) {
    const next: Hex[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(
        sha256(
          concat([Uint8Array.of(1), getBytes(level[i]!), getBytes(level[i + 1]!)]),
        ) as Hex,
      );
    }
    level = next;
  }
  return level[0]!;
}

export function encodeAvailability(bodyBytes: Uint8Array): EncodedAvailability {
  const chunks = encodeRs74(bodyBytes);
  return {
    payloadLength: BigInt(bodyBytes.length),
    chunkSize: chunks[0]!.length,
    chunks,
    bodyCommitment: bodyCommitment(bodyBytes),
    daRoot: computeDaRoot(chunks, bodyBytes.length),
  };
}

export function chunksToHex(chunks: readonly Uint8Array[]): Hex[] {
  return chunks.map((chunk) => hexlify(chunk) as Hex);
}
