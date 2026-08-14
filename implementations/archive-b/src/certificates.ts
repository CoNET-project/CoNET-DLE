import { concat, getBytes, sha256, toUtf8Bytes } from 'ethers';
import {
  ContainerFieldKind,
  declaredContainerRoot,
  encodeDeclaredContainer,
  signingRoot,
} from './ssz.js';
import { Hex } from './types.js';

export type CertificateName =
  | 'PrevoteQCV2'
  | 'ArchiveCertificateV2'
  | 'TimeoutCertificateV2'
  | 'CandidateRejectCertificateV2';

type CertificateDefinition = {
  readonly kind: number;
  readonly domain: string;
  readonly fields: ReadonlyArray<readonly [string, ContainerFieldKind]>;
};

const COMMON: ReadonlyArray<readonly [string, ContainerFieldKind]> = [
  ['protocolVersion', 'bytes32'],
  ['kind', 'uint8'],
  ['l1ChainId', 'uint64'],
  ['archiveGroupId', 'uint64'],
  ['chainNftId', 'uint256'],
  ['tipHeight', 'uint64'],
  ['round', 'uint32'],
];

const SIGNERS: ReadonlyArray<readonly [string, ContainerFieldKind]> = [
  ['signerBitmap', 'uint8'],
  ['signerIds', 'bytes32x5'],
  ['signatures', 'bytes65x5'],
];

export const CERTIFICATES: Readonly<Record<CertificateName, CertificateDefinition>> = {
  PrevoteQCV2: {
    kind: 1,
    domain: 'dle.archive.prevote-qc.v2',
    fields: [
      ...COMMON,
      ['valueHashOrZero', 'bytes32'],
      ['attemptNonce', 'uint64'],
      ['membershipEpoch', 'uint64'],
      ['membershipRoot', 'bytes32'],
      ['keyEpoch', 'uint64'],
      ['voteRoot', 'bytes32'],
      ...SIGNERS,
    ],
  },
  ArchiveCertificateV2: {
    kind: 2,
    domain: 'dle.archive.ac.v2',
    fields: [
      ...COMMON,
      ['valueHash', 'bytes32'],
      ['attemptNonce', 'uint64'],
      ['membershipEpoch', 'uint64'],
      ['membershipRoot', 'bytes32'],
      ['keyEpoch', 'uint64'],
      ['prevoteQCRef', 'bytes32'],
      ['voteRoot', 'bytes32'],
      ...SIGNERS,
    ],
  },
  TimeoutCertificateV2: {
    kind: 3,
    domain: 'dle.archive.tc.v2',
    fields: [
      ...COMMON,
      ['timeoutStep', 'uint8'],
      ['attemptNonce', 'uint64'],
      ['membershipEpoch', 'uint64'],
      ['membershipRoot', 'bytes32'],
      ['keyEpoch', 'uint64'],
      ['highestPrevoteQCRefOrZero', 'bytes32'],
      ['highestTimeoutQCRefOrZero', 'bytes32'],
      ['timeoutVoteRoot', 'bytes32'],
      ...SIGNERS,
    ],
  },
  CandidateRejectCertificateV2: {
    kind: 4,
    domain: 'dle.archive.reject.v2',
    fields: [
      ...COMMON,
      ['candidateId', 'bytes32'],
      ['attemptNonce', 'uint64'],
      ['membershipEpoch', 'uint64'],
      ['membershipRoot', 'bytes32'],
      ['keyEpoch', 'uint64'],
      ['reasonCode', 'uint16'],
      ['evidenceHash', 'bytes32'],
      ['rejectVoteRoot', 'bytes32'],
      ...SIGNERS,
    ],
  },
};

