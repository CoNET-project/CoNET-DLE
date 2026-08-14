import { createHash } from "node:crypto";
import { closeSync, fsyncSync, openSync, readFileSync, writeSync } from "node:fs";
import { keccak256 } from "ethers";

export type Hex = `0x${string}`;

export const ZERO32 = `0x${"00".repeat(32)}` as Hex;
export const ZERO65 = `0x${"00".repeat(65)}` as Hex;
export const NONE_ROUND = 0xffff_ffff;
export const ACTIVE_ARCHIVES = 5;
export const READY_STANDBYS = 2;
export const ARCHIVE_QUORUM = 4;
export const PROTOCOL_VERSION = sha256(utf8("dle.archive.tendermint.v2"));

export enum DleError {
  InvalidCanonicalSsz = "ERR_INVALID_CANONICAL_SSZ",
  SigningRootMismatch = "ERR_SIGNING_ROOT_MISMATCH",
  NilEncoding = "ERR_NIL_ENCODING",
  InvalidValidRound = "ERR_INVALID_VALID_ROUND",
  LockConflict = "ERR_LOCK_CONFLICT",
  InvalidCertificateKind = "ERR_INVALID_CERTIFICATE_KIND",
  InvalidCertificateReference = "ERR_INVALID_CERTIFICATE_REFERENCE",
  InvalidQuorum = "ERR_INVALID_QUORUM",
  DuplicateSigner = "ERR_DUPLICATE_SIGNER",
  NonCanonicalSignerOrder = "ERR_NON_CANONICAL_SIGNER_ORDER",
  SignerNotActive = "ERR_SIGNER_NOT_ACTIVE",
  WalDoubleSign = "ERR_WAL_DOUBLE_SIGN",
  WalRecoveryRequired = "ERR_WAL_RECOVERY_REQUIRED",
  WalSequence = "ERR_WAL_SEQUENCE",
  MembershipNotActive = "ERR_MEMBERSHIP_NOT_ACTIVE",
  MembershipRootMismatch = "ERR_MEMBERSHIP_ROOT_MISMATCH",
  MixedMembershipRoot = "ERR_MIXED_MEMBERSHIP_ROOT",
  KeyEpochMismatch = "ERR_KEY_EPOCH_MISMATCH",
  AmbiguousL1MembershipCheckpoint = "ERR_AMBIGUOUS_L1_MEMBERSHIP_CHECKPOINT",
  RejectAcceptConflict = "ERR_REJECT_ACCEPT_CONFLICT",
  RejectAfterFinality = "ERR_REJECT_AFTER_FINALITY",
  InvalidRejectReason = "ERR_INVALID_REJECT_REASON",
  InvalidRejectEvidence = "ERR_INVALID_REJECT_EVIDENCE",
  InvalidCoordinator = "ERR_INVALID_COORDINATOR",
  InvalidRsCodeword = "ERR_INVALID_RS_CODEWORD",
  InsufficientShards = "ERR_INSUFFICIENT_SHARDS",
  LifecycleTransition = "ERR_LIFECYCLE_TRANSITION"
}

export class DleProtocolError extends Error {
  constructor(readonly code: DleError, message: string = code) {
    super(message);
    this.name = "DleProtocolError";
  }
}

export enum CertificateKind {
  PrevoteQC = 1,
  ArchiveCertificate = 2,
  TimeoutCertificate = 3,
  CandidateRejectCertificate = 4
}

export enum VoteStep {
  Prevote = 1,
  Precommit = 2
}

export enum TimeoutStep {
  Propose = 0,
  Prevote = 1,
  Precommit = 2
}

export enum RejectReason {
  InvalidValidatorQuorum = 1,
  InvalidStateTransition = 2,
  BodyCommitmentMismatch = 3,
  DaRootMismatch = 4,
  InvalidRsCodeword = 5,
  UnavailableBody = 6,
  InvalidParentCertificate = 7,
  MembershipMismatch = 8
}

export const REJECT_EVIDENCE_REQUIRED: Readonly<Record<RejectReason, true>> = {
  [RejectReason.InvalidValidatorQuorum]: true,
  [RejectReason.InvalidStateTransition]: true,
  [RejectReason.BodyCommitmentMismatch]: true,
  [RejectReason.DaRootMismatch]: true,
  [RejectReason.InvalidRsCodeword]: true,
  [RejectReason.UnavailableBody]: true,
  [RejectReason.InvalidParentCertificate]: true,
  [RejectReason.MembershipMismatch]: true
};

