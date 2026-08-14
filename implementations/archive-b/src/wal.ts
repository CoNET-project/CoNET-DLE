import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, open, type FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';
import { getBytes, hexlify } from 'ethers';
import { Hex, ZERO32 } from './types.js';

const MAGIC = Buffer.from('DLEW');
const FRAME_VERSION = 1;
const HEADER_BYTES = 52;
const CHECKSUM_BYTES = 32;
export interface DurableVoteRecord {
  type: 'vote';
  version: number;
  kind: number;
  domain: number;
  height: string;
  round: number;
  step: number;
  canonicalSignBytes: Hex;
  signBytesHash: Hex;
  signingRoot: Hex;
  signature: Hex;
  proposalHash: Hex;
  lockedValue: Hex;
  lockedRound: number;
  validValue: Hex;
  validRound: number;
  prevoteQCRef: Hex;
  timeoutCertificateRef: Hex;
  membershipEpoch: string;
  membershipRoot: Hex;
  keyEpoch: string;
  committedHeight: string;
}

export interface SafetyStateRecord {
  type: 'state' | 'archive-certificate';
  domain: string;
  height: string;
  state: Record<string, unknown>;
}

export type WalRecord = DurableVoteRecord | SafetyStateRecord;

export interface WalFrame {
  sequence: bigint;
  flags: number;
  payloadHash: Hex;
  payload: Uint8Array;
  checksum: Hex;
  frameBytes: Uint8Array;
}

export interface WalOpenResult {
  wal: FramedSafetyWal;
  records: readonly WalRecord[];
  recoveryRequired: boolean;
}

function integer(value: string | number | bigint): bigint {
  const result = BigInt(value);
  if (result < 0n) throw new Error('ERR_WAL_INTEGER');
  return result;
}