function uintLe(value: number | bigint, width: number): Uint8Array {
  const out = new Uint8Array(width);
  let rest = BigInt(value);
  for (let index = 0; index < width; index += 1) {
    out[index] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  if (rest !== 0n) throw new Error('ERR_INTEGER_OVERFLOW');
  return out;
}

export function validateCertificate(name: CertificateName, value: Record<string, unknown>): void {
  const definition = CERTIFICATES[name];
  if (Number(value.kind) !== definition.kind) throw new Error('ERR_CERT_KIND');
  if (!Array.isArray(value.signerIds) || value.signerIds.length !== 5) {
    throw new Error('ERR_CERT_SIGNERS');
  }
  if (!Array.isArray(value.signatures) || value.signatures.length !== 5) {
    throw new Error('ERR_CERT_SIGNATURES');
  }
  const signerIds = value.signerIds as unknown[];
  if (
    signerIds.some((item) => typeof item !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(item)) ||
    new Set(signerIds.map((item) => String(item).toLowerCase())).size !== 5
  ) {
    throw new Error('ERR_CERT_SIGNERS');
  }
  const signerBitmap = Number(value.signerBitmap);
  if (!Number.isInteger(signerBitmap) || signerBitmap < 0 || signerBitmap > 0x1f) {
    throw new Error('ERR_CERT_BITMAP');
  }
  const bits = [0, 1, 2, 3, 4].reduce((sum, bit) => sum + ((signerBitmap >> bit) & 1), 0);
  if (bits < 4 || bits > 5) {
    throw new Error('ERR_CERT_THRESHOLD');
  }
  const zeroSignature = `0x${'00'.repeat(65)}`;
  for (let index = 0; index < 5; index += 1) {
    const signature = value.signatures[index];
    if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
      throw new Error('ERR_CERT_SIGNATURES');
    }
    const signed = ((signerBitmap >> index) & 1) === 1;
    if (signed === (signature.toLowerCase() === zeroSignature)) {
      throw new Error('ERR_CERT_BITMAP');
    }
  }
  if (name === 'CandidateRejectCertificateV2' && value.evidenceHash === `0x${'00'.repeat(32)}`) {
    throw new Error('ERR_REJECT_EVIDENCE');
  }
}

export function encodeCertificate(name: CertificateName, value: Record<string, unknown>): Hex {
  validateCertificate(name, value);
  return encodeDeclaredContainer(value, CERTIFICATES[name].fields);
}

export function certificateRoot(name: CertificateName, value: Record<string, unknown>): Hex {
  validateCertificate(name, value);
  return declaredContainerRoot(value, CERTIFICATES[name].fields);
}

export function certificateSigningRoot(name: CertificateName, value: Record<string, unknown>): Hex {
  return signingRoot(CERTIFICATES[name].domain, certificateRoot(name, value));
}

export function certificateReference(name: CertificateName, value: Record<string, unknown>): Hex {
  const root = certificateRoot(name, value);
  return sha256(
    concat([
      toUtf8Bytes('dle.archive.certref.v2'),
      uintLe(CERTIFICATES[name].kind, 1),
      getBytes(root),
    ]),
  ) as Hex;
}

export function selectCoordinator(
  archiveGroupId: bigint,
  chainNftId: bigint,
  tipHeight: bigint,
  attemptNonce: bigint,
  membershipRoot: Hex,
  round: number,
  activeRoster: readonly Hex[],
): Hex {
  return selectCoordinatorDetails(
    archiveGroupId,
    chainNftId,
    tipHeight,
    attemptNonce,
    membershipRoot,
    round,
    activeRoster,
  ).coordinator;
}

export function selectCoordinatorDetails(
  archiveGroupId: bigint,
  chainNftId: bigint,
  tipHeight: bigint,
  attemptNonce: bigint,
  membershipRoot: Hex,
  round: number,
  activeRoster: readonly Hex[],
): {
  canonicalRoster: readonly Hex[];
  digest: Hex;
  sample: bigint;
  index: number;
  coordinator: Hex;
  counter: number;
} {
  if (activeRoster.length !== 5 || new Set(activeRoster.map((item) => item.toLowerCase())).size !== 5) {
    throw new Error('ERR_MEMBERSHIP_5_ACTIVE');
  }
  const roster = [...activeRoster].sort((left, right) =>
    Buffer.compare(Buffer.from(getBytes(left)), Buffer.from(getBytes(right))),
  );
  const base = concat([
    toUtf8Bytes('dle.archive.coordinator.v1'),
    uintLe(archiveGroupId, 8),
    uintLe(chainNftId, 32),
    uintLe(tipHeight, 8),
    uintLe(attemptNonce, 8),
    getBytes(membershipRoot),
    uintLe(round, 4),
  ]);
  const limit = ((1n << 64n) / 5n) * 5n;
  for (let counter = 0; counter <= 0xffff_ffff; counter += 1) {
    const digest = getBytes(sha256(concat([base, uintLe(counter, 4)])));
    let sample = 0n;
    for (let index = 7; index >= 0; index -= 1) {
      sample = (sample << 8n) | BigInt(digest[index] ?? 0);
    }
    if (sample < limit) {
      const index = Number(sample % 5n);
      return {
        canonicalRoster: roster,
        digest: (`0x${Buffer.from(digest).toString('hex')}`) as Hex,
        sample,
        index,
        coordinator: roster[index]!,
        counter,
      };
    }
  }
  throw new Error('ERR_INVALID_COORDINATOR');
}