export interface ProposalSignBytes {
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

export interface VoteSignBytes {
  protocolVersion: Hex;
  l1ChainId: bigint;
  archiveGroupId: bigint;
  chainNftId: bigint;
  tipHeight: bigint;
  round: number;
  step: VoteStep;
  valueHashOrZero: Hex;
  attemptNonce: bigint;
  membershipEpoch: bigint;
  membershipRoot: Hex;
  keyEpoch: bigint;
  prevoteQCRefOrZero: Hex;
}

interface CertificateCommon {
  protocolVersion: Hex;
  l1ChainId: bigint;
  archiveGroupId: bigint;
  chainNftId: bigint;
  tipHeight: bigint;
  round: number;
  attemptNonce: bigint;
  membershipEpoch: bigint;
  membershipRoot: Hex;
  keyEpoch: bigint;
  signerBitmap: number;
  signerIds: readonly Hex[];
  signatures: readonly Hex[];
}

export interface PrevoteQC extends CertificateCommon {
  kind: CertificateKind.PrevoteQC;
  valueHashOrZero: Hex;
  voteRoot: Hex;
}

export interface ArchiveCertificate extends CertificateCommon {
  kind: CertificateKind.ArchiveCertificate;
  valueHash: Hex;
  prevoteQCRef: Hex;
  voteRoot: Hex;
}

export interface TimeoutCertificate extends CertificateCommon {
  kind: CertificateKind.TimeoutCertificate;
  timeoutStep: TimeoutStep;
  highestPrevoteQCRefOrZero: Hex;
  highestTimeoutQCRefOrZero: Hex;
  timeoutVoteRoot: Hex;
}

export interface CandidateRejectCertificate extends CertificateCommon {
  kind: CertificateKind.CandidateRejectCertificate;
  candidateId: Hex;
  reasonCode: RejectReason;
  evidenceHash: Hex;
  rejectVoteRoot: Hex;
}

export type Certificate =
  | PrevoteQC
  | ArchiveCertificate
  | TimeoutCertificate
  | CandidateRejectCertificate;

type FieldType =
  | "bytes4"
  | "bytes32"
  | "bytes65"
  | "uint8"
  | "uint16"
  | "uint32"
  | "uint64"
  | "uint256"
  | "bytes32x5"
  | "bytes65x5";

interface Field {
  readonly name: string;
  readonly type: FieldType;
}

export const CONTAINERS = {
  ProposalSignBytesV1: [
    ["protocolVersion", "bytes32"],
    ["l1ChainId", "uint64"],
    ["archiveGroupId", "uint64"],
    ["chainNftId", "uint256"],
    ["tipHeight", "uint64"],
    ["round", "uint32"],
    ["proposalValueHash", "bytes32"],
    ["validRoundOrNone", "uint32"],
    ["validPrevoteQCRefOrZero", "bytes32"],
    ["attemptNonce", "uint64"],
    ["membershipEpoch", "uint64"],
    ["membershipRoot", "bytes32"],
    ["keyEpoch", "uint64"]
  ],
  VoteSignBytesV1: [
    ["protocolVersion", "bytes32"],
    ["l1ChainId", "uint64"],
    ["archiveGroupId", "uint64"],
    ["chainNftId", "uint256"],
    ["tipHeight", "uint64"],
    ["round", "uint32"],
    ["step", "uint8"],
    ["valueHashOrZero", "bytes32"],
    ["attemptNonce", "uint64"],
    ["membershipEpoch", "uint64"],
    ["membershipRoot", "bytes32"],
    ["keyEpoch", "uint64"],
    ["prevoteQCRefOrZero", "bytes32"]
  ],
  PrevoteQCV2: [
    ["protocolVersion", "bytes32"],
    ["kind", "uint8"],
    ["l1ChainId", "uint64"],
    ["archiveGroupId", "uint64"],
    ["chainNftId", "uint256"],
    ["tipHeight", "uint64"],
    ["round", "uint32"],
    ["valueHashOrZero", "bytes32"],
    ["attemptNonce", "uint64"],
    ["membershipEpoch", "uint64"],
    ["membershipRoot", "bytes32"],
    ["keyEpoch", "uint64"],
    ["voteRoot", "bytes32"],
    ["signerBitmap", "uint8"],
    ["signerIds", "bytes32x5"],
    ["signatures", "bytes65x5"]
  ],
  ArchiveCertificateV2: [
    ["protocolVersion", "bytes32"],
    ["kind", "uint8"],
    ["l1ChainId", "uint64"],
    ["archiveGroupId", "uint64"],
    ["chainNftId", "uint256"],
    ["tipHeight", "uint64"],
    ["round", "uint32"],
    ["valueHash", "bytes32"],
    ["attemptNonce", "uint64"],
    ["membershipEpoch", "uint64"],
    ["membershipRoot", "bytes32"],
    ["keyEpoch", "uint64"],
    ["prevoteQCRef", "bytes32"],
    ["voteRoot", "bytes32"],
    ["signerBitmap", "uint8"],
    ["signerIds", "bytes32x5"],
    ["signatures", "bytes65x5"]
  ],
  TimeoutCertificateV2: [
    ["protocolVersion", "bytes32"],
    ["kind", "uint8"],
    ["l1ChainId", "uint64"],
    ["archiveGroupId", "uint64"],
    ["chainNftId", "uint256"],
    ["tipHeight", "uint64"],
    ["round", "uint32"],
    ["timeoutStep", "uint8"],
    ["attemptNonce", "uint64"],
    ["membershipEpoch", "uint64"],
    ["membershipRoot", "bytes32"],
    ["keyEpoch", "uint64"],
    ["highestPrevoteQCRefOrZero", "bytes32"],
    ["highestTimeoutQCRefOrZero", "bytes32"],
    ["timeoutVoteRoot", "bytes32"],
    ["signerBitmap", "uint8"],
    ["signerIds", "bytes32x5"],
    ["signatures", "bytes65x5"]
  ],
  CandidateRejectCertificateV2: [
    ["protocolVersion", "bytes32"],
    ["kind", "uint8"],
    ["l1ChainId", "uint64"],
    ["archiveGroupId", "uint64"],
    ["chainNftId", "uint256"],
    ["tipHeight", "uint64"],
    ["round", "uint32"],
    ["candidateId", "bytes32"],
    ["attemptNonce", "uint64"],
    ["membershipEpoch", "uint64"],
    ["membershipRoot", "bytes32"],
    ["keyEpoch", "uint64"],
    ["reasonCode", "uint16"],
    ["evidenceHash", "bytes32"],
    ["rejectVoteRoot", "bytes32"],
    ["signerBitmap", "uint8"],
    ["signerIds", "bytes32x5"],
    ["signatures", "bytes65x5"]
  ]
} as const satisfies Record<string, readonly (readonly [string, FieldType])[]>;

const DOMAIN_TAGS: Readonly<Record<keyof typeof CONTAINERS, string>> = {
  ProposalSignBytesV1: "dle.archive.proposal.v1",
  VoteSignBytesV1: "dle.archive.vote.v1",
  PrevoteQCV2: "dle.archive.prevote-qc.v2",
  ArchiveCertificateV2: "dle.archive.ac.v2",
  TimeoutCertificateV2: "dle.archive.tc.v2",
  CandidateRejectCertificateV2: "dle.archive.reject.v2"
};

export function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function bytesToHex(value: Uint8Array): Hex {
  return `0x${Buffer.from(value).toString("hex")}`;
}

export function hexToBytes(value: string, exactLength?: number): Uint8Array {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new DleProtocolError(DleError.InvalidCanonicalSsz, `Invalid hex: ${value}`);
  }
  const bytes = Uint8Array.from(Buffer.from(value.slice(2), "hex"));
  if (exactLength !== undefined && bytes.length !== exactLength) {
    throw new DleProtocolError(
      DleError.InvalidCanonicalSsz,
      `Expected ${exactLength} bytes, got ${bytes.length}`
    );
  }
  return bytes;
}