function littleEndian(value: string | number | bigint, width: number): Buffer {
  const output = Buffer.alloc(width);
  let remaining = integer(value);
  for (let index = 0; index < width; index += 1) {
    output[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  if (remaining !== 0n) throw new Error('ERR_WAL_INTEGER_OVERFLOW');
  return output;
}

function fromLittleEndian(bytes: Uint8Array): bigint {
  let output = 0n;
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    output = (output << 8n) | BigInt(bytes[index] ?? 0);
  }
  return output;
}

function fixedHex(value: string, width: number, label: string): Buffer {
  if (!new RegExp(`^0x[0-9a-fA-F]{${width * 2}}$`).test(value)) throw new Error(`ERR_WAL_${label}`);
  return Buffer.from(getBytes(value));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) throw new Error('ERR_WAL_JSON_NUMBER');
    return JSON.stringify(value);
  }
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(',')}}`;
  }
  throw new Error('ERR_WAL_JSON_VALUE');
}

export function encodeWalSafetyRecord(record: DurableVoteRecord): Uint8Array {
  const signBytes = fixedHex(
    record.canonicalSignBytes,
    (record.canonicalSignBytes.length - 2) / 2,
    'SIGN_BYTES',
  );
  const signBytesHash = createHash('sha256').update(signBytes).digest();
  if (!timingSafeEqual(signBytesHash, fixedHex(record.signBytesHash, 32, 'SIGN_BYTES_HASH'))) {
    throw new Error('ERR_SIGNING_ROOT_MISMATCH');
  }
  return Buffer.concat([
    littleEndian(record.version, 2),
    littleEndian(record.kind, 1),
    littleEndian(record.domain, 1),
    littleEndian(record.height, 8),
    littleEndian(record.round, 4),
    littleEndian(record.step, 1),
    littleEndian(signBytes.length, 4),
    signBytes,
    fixedHex(record.signingRoot, 32, 'SIGNING_ROOT'),
    fixedHex(record.signature, 65, 'SIGNATURE'),
    fixedHex(record.proposalHash, 32, 'PROPOSAL_HASH'),
    fixedHex(record.lockedValue, 32, 'LOCKED_VALUE'),
    littleEndian(record.lockedRound, 4),
    fixedHex(record.validValue, 32, 'VALID_VALUE'),
    littleEndian(record.validRound, 4),
    fixedHex(record.prevoteQCRef, 32, 'PREVOTE_QC_REF'),
    fixedHex(record.timeoutCertificateRef, 32, 'TIMEOUT_CERTIFICATE_REF'),
    littleEndian(record.membershipEpoch, 8),
    fixedHex(record.membershipRoot, 32, 'MEMBERSHIP_ROOT'),
    littleEndian(record.keyEpoch, 8),
    littleEndian(record.committedHeight, 8),
  ]);
}

export function decodeWalSafetyRecord(payload: Uint8Array): DurableVoteRecord {
  if (payload.length < 342) throw new Error('ERR_WAL_SAFETY_LENGTH');
  let offset = 0;
  const take = (width: number): Uint8Array => {
    const result = payload.slice(offset, offset + width);
    offset += width;
    return result;
  };
  const number = (width: number): number => Number(fromLittleEndian(take(width)));
  const bigint = (width: number): string => fromLittleEndian(take(width)).toString();
  const hash = (width = 32): Hex => hexlify(take(width)) as Hex;
  const version = number(2);
  const kind = number(1);
  const domain = number(1);
  const height = bigint(8);
  const round = number(4);
  const step = number(1);
  const signBytesLength = number(4);
  if (offset + signBytesLength + 321 !== payload.length) throw new Error('ERR_WAL_SAFETY_LENGTH');
  const canonicalSignBytes = hash(signBytesLength);
  const record: DurableVoteRecord = {
    type: 'vote',
    version,
    kind,
    domain,
    height,
    round,
    step,
    canonicalSignBytes,
    signBytesHash: hexlify(createHash('sha256').update(getBytes(canonicalSignBytes)).digest()) as Hex,
    signingRoot: hash(),
    signature: hash(65),
    proposalHash: hash(),
    lockedValue: hash(),
    lockedRound: number(4),
    validValue: hash(),
    validRound: number(4),
    prevoteQCRef: hash(),
    timeoutCertificateRef: hash(),
    membershipEpoch: bigint(8),
    membershipRoot: hash(),
    keyEpoch: bigint(8),
    committedHeight: bigint(8),
  };
  if (offset !== payload.length) throw new Error('ERR_WAL_SAFETY_LENGTH');
  return record;
}

export function encodeWalFrame(
  sequence: bigint,
  flags: number,
  payload: Uint8Array,
): Uint8Array {
  const payloadHash = createHash('sha256').update(payload).digest();
  const header = Buffer.concat([
    MAGIC,
    littleEndian(FRAME_VERSION, 2),
    littleEndian(flags, 2),
    littleEndian(sequence, 8),
    littleEndian(payload.length, 4),
    payloadHash,
  ]);
  const checksum = createHash('sha256').update(header).update(payload).digest();
  return Buffer.concat([header, payload, checksum]);
}

export function decodeWalFrames(bytes: Uint8Array): readonly WalFrame[] {
  const input = Buffer.from(bytes);
  const output: WalFrame[] = [];
  let offset = 0;
  while (offset < input.length) {
    if (input.length - offset < HEADER_BYTES + CHECKSUM_BYTES) throw new Error('ERR_WAL_TRUNCATED');
    const header = input.subarray(offset, offset + HEADER_BYTES);
    if (
      !header.subarray(0, 4).equals(MAGIC) ||
      fromLittleEndian(header.subarray(4, 6)) !== BigInt(FRAME_VERSION)
    ) {
      throw new Error('ERR_WAL_HEADER');
    }
    const payloadLength = Number(fromLittleEndian(header.subarray(16, 20)));
    const frameLength = HEADER_BYTES + payloadLength + CHECKSUM_BYTES;
    if (input.length - offset < frameLength) throw new Error('ERR_WAL_TRUNCATED');
    const payload = input.subarray(offset + HEADER_BYTES, offset + HEADER_BYTES + payloadLength);
    const checksum = input.subarray(offset + HEADER_BYTES + payloadLength, offset + frameLength);
    const payloadHash = createHash('sha256').update(payload).digest();
    if (!timingSafeEqual(header.subarray(20, 52), payloadHash)) throw new Error('ERR_WAL_CHECKSUM');
    const expected = createHash('sha256').update(header).update(payload).digest();
    if (!timingSafeEqual(checksum, expected)) throw new Error('ERR_WAL_CHECKSUM');
    output.push({
      sequence: fromLittleEndian(header.subarray(8, 16)),
      flags: Number(fromLittleEndian(header.subarray(6, 8))),
      payloadHash: hexlify(payloadHash) as Hex,
      payload,
      checksum: hexlify(checksum) as Hex,
      frameBytes: input.slice(offset, offset + frameLength),
    });
    offset += frameLength;
  }
  return output;
}

function voteSlot(record: DurableVoteRecord): string {
  return `${record.domain}|${record.height}|${record.round}|${record.step}`;
}

function voteFingerprint(record: DurableVoteRecord): string {
  return createHash('sha256').update(encodeWalSafetyRecord(record)).digest('hex');
}

async function writeFully(handle: FileHandle, frame: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < frame.length) {
    const { bytesWritten } = await handle.write(frame, offset, frame.length - offset, null);
    if (bytesWritten <= 0) throw new Error('ERR_WAL_WRITE_STALLED');
    offset += bytesWritten;
  }
}

export class FramedSafetyWal {
  readonly #handle: FileHandle;
  readonly #votes = new Map<string, string>();
  #sequence: bigint;
  #queue: Promise<void> = Promise.resolve();
  #recoveryRequired: boolean;

  private constructor(
    handle: FileHandle,
    records: readonly WalRecord[],
    sequence: bigint,
    recoveryRequired: boolean,
  ) {
    this.#handle = handle;
    this.#sequence = sequence;
    this.#recoveryRequired = recoveryRequired;
    for (const record of records) {
      if (record.type !== 'vote') continue;
      const slot = voteSlot(record);
      const fingerprint = voteFingerprint(record);
      const prior = this.#votes.get(slot);
      if (prior && prior !== fingerprint) this.#recoveryRequired = true;
      this.#votes.set(slot, fingerprint);
    }
  }

  static async open(path: string): Promise<WalOpenResult> {
    await mkdir(dirname(path), { recursive: true });
    const handle = await open(path, 'a+');
    const bytes = await handle.readFile();
    const records: WalRecord[] = [];
    let recoveryRequired = false;
    let frames: readonly WalFrame[] = [];
    try {
      frames = decodeWalFrames(bytes);
      for (const frame of frames) {
        if (frame.flags === 1) records.push(decodeWalSafetyRecord(frame.payload));
        else records.push(JSON.parse(Buffer.from(frame.payload).toString('utf8')) as SafetyStateRecord);
      }
    } catch {
      recoveryRequired = true;
    }
    const nextSequence = frames.length === 0 ? 1n : frames[frames.length - 1]!.sequence + 1n;
    const wal = new FramedSafetyWal(handle, records, nextSequence, recoveryRequired);
    return { wal, records, recoveryRequired: wal.recoveryRequired };
  }

  get recoveryRequired(): boolean {
    return this.#recoveryRequired;
  }

  async append(record: WalRecord): Promise<void> {
    if (this.#recoveryRequired) throw new Error('ERR_WAL_RECOVERY_REQUIRED');
    const operation = async (): Promise<void> => {
      try {
        if (this.#recoveryRequired) throw new Error('ERR_WAL_RECOVERY_REQUIRED');
        if (record.type === 'vote') {
          const prior = this.#votes.get(voteSlot(record));
          const fingerprint = voteFingerprint(record);
          if (prior && prior !== fingerprint) throw new Error('ERR_WAL_DOUBLE_SIGN');
          if (prior === fingerprint) return;
        }
        const payload =
          record.type === 'vote'
            ? encodeWalSafetyRecord(record)
            : Buffer.from(canonicalJson(record), 'utf8');
        const frame = encodeWalFrame(
          this.#sequence,
          record.type === 'vote' ? 1 : record.type === 'state' ? 2 : 3,
          payload,
        );
        await writeFully(this.#handle, frame);
        await this.#handle.sync();
        this.#sequence += 1n;
        if (record.type === 'vote') this.#votes.set(voteSlot(record), voteFingerprint(record));
      } catch (error) {
        this.#recoveryRequired = true;
        throw error;
      }
    };
    const queued = this.#queue.then(operation);
    this.#queue = queued.catch(() => undefined);
    return queued;
  }

  async close(): Promise<void> {
    await this.#queue;
    await this.#handle.close();
  }
}

export function emptySafetyVote(overrides: Partial<DurableVoteRecord> = {}): DurableVoteRecord {
  return {
    type: 'vote',
    version: 1,
    kind: 1,
    domain: 1,
    height: '0',
    round: 0,
    step: 0,
    canonicalSignBytes: '0x',
    signBytesHash: hexlify(createHash('sha256').update(new Uint8Array()).digest()) as Hex,
    signingRoot: ZERO32,
    signature: (`0x${'00'.repeat(65)}`) as Hex,
    proposalHash: ZERO32,
    lockedValue: ZERO32,
    lockedRound: 0xffff_ffff,
    validValue: ZERO32,
    validRound: 0xffff_ffff,
    prevoteQCRef: ZERO32,
    timeoutCertificateRef: ZERO32,
    membershipEpoch: '0',
    membershipRoot: ZERO32,
    keyEpoch: '0',
    committedHeight: '0',
    ...overrides,
  };
}