export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export function sha256(value: Uint8Array): Hex {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

export function keccak(value: Uint8Array): Hex {
  return keccak256(value) as Hex;
}

export function uintLE(value: bigint | number, byteLength: number): Uint8Array {
  let remaining = BigInt(value);
  const max = 1n << BigInt(byteLength * 8);
  if (remaining < 0n || remaining >= max) {
    throw new DleProtocolError(DleError.InvalidCanonicalSsz, "Integer out of range");
  }
  const out = new Uint8Array(byteLength);
  for (let index = 0; index < byteLength; index += 1) {
    out[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}

function fieldByteLength(type: FieldType): number {
  switch (type) {
    case "bytes4":
      return 4;
    case "bytes32":
      return 32;
    case "bytes65":
      return 65;
    case "uint8":
      return 1;
    case "uint16":
      return 2;
    case "uint32":
      return 4;
    case "uint64":
      return 8;
    case "uint256":
      return 32;
    case "bytes32x5":
      return 160;
    case "bytes65x5":
      return 325;
  }
}

function encodeField(type: FieldType, value: unknown): Uint8Array {
  switch (type) {
    case "bytes4":
      return hexToBytes(String(value), 4);
    case "bytes32":
      return hexToBytes(String(value), 32);
    case "bytes65":
      return hexToBytes(String(value), 65);
    case "uint8":
      return uintLE(BigInt(value as number | bigint), 1);
    case "uint16":
      return uintLE(BigInt(value as number | bigint), 2);
    case "uint32":
      return uintLE(BigInt(value as number | bigint), 4);
    case "uint64":
      return uintLE(BigInt(value as number | bigint), 8);
    case "uint256":
      return uintLE(BigInt(value as number | bigint), 32);
    case "bytes32x5": {
      const values = value as readonly Hex[];
      if (values.length !== ACTIVE_ARCHIVES) {
        throw new DleProtocolError(DleError.InvalidCanonicalSsz, "Expected five signer IDs");
      }
      return concatBytes(...values.map((item) => hexToBytes(item, 32)));
    }
    case "bytes65x5": {
      const values = value as readonly Hex[];
      if (values.length !== ACTIVE_ARCHIVES) {
        throw new DleProtocolError(DleError.InvalidCanonicalSsz, "Expected five signatures");
      }
      return concatBytes(...values.map((item) => hexToBytes(item, 65)));
    }
  }
}

function nextPowerOfTwo(value: number): number {
  let current = 1;
  while (current < value) current *= 2;
  return current;
}

function merkleize(chunks: readonly Uint8Array[], limit = chunks.length): Uint8Array {
  const width = nextPowerOfTwo(Math.max(1, limit));
  let layer = Array.from({ length: width }, (_, index) =>
    index < chunks.length ? chunks[index]! : new Uint8Array(32)
  );
  if (layer.some((chunk) => chunk.length !== 32)) {
    throw new DleProtocolError(DleError.InvalidCanonicalSsz, "SSZ chunks must be 32 bytes");
  }
  while (layer.length > 1) {
    const next: Uint8Array[] = [];
    for (let index = 0; index < layer.length; index += 2) {
      next.push(hexToBytes(sha256(concatBytes(layer[index]!, layer[index + 1]!)), 32));
    }
    layer = next;
  }
  return layer[0]!;
}

function byteVectorRoot(value: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < value.length; offset += 32) {
    const chunk = new Uint8Array(32);
    chunk.set(value.slice(offset, offset + 32));
    chunks.push(chunk);
  }
  return merkleize(chunks, Math.ceil(value.length / 32));
}

function fieldRoot(type: FieldType, value: unknown): Uint8Array {
  if (type.startsWith("uint") || type === "bytes4" || type === "bytes32") {
    const root = new Uint8Array(32);
    root.set(encodeField(type, value));
    return root;
  }
  if (type === "bytes65") return byteVectorRoot(encodeField(type, value));
  if (type === "bytes32x5") {
    return merkleize((value as readonly Hex[]).map((item) => hexToBytes(item, 32)), 5);
  }
  if (type === "bytes65x5") {
    return merkleize(
      (value as readonly Hex[]).map((item) => byteVectorRoot(hexToBytes(item, 65))),
      5
    );
  }
  throw new DleProtocolError(DleError.InvalidCanonicalSsz, `Unsupported field type: ${type}`);
}

function fieldsFor(container: keyof typeof CONTAINERS): readonly Field[] {
  return CONTAINERS[container].map(([name, type]) => ({ name, type }));
}

export function serializeContainer(
  container: keyof typeof CONTAINERS,
  object: Record<string, unknown>
): Uint8Array {
  const fields = fieldsFor(container);
  const expectedKeys = new Set(fields.map((field) => field.name));
  for (const key of Object.keys(object)) {
    if (!expectedKeys.has(key)) {
      throw new DleProtocolError(DleError.InvalidCanonicalSsz, `Unknown field: ${key}`);
    }
  }
  for (const field of fields) {
    if (!(field.name in object)) {
      throw new DleProtocolError(DleError.InvalidCanonicalSsz, `Missing field: ${field.name}`);
    }
  }
  return concatBytes(...fields.map((field) => encodeField(field.type, object[field.name])));
}

export function decodeContainer(
  container: keyof typeof CONTAINERS,
  bytes: Uint8Array
): Record<string, Hex | bigint | number | readonly Hex[]> {
  const fields = fieldsFor(container);
  const expectedLength = fields.reduce((sum, field) => sum + fieldByteLength(field.type), 0);
  if (bytes.length !== expectedLength) {
    throw new DleProtocolError(
      DleError.InvalidCanonicalSsz,
      `Expected ${expectedLength} bytes, got ${bytes.length}`
    );
  }
  const result: Record<string, Hex | bigint | number | readonly Hex[]> = {};
  let offset = 0;
  for (const field of fields) {
    const length = fieldByteLength(field.type);
    const slice = bytes.slice(offset, offset + length);
    offset += length;
    if (field.type.startsWith("bytes") && !field.type.endsWith("x5")) {
      result[field.name] = bytesToHex(slice);
    } else if (field.type === "bytes32x5") {
      result[field.name] = Array.from({ length: 5 }, (_, index) =>
        bytesToHex(slice.slice(index * 32, index * 32 + 32))
      );
    } else if (field.type === "bytes65x5") {
      result[field.name] = Array.from({ length: 5 }, (_, index) =>
        bytesToHex(slice.slice(index * 65, index * 65 + 65))
      );
    } else {
      let value = 0n;
      for (let index = slice.length - 1; index >= 0; index -= 1) {
        value = (value << 8n) | BigInt(slice[index]!);
      }
      result[field.name] =
        field.type === "uint8" || field.type === "uint16" || field.type === "uint32"
          ? Number(value)
          : value;
    }
  }
  return result;
}

export function hashTreeRoot(
  container: keyof typeof CONTAINERS,
  object: Record<string, unknown>
): Hex {
  return bytesToHex(
    merkleize(
      fieldsFor(container).map((field) => fieldRoot(field.type, object[field.name])),
      fieldsFor(container).length
    )
  );
}

export function signingRoot(
  container: keyof typeof CONTAINERS,
  object: Record<string, unknown>
): Hex {
  return keccak(concatBytes(utf8(DOMAIN_TAGS[container]), hexToBytes(hashTreeRoot(container, object), 32)));
}

export function certificateContainer(certificate: Certificate): keyof typeof CONTAINERS {
  switch (certificate.kind) {
    case CertificateKind.PrevoteQC:
      return "PrevoteQCV2";
    case CertificateKind.ArchiveCertificate:
      return "ArchiveCertificateV2";
    case CertificateKind.TimeoutCertificate:
      return "TimeoutCertificateV2";
    case CertificateKind.CandidateRejectCertificate:
      return "CandidateRejectCertificateV2";
    default:
      throw new DleProtocolError(DleError.InvalidCertificateKind);
  }
}

export function certificateRef(certificate: Certificate): Hex {
  const root = hashTreeRoot(certificateContainer(certificate), certificate as unknown as Record<string, unknown>);
  return sha256(
    concatBytes(
      utf8("dle.archive.certref.v2"),
      uintLE(certificate.kind, 1),
      hexToBytes(root, 32)
    )
  );
}

function popcount(value: number): number {
  let remaining = value;
  let count = 0;
  while (remaining !== 0) {
    count += remaining & 1;
    remaining >>>= 1;
  }
  return count;
}

export function validateCertificate(certificate: Certificate): void {
  if ((certificate.signerBitmap & ~0x1f) !== 0 || popcount(certificate.signerBitmap) < ARCHIVE_QUORUM) {
    throw new DleProtocolError(DleError.InvalidQuorum);
  }
  if (
    certificate.signerIds.length !== ACTIVE_ARCHIVES ||
    new Set(certificate.signerIds.map((id) => id.toLowerCase())).size !== ACTIVE_ARCHIVES
  ) {
    throw new DleProtocolError(DleError.DuplicateSigner);
  }
  if (
    certificate.signerIds.some(
      (id, index) => index > 0 && compareHex(certificate.signerIds[index - 1]!, id) >= 0
    )
  ) {
    throw new DleProtocolError(DleError.NonCanonicalSignerOrder);
  }
  if (certificate.signatures.length !== ACTIVE_ARCHIVES) {
    throw new DleProtocolError(DleError.InvalidQuorum);
  }
  for (let index = 0; index < ACTIVE_ARCHIVES; index += 1) {
    const signed = (certificate.signerBitmap & (1 << index)) !== 0;
    if (signed === (certificate.signatures[index] === ZERO65)) {
      throw new DleProtocolError(DleError.InvalidQuorum, "Bitmap/signature slot mismatch");
    }
  }
  if (certificate.kind === CertificateKind.ArchiveCertificate) {
    if (certificate.valueHash === ZERO32 || certificate.prevoteQCRef === ZERO32) {
      throw new DleProtocolError(DleError.InvalidCertificateReference);
    }
  }
  if (certificate.kind === CertificateKind.CandidateRejectCertificate) {
    if (!REJECT_EVIDENCE_REQUIRED[certificate.reasonCode]) {
      throw new DleProtocolError(DleError.InvalidRejectReason);
    }
    if (certificate.evidenceHash === ZERO32) {
      throw new DleProtocolError(DleError.InvalidRejectEvidence);
    }
  }
}

export interface CoordinatorInput {
  archiveGroupId: bigint;
  chainNftId: bigint;
  tipHeight: bigint;
  attemptNonce: bigint;
  membershipRoot: Hex;
  round: number;
}

export interface CoordinatorSelection {
  canonicalRoster: readonly Hex[];
  digest: Hex;
  sample: string;
  index: number;
  coordinator: Hex;
  counter: number;
}

function compareHex(left: Hex, right: Hex): number {
  return Buffer.compare(Buffer.from(left.slice(2), "hex"), Buffer.from(right.slice(2), "hex"));
}

export function selectCoordinator(
  roster: readonly Hex[],
  input: CoordinatorInput
): CoordinatorSelection {
  if (roster.length !== ACTIVE_ARCHIVES) {
    throw new DleProtocolError(DleError.InvalidCoordinator, "Coordinator roster must contain five members");
  }
  const canonicalRoster = [...roster].sort(compareHex);
  if (new Set(canonicalRoster.map((item) => item.toLowerCase())).size !== ACTIVE_ARCHIVES) {
    throw new DleProtocolError(DleError.DuplicateSigner);
  }
  const preimage = concatBytes(
    utf8("dle.archive.coordinator.v1"),
    uintLE(input.archiveGroupId, 8),
    uintLE(input.chainNftId, 32),
    uintLE(input.tipHeight, 8),
    uintLE(input.attemptNonce, 8),
    hexToBytes(input.membershipRoot, 32),
    uintLE(input.round, 4)
  );
  const range = 1n << 64n;
  const ceiling = (range / BigInt(ACTIVE_ARCHIVES)) * BigInt(ACTIVE_ARCHIVES);
  for (let counter = 0; counter <= 0xffff_ffff; counter += 1) {
    const digest = sha256(concatBytes(preimage, uintLE(counter, 4)));
    const digestBytes = hexToBytes(digest, 32);
    let sample = 0n;
    for (let index = 7; index >= 0; index -= 1) {
      sample = (sample << 8n) | BigInt(digestBytes[index]!);
    }
    if (sample < ceiling) {
      const index = Number(sample % BigInt(ACTIVE_ARCHIVES));
      return {
        canonicalRoster,
        digest,
        sample: sample.toString(),
        index,
        coordinator: canonicalRoster[index]!,
        counter
      };
    }
  }
  throw new DleProtocolError(DleError.InvalidCoordinator, "Rejection sampling exhausted");
}

const WAL_MAGIC = Uint8Array.from([0x44, 0x4c, 0x45, 0x57]);
export const WAL_VERSION = 1;
export const WAL_HEADER_BYTES = 52;
export const WAL_CHECKSUM_BYTES = 32;
export const WAL_RECORD_VERSION = 1;

export interface WalSafetyRecord {
  recordKind: 1 | 2;
  domain: number;
  height: bigint;
  round: number;
  step: number;
  canonicalSignBytes: Uint8Array;
  signingRoot: Hex;
  signature: Hex;
  proposalHash: Hex;
  lockedValue: Hex;
  lockedRound: number;
  validValue: Hex;
  validRound: number;
  qcRef: Hex;
  tcRef: Hex;
  membershipEpoch: bigint;
  membershipRoot: Hex;
  keyEpoch: bigint;
  committedHeight: bigint;
}

export interface WalFrame {
  sequence: bigint;
  flags: number;
  payload: Uint8Array;
}

export interface DecodedWal {
  frames: readonly WalFrame[];
  recoveryRequired: boolean;
  validBytes: number;
}

export function encodeWalFrame(frame: WalFrame): Uint8Array {
  const payloadHash = hexToBytes(sha256(frame.payload), 32);
  const header = concatBytes(
    WAL_MAGIC,
    uintLE(WAL_VERSION, 2),
    uintLE(frame.flags, 2),
    uintLE(frame.sequence, 8),
    uintLE(frame.payload.length, 4),
    payloadHash
  );
  const checksum = hexToBytes(sha256(concatBytes(header, frame.payload)), 32);
  return concatBytes(header, frame.payload, checksum);
}

export function encodeWalSafetyRecord(record: WalSafetyRecord): Uint8Array {
  return concatBytes(
    uintLE(WAL_RECORD_VERSION, 2),
    uintLE(record.recordKind, 1),
    uintLE(record.domain, 1),
    uintLE(record.height, 8),
    uintLE(record.round, 4),
    uintLE(record.step, 1),
    uintLE(record.canonicalSignBytes.length, 4),
    record.canonicalSignBytes,
    hexToBytes(record.signingRoot, 32),
    hexToBytes(record.signature, 65),
    hexToBytes(record.proposalHash, 32),
    hexToBytes(record.lockedValue, 32),
    uintLE(record.lockedRound, 4),
    hexToBytes(record.validValue, 32),
    uintLE(record.validRound, 4),
    hexToBytes(record.qcRef, 32),
    hexToBytes(record.tcRef, 32),
    uintLE(record.membershipEpoch, 8),
    hexToBytes(record.membershipRoot, 32),
    uintLE(record.keyEpoch, 8),
    uintLE(record.committedHeight, 8)
  );
}

export function decodeWalSafetyRecord(payload: Uint8Array): WalSafetyRecord {
  const fixedBeforeSignBytes = 21;
  const fixedAfterSignBytes = 321;
  if (payload.length < fixedBeforeSignBytes + fixedAfterSignBytes) {
    throw new DleProtocolError(DleError.WalRecoveryRequired, "WAL safety record is truncated");
  }
  const version = readUintLE(payload.slice(0, 2));
  if (version !== BigInt(WAL_RECORD_VERSION)) {
    throw new DleProtocolError(DleError.WalRecoveryRequired, "Unknown WAL safety record version");
  }
  const canonicalLength = Number(readUintLE(payload.slice(17, 21)));
  if (payload.length !== fixedBeforeSignBytes + canonicalLength + fixedAfterSignBytes) {
    throw new DleProtocolError(DleError.WalRecoveryRequired, "WAL safety record length mismatch");
  }
  let offset = fixedBeforeSignBytes;
  const canonicalSignBytes = payload.slice(offset, offset + canonicalLength);
  offset += canonicalLength;
  const take = (length: number): Uint8Array => {
    const result = payload.slice(offset, offset + length);
    offset += length;
    return result;
  };
  const signingRootValue = bytesToHex(take(32));
  const signature = bytesToHex(take(65));
  const proposalHash = bytesToHex(take(32));
  const lockedValue = bytesToHex(take(32));
  const lockedRound = Number(readUintLE(take(4)));
  const validValue = bytesToHex(take(32));
  const validRound = Number(readUintLE(take(4)));
  const qcRef = bytesToHex(take(32));
  const tcRef = bytesToHex(take(32));
  const membershipEpoch = readUintLE(take(8));
  const membershipRootValue = bytesToHex(take(32));
  const keyEpoch = readUintLE(take(8));
  const committedHeight = readUintLE(take(8));
  return {
    recordKind: Number(payload[2]) as 1 | 2,
    domain: Number(payload[3]),
    height: readUintLE(payload.slice(4, 12)),
    round: Number(readUintLE(payload.slice(12, 16))),
    step: Number(payload[16]),
    canonicalSignBytes,
    signingRoot: signingRootValue,
    signature,
    proposalHash,
    lockedValue,
    lockedRound,
    validValue,
    validRound,
    qcRef,
    tcRef,
    membershipEpoch,
    membershipRoot: membershipRootValue,
    keyEpoch,
    committedHeight
  };
}

export function decodeWal(bytes: Uint8Array): DecodedWal {
  const frames: WalFrame[] = [];
  let offset = 0;
  let expectedSequence = 1n;
  while (offset < bytes.length) {
    if (bytes.length - offset < WAL_HEADER_BYTES + WAL_CHECKSUM_BYTES) {
      return { frames, recoveryRequired: true, validBytes: offset };
    }
    const header = bytes.slice(offset, offset + WAL_HEADER_BYTES);
    if (!Buffer.from(header.slice(0, 4)).equals(Buffer.from(WAL_MAGIC))) {
      return { frames, recoveryRequired: true, validBytes: offset };
    }
    const version = readUintLE(header.slice(4, 6));
    const flags = Number(readUintLE(header.slice(6, 8)));
    const sequence = readUintLE(header.slice(8, 16));
    const payloadLength = Number(readUintLE(header.slice(16, 20)));
    if (version !== BigInt(WAL_VERSION) || sequence !== expectedSequence) {
      return { frames, recoveryRequired: true, validBytes: offset };
    }
    const frameLength = WAL_HEADER_BYTES + payloadLength + WAL_CHECKSUM_BYTES;
    if (bytes.length - offset < frameLength) {
      return { frames, recoveryRequired: true, validBytes: offset };
    }
    const payload = bytes.slice(offset + WAL_HEADER_BYTES, offset + WAL_HEADER_BYTES + payloadLength);
    const payloadHash = header.slice(20, 52);
    const checksum = bytes.slice(offset + frameLength - WAL_CHECKSUM_BYTES, offset + frameLength);
    if (
      !Buffer.from(payloadHash).equals(Buffer.from(hexToBytes(sha256(payload), 32))) ||
      !Buffer.from(checksum).equals(Buffer.from(hexToBytes(sha256(concatBytes(header, payload)), 32)))
    ) {
      return { frames, recoveryRequired: true, validBytes: offset };
    }
    frames.push({ sequence, flags, payload });
    expectedSequence += 1n;
    offset += frameLength;
  }
  return { frames, recoveryRequired: false, validBytes: offset };
}

function readUintLE(bytes: Uint8Array): bigint {
  let value = 0n;
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[index]!);
  }
  return value;
}

export class AppendOnlyWal {
  constructor(readonly path: string) {}

  read(): DecodedWal {
    try {
      return decodeWal(readFileSync(this.path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { frames: [], recoveryRequired: false, validBytes: 0 };
      }
      throw error;
    }
  }

  append(payload: Uint8Array, flags = 0): WalFrame {
    const decoded = this.read();
    if (decoded.recoveryRequired) throw new DleProtocolError(DleError.WalRecoveryRequired);
    const frame: WalFrame = {
      sequence: BigInt(decoded.frames.length + 1),
      flags,
      payload
    };
    const descriptor = openSync(this.path, "a", 0o600);
    try {
      writeSync(descriptor, encodeWalFrame(frame));
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    return frame;
  }

  appendSafetyRecord(record: WalSafetyRecord): WalFrame | null {
    const decoded = this.read();
    if (decoded.recoveryRequired) throw new DleProtocolError(DleError.WalRecoveryRequired);
    const payload = encodeWalSafetyRecord(record);
    for (const frame of decoded.frames) {
      const prior = decodeWalSafetyRecord(frame.payload);
      if (
        prior.domain === record.domain &&
        prior.height === record.height &&
        prior.round === record.round &&
        prior.step === record.step
      ) {
        if (Buffer.from(frame.payload).equals(Buffer.from(payload))) return null;
        throw new DleProtocolError(DleError.WalDoubleSign);
      }
    }
    return this.append(payload, record.recordKind);
  }
}

const GF_PRIMITIVE = 0x11d;
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let value = 1;
  for (let index = 0; index < 255; index += 1) {
    GF_EXP[index] = value;
    GF_LOG[value] = index;
    value <<= 1;
    if ((value & 0x100) !== 0) value ^= GF_PRIMITIVE;
  }
  for (let index = 255; index < 512; index += 1) GF_EXP[index] = GF_EXP[index - 255]!;
}

function gfMul(left: number, right: number): number {
  if (left === 0 || right === 0) return 0;
  return GF_EXP[GF_LOG[left]! + GF_LOG[right]!]!;
}

function gfInv(value: number): number {
  if (value === 0) throw new DleProtocolError(DleError.InvalidRsCodeword, "Zero has no inverse");
  return GF_EXP[255 - GF_LOG[value]!]!;
}

function gfPow(base: number, power: number): number {
  if (power === 0) return 1;
  if (base === 0) return 0;
  return GF_EXP[(GF_LOG[base]! * power) % 255]!;
}

function invertMatrix(input: readonly (readonly number[])[]): number[][] {
  const size = input.length;
  const augmented = input.map((row, rowIndex) => [
    ...row,
    ...Array.from({ length: size }, (_, column) => (rowIndex === column ? 1 : 0))
  ]);
  for (let column = 0; column < size; column += 1) {
    const pivot = augmented.findIndex((row, rowIndex) => rowIndex >= column && row[column] !== 0);
    if (pivot < 0) throw new DleProtocolError(DleError.InvalidRsCodeword, "Singular matrix");
    [augmented[column], augmented[pivot]] = [augmented[pivot]!, augmented[column]!];
    const inverse = gfInv(augmented[column]![column]!);
    for (let index = 0; index < size * 2; index += 1) {
      augmented[column]![index] = gfMul(augmented[column]![index]!, inverse);
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row]![column]!;
      for (let index = 0; index < size * 2; index += 1) {
        augmented[row]![index] =
          augmented[row]![index]! ^ gfMul(factor, augmented[column]![index]!);
      }
    }
  }
  return augmented.map((row) => row.slice(size));
}

function multiplyMatrices(
  left: readonly (readonly number[])[],
  right: readonly (readonly number[])[]
): number[][] {
  return left.map((row) =>
    Array.from({ length: right[0]!.length }, (_, column) =>
      row.reduce((value, cell, index) => value ^ gfMul(cell, right[index]![column]!), 0)
    )
  );
}

const VANDERMONDE_7X4 = Array.from({ length: 7 }, (_, row) =>
  Array.from({ length: 4 }, (_, column) => gfPow(row + 1, column))
);
export const RS_GENERATOR_MATRIX: readonly (readonly number[])[] = multiplyMatrices(
  VANDERMONDE_7X4,
  invertMatrix(VANDERMONDE_7X4.slice(0, 4))
);

export interface RsCodeword {
  bodyLength: number;
  shardSize: number;
  shards: readonly Uint8Array[];
  bodyCommitment: Hex;
  daRoot: Hex;
}

function multiplyShardRows(
  rows: readonly (readonly number[])[],
  shards: readonly Uint8Array[]
): Uint8Array[] {
  const shardSize = shards[0]?.length ?? 0;
  return rows.map((row) => {
    const output = new Uint8Array(shardSize);
    for (let byte = 0; byte < shardSize; byte += 1) {
      output[byte] = row.reduce(
        (value, coefficient, shardIndex) =>
          value ^ gfMul(coefficient, shards[shardIndex]![byte]!),
        0
      );
    }
    return output;
  });
}

export function encodeRs74(body: Uint8Array): RsCodeword {
  const framed = concatBytes(uintLE(body.length, 8), body);
  const shardSize = Math.ceil(framed.length / 4);
  const padded = new Uint8Array(shardSize * 4);
  padded.set(framed);
  const dataShards = Array.from({ length: 4 }, (_, index) =>
    padded.slice(index * shardSize, (index + 1) * shardSize)
  );
  const shards = multiplyShardRows(RS_GENERATOR_MATRIX, dataShards);
  return {
    bodyLength: body.length,
    shardSize,
    shards,
    bodyCommitment: sha256(concatBytes(utf8("dle.body.v1"), uintLE(body.length, 8), body)),
    daRoot: computeDaRoot(shards, body.length)
  };
}

export function reconstructRs74(
  available: readonly { index: number; bytes: Uint8Array }[]
): Uint8Array {
  if (available.length < 4) throw new DleProtocolError(DleError.InsufficientShards);
  const selected = [...available]
    .sort((left, right) => left.index - right.index)
    .slice(0, 4);
  if (
    new Set(selected.map((item) => item.index)).size !== 4 ||
    selected.some((item) => item.index < 0 || item.index >= 7)
  ) {
    throw new DleProtocolError(DleError.InvalidRsCodeword);
  }
  const shardSize = selected[0]!.bytes.length;
  if (selected.some((item) => item.bytes.length !== shardSize)) {
    throw new DleProtocolError(DleError.InvalidRsCodeword);
  }
  const decodeMatrix = invertMatrix(selected.map((item) => RS_GENERATOR_MATRIX[item.index]!));
  const dataShards = multiplyShardRows(
    decodeMatrix,
    selected.map((item) => item.bytes)
  );
  const framed = concatBytes(...dataShards);
  const bodyLength = Number(readUintLE(framed.slice(0, 8)));
  if (!Number.isSafeInteger(bodyLength) || bodyLength < 0 || bodyLength > framed.length - 8) {
    throw new DleProtocolError(DleError.InvalidRsCodeword);
  }
  return framed.slice(8, 8 + bodyLength);
}

export function verifyRs74(body: Uint8Array, shards: readonly Uint8Array[]): void {
  const expected = encodeRs74(body);
  if (
    shards.length !== 7 ||
    shards.some((shard, index) => !Buffer.from(shard).equals(Buffer.from(expected.shards[index]!)))
  ) {
    throw new DleProtocolError(DleError.InvalidRsCodeword);
  }
}

export function computeDaRoot(shards: readonly Uint8Array[], bodyLength: number): Hex {
  if (shards.length !== 7) throw new DleProtocolError(DleError.InvalidRsCodeword);
  const leaves = shards.map((shard, index) =>
    hexToBytes(
      sha256(concatBytes(Uint8Array.of(0), uintLE(index, 4), uintLE(bodyLength, 8), shard)),
      32
    )
  );
  leaves.push(hexToBytes(sha256(Uint8Array.of(2)), 32));
  let layer = leaves;
  while (layer.length > 1) {
    const next: Uint8Array[] = [];
    for (let index = 0; index < layer.length; index += 2) {
      next.push(
        hexToBytes(sha256(concatBytes(Uint8Array.of(1), layer[index]!, layer[index + 1]!)), 32)
      );
    }
    layer = next;
  }
  return bytesToHex(layer[0]!);
}

export type ConsensusStep = "PROPOSE" | "PREVOTE" | "PRECOMMIT" | "COMMITTED";
export type ConsensusMode = "VOTING" | "RECOVERY" | "FROZEN";

export interface TendermintState {
  height: number;
  round: number;
  step: ConsensusStep;
  mode: ConsensusMode;
  lockedValue: Hex;
  lockedRound: number;
  validValue: Hex;
  validRound: number;
  validPrevoteQCRef: Hex;
  committedAcRef: Hex;
  rejectRef: Hex;
}

export type TendermintInput =
  | {
      type: "PROPOSAL";
      value: Hex;
      available: boolean;
      validRound: number;
      validPrevoteQCRef: Hex;
    }
  | { type: "PREVOTE_QC"; value: Hex; qcRef: Hex }
  | { type: "PREVOTE_TIMEOUT" }
  | { type: "PRECOMMIT_QC"; value: Hex; acRef: Hex }
  | { type: "PRECOMMIT_TIMEOUT"; tcRef: Hex }
  | { type: "REJECT_CERT"; rejectRef: Hex; afterFinality: boolean };

export interface TendermintOutput {
  action: "PREVOTE" | "PRECOMMIT" | "ENTER_ROUND" | "COMMIT" | "FREEZE";
  value: Hex;
  reference: Hex;
}

export interface TendermintTransition {
  state: TendermintState;
  outputs: readonly TendermintOutput[];
  error?: DleError;
}

export function initialTendermintState(height = 1, round = 0): TendermintState {
  return {
    height,
    round,
    step: "PROPOSE",
    mode: "VOTING",
    lockedValue: ZERO32,
    lockedRound: NONE_ROUND,
    validValue: ZERO32,
    validRound: NONE_ROUND,
    validPrevoteQCRef: ZERO32,
    committedAcRef: ZERO32,
    rejectRef: ZERO32
  };
}

export function applyTendermintInput(
  previous: TendermintState,
  input: TendermintInput
): TendermintTransition {
  const state = { ...previous };
  if (state.mode !== "VOTING") {
    return { state, outputs: [], error: DleError.WalRecoveryRequired };
  }
  switch (input.type) {
    case "PROPOSAL": {
      if (state.step !== "PROPOSE") {
        return { state, outputs: [], error: DleError.LockConflict };
      }
      let vote = ZERO32;
      if (input.available && input.value !== ZERO32) {
        const unlocked = state.lockedRound === NONE_ROUND;
        const sameLock = state.lockedValue === input.value;
        const higherJustification =
          input.validRound !== NONE_ROUND &&
          state.lockedRound !== NONE_ROUND &&
          input.validRound > state.lockedRound &&
          input.validPrevoteQCRef !== ZERO32;
        if (unlocked || sameLock || higherJustification) vote = input.value;
      }
      state.step = "PREVOTE";
      return {
        state,
        outputs: [{ action: "PREVOTE", value: vote, reference: ZERO32 }]
      };
    }
    case "PREVOTE_QC": {
      if (state.step !== "PREVOTE") {
        return { state, outputs: [], error: DleError.InvalidCertificateKind };
      }
      state.step = "PRECOMMIT";
      if (input.value === ZERO32) {
        return {
          state,
          outputs: [{ action: "PRECOMMIT", value: ZERO32, reference: ZERO32 }]
        };
      }
      if (input.qcRef === ZERO32) {
        return { state, outputs: [], error: DleError.InvalidCertificateReference };
      }
      state.validValue = input.value;
      state.validRound = state.round;
      state.validPrevoteQCRef = input.qcRef;
      state.lockedValue = input.value;
      state.lockedRound = state.round;
      return {
        state,
        outputs: [{ action: "PRECOMMIT", value: input.value, reference: input.qcRef }]
      };
    }
    case "PREVOTE_TIMEOUT": {
      if (state.step !== "PREVOTE") {
        return { state, outputs: [], error: DleError.InvalidCertificateKind };
      }
      state.step = "PRECOMMIT";
      return {
        state,
        outputs: [{ action: "PRECOMMIT", value: ZERO32, reference: ZERO32 }]
      };
    }
    case "PRECOMMIT_QC": {
      if (state.step !== "PRECOMMIT") {
        return { state, outputs: [], error: DleError.InvalidCertificateKind };
      }
      if (input.value === ZERO32) return enterNextRound(state);
      if (input.acRef === ZERO32) {
        return { state, outputs: [], error: DleError.InvalidCertificateReference };
      }
      state.step = "COMMITTED";
      state.committedAcRef = input.acRef;
      return {
        state,
        outputs: [{ action: "COMMIT", value: input.value, reference: input.acRef }]
      };
    }
    case "PRECOMMIT_TIMEOUT":
      return enterNextRound(state, input.tcRef);
    case "REJECT_CERT": {
      state.rejectRef = input.rejectRef;
      state.mode = "FROZEN";
      return {
        state,
        outputs: [{ action: "FREEZE", value: ZERO32, reference: input.rejectRef }],
        error: input.afterFinality ? DleError.RejectAfterFinality : DleError.RejectAcceptConflict
      };
    }
  }
}

function enterNextRound(state: TendermintState, reference = ZERO32): TendermintTransition {
  state.round += 1;
  state.step = "PROPOSE";
  return {
    state,
    outputs: [{ action: "ENTER_ROUND", value: ZERO32, reference }]
  };
}

export function tendermintStateRoot(state: TendermintState): Hex {
  const step = { PROPOSE: 0, PREVOTE: 1, PRECOMMIT: 2, COMMITTED: 3 }[state.step];
  const mode = { VOTING: 0, RECOVERY: 1, FROZEN: 2 }[state.mode];
  return sha256(
    concatBytes(
      utf8("dle.archive.state.v2"),
      uintLE(state.height, 8),
      uintLE(state.round, 4),
      uintLE(step, 1),
      uintLE(mode, 1),
      hexToBytes(state.lockedValue, 32),
      uintLE(state.lockedRound, 4),
      hexToBytes(state.validValue, 32),
      uintLE(state.validRound, 4),
      hexToBytes(state.validPrevoteQCRef, 32),
      hexToBytes(state.committedAcRef, 32),
      hexToBytes(state.rejectRef, 32)
    )
  );
}

export type LifecyclePhase =
  | "ACTIVE"
  | "EXIT_REQUESTED"
  | "DRAINING"
  | "STANDBY_SYNCING"
  | "HANDOVER_READY"
  | "MEMBERSHIP_SWITCHED";

export interface ArchiveLifecycleState {
  phase: LifecyclePhase;
  membershipEpoch: number;
  keyEpoch: number;
  active: readonly Hex[];
  standby: readonly Hex[];
  exiting: Hex;
  promoted: Hex;
}

export type LifecycleInput =
  | { type: "REQUEST_EXIT"; member: Hex }
  | { type: "BEGIN_DRAIN" }
  | { type: "BEGIN_STANDBY_SYNC" }
  | { type: "MARK_HANDOVER_READY" }
  | { type: "ACTIVATE_SWITCH" };

export function applyLifecycleInput(
  previous: ArchiveLifecycleState,
  input: LifecycleInput
): ArchiveLifecycleState {
  const state: ArchiveLifecycleState = {
    ...previous,
    active: [...previous.active],
    standby: [...previous.standby]
  };
  if (state.active.length !== 5 || state.standby.length !== 2) {
    throw new DleProtocolError(DleError.LifecycleTransition, "Lifecycle requires 5+2");
  }
  switch (input.type) {
    case "REQUEST_EXIT":
      if (state.phase !== "ACTIVE" || !state.active.includes(input.member)) {
        throw new DleProtocolError(DleError.LifecycleTransition);
      }
      return { ...state, phase: "EXIT_REQUESTED", exiting: input.member };
    case "BEGIN_DRAIN":
      if (state.phase !== "EXIT_REQUESTED") throw new DleProtocolError(DleError.LifecycleTransition);
      return { ...state, phase: "DRAINING" };
    case "BEGIN_STANDBY_SYNC":
      if (state.phase !== "DRAINING") throw new DleProtocolError(DleError.LifecycleTransition);
      return { ...state, phase: "STANDBY_SYNCING", promoted: state.standby[0]! };
    case "MARK_HANDOVER_READY":
      if (state.phase !== "STANDBY_SYNCING") throw new DleProtocolError(DleError.LifecycleTransition);
      return { ...state, phase: "HANDOVER_READY" };
    case "ACTIVATE_SWITCH": {
      if (state.phase !== "HANDOVER_READY") throw new DleProtocolError(DleError.LifecycleTransition);
      const replacementIndex = state.active.indexOf(state.exiting);
      if (replacementIndex < 0) throw new DleProtocolError(DleError.LifecycleTransition);
      const active = [...state.active];
      active[replacementIndex] = state.promoted;
      if (new Set(active).size !== 5) throw new DleProtocolError(DleError.LifecycleTransition);
      return {
        ...state,
        phase: "MEMBERSHIP_SWITCHED",
        membershipEpoch: state.membershipEpoch + 1,
        keyEpoch: state.keyEpoch + 1,
        active,
        standby: [state.standby[1]!],
        promoted: state.promoted
      };
    }
  }
}

export function lifecycleStateRoot(state: ArchiveLifecycleState): Hex {
  const phase = [
    "ACTIVE",
    "EXIT_REQUESTED",
    "DRAINING",
    "STANDBY_SYNCING",
    "HANDOVER_READY",
    "MEMBERSHIP_SWITCHED"
  ].indexOf(state.phase);
  return sha256(
    concatBytes(
      utf8("dle.archive.lifecycle.v1"),
      uintLE(phase, 1),
      uintLE(state.membershipEpoch, 8),
      uintLE(state.keyEpoch, 8),
      ...state.active.map((item) => hexToBytes(item, 32)),
      uintLE(state.standby.length, 1),
      ...state.standby.map((item) => hexToBytes(item, 32)),
      ...Array.from({ length: 2 - state.standby.length }, () => new Uint8Array(32)),
      hexToBytes(state.exiting, 32),
      hexToBytes(state.promoted, 32)
    )
  );
}

export function combinationsOfFourFromSeven(): readonly (readonly number[])[] {
  const output: number[][] = [];
  for (let a = 0; a < 4; a += 1) {
    for (let b = a + 1; b < 5; b += 1) {
      for (let c = b + 1; c < 6; c += 1) {
        for (let d = c + 1; d < 7; d += 1) output.push([a, b, c, d]);
      }
    }
  }
  return output;
}
