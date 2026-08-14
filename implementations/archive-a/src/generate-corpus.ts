import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  ACTIVE_ARCHIVES,
  AppendOnlyWal,
  ArchiveCertificate,
  ArchiveLifecycleState,
  CandidateRejectCertificate,
  Certificate,
  CertificateKind,
  CONTAINERS,
  DleError,
  Hex,
  NONE_ROUND,
  PROTOCOL_VERSION,
  PrevoteQC,
  RejectReason,
  RS_GENERATOR_MATRIX,
  TimeoutCertificate,
  TimeoutStep,
  VoteStep,
  ZERO32,
  ZERO65,
  applyLifecycleInput,
  applyTendermintInput,
  bytesToHex,
  certificateContainer,
  certificateRef,
  combinationsOfFourFromSeven,
  computeDaRoot,
  encodeRs74,
  encodeWalFrame,
  encodeWalSafetyRecord,
  hashTreeRoot,
  initialTendermintState,
  lifecycleStateRoot,
  selectCoordinator,
  serializeContainer,
  sha256,
  signingRoot,
  tendermintStateRoot,
  utf8
} from "./core.js";

const ROOT = resolve(import.meta.dirname, "../../..");
const V1_PATH = resolve(ROOT, "src/whitepaper/DLE-Archive-Tendermint-Vectors-v1.json");
const SCHEMA_PATH = resolve(ROOT, "conformance/schema/dle-archive-tendermint-corpus-v2.schema.json");
const CORPUS_PATH = resolve(ROOT, "conformance/corpus/DLE-Archive-Tendermint-Vectors-v2.json");
const MANIFEST_PATH = resolve(ROOT, "conformance/DLE-Archive-Tendermint-Corpus-v2.sha256");

const repeatHex = (byte: number, length: number): Hex =>
  `0x${byte.toString(16).padStart(2, "0").repeat(length)}` as Hex;

const signerIds = Array.from({ length: ACTIVE_ARCHIVES }, (_, index) =>
  sha256(utf8(`archive-${index}`))
).sort((left, right) => left.localeCompare(right));
const signatures = [
  repeatHex(0x11, 65),
  repeatHex(0x22, 65),
  repeatHex(0x33, 65),
  repeatHex(0x44, 65),
  ZERO65
];
const valueA = sha256(utf8("candidate-A"));
const valueB = sha256(utf8("candidate-B"));
const membershipRoot = sha256(utf8("membership-root-v2"));

const common = {
  protocolVersion: PROTOCOL_VERSION,
  l1ChainId: 224422n,
  archiveGroupId: 7n,
  chainNftId: 42n,
  tipHeight: 9n,
  round: 2,
  attemptNonce: 3n,
  membershipEpoch: 11n,
  membershipRoot,
  keyEpoch: 5n,
  signerBitmap: 0x0f,
  signerIds,
  signatures
};

const prevoteQc: PrevoteQC = {
  ...common,
  kind: CertificateKind.PrevoteQC,
  valueHashOrZero: valueA,
  voteRoot: sha256(utf8("aggregate-prevote-vote-roots"))
};
const ac: ArchiveCertificate = {
  ...common,
  kind: CertificateKind.ArchiveCertificate,
  valueHash: valueA,
  prevoteQCRef: certificateRef(prevoteQc),
  voteRoot: sha256(utf8("aggregate-precommit-vote-roots"))
};
const tc: TimeoutCertificate = {
  ...common,
  kind: CertificateKind.TimeoutCertificate,
  timeoutStep: TimeoutStep.Precommit,
  highestPrevoteQCRefOrZero: certificateRef(prevoteQc),
  highestTimeoutQCRefOrZero: ZERO32,
  timeoutVoteRoot: sha256(utf8("aggregate-timeout-vote-roots"))
};
const reject: CandidateRejectCertificate = {
  ...common,
  kind: CertificateKind.CandidateRejectCertificate,
  candidateId: valueA,
  reasonCode: RejectReason.InvalidRsCodeword,
  evidenceHash: sha256(utf8("bad-encoding-evidence")),
  rejectVoteRoot: sha256(utf8("aggregate-reject-vote-roots"))
};

function certificateVector(id: string, certificate: Certificate): object {
  const container = certificateContainer(certificate);
  const record = certificate as unknown as Record<string, unknown>;
  return {
    id,
    container,
    input: certificate,
    canonicalSsz: bytesToHex(serializeContainer(container, record)),
    hashTreeRoot: hashTreeRoot(container, record),
    signingRoot: signingRoot(container, record),
    certificateRef: certificateRef(certificate)
  };
}

function replay(
  initial: ReturnType<typeof initialTendermintState>,
  inputs: Parameters<typeof applyTendermintInput>[1][]
): object {
  let state = initial;
  const outputs: object[] = [];
  const errors: string[] = [];
  for (const input of inputs) {
    const transition = applyTendermintInput(state, input);
    state = transition.state;
    outputs.push(...transition.outputs);
    if (transition.error !== undefined) errors.push(transition.error);
  }
  return { state, outputs, errors, stateRoot: tendermintStateRoot(state) };
}

function lifecycleReplay(
  initial: ArchiveLifecycleState,
  inputs: readonly Parameters<typeof applyLifecycleInput>[1][]
): object {
  let state = initial;
  for (const input of inputs) state = applyLifecycleInput(state, input);
  return { state, stateRoot: lifecycleStateRoot(state) };
}

function toJsonValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return bytesToHex(value);
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, toJsonValue(item)])
    );
  }
  return value;
}

function buildCorpus(): object {
  const v1 = JSON.parse(readFileSync(V1_PATH, "utf8")) as {
    sszVectors: readonly object[];
  };
  const roster = [signerIds[3]!, signerIds[0]!, signerIds[4]!, signerIds[1]!, signerIds[2]!];
  const coordinatorInput = {
    archiveGroupId: 7n,
    chainNftId: 42n,
    tipHeight: 9n,
    attemptNonce: 3n,
    membershipRoot,
    round: 2
  };
  const walVote = {
    protocolVersion: PROTOCOL_VERSION,
    l1ChainId: 224422n,
    archiveGroupId: 7n,
    chainNftId: 42n,
    tipHeight: 9n,
    round: 2,
    step: VoteStep.Prevote,
    valueHashOrZero: valueA,
    attemptNonce: 3n,
    membershipEpoch: 11n,
    membershipRoot,
    keyEpoch: 5n,
    prevoteQCRefOrZero: ZERO32
  };
  const walVoteSignBytes = serializeContainer("VoteSignBytesV1", walVote);
  const walPayload = encodeWalSafetyRecord({
    recordKind: 1,
    domain: 1,
    height: 9n,
    round: 2,
    step: VoteStep.Prevote,
    canonicalSignBytes: walVoteSignBytes,
    signingRoot: signingRoot("VoteSignBytesV1", walVote),
    signature: repeatHex(0x11, 65),
    proposalHash: valueA,
    lockedValue: ZERO32,
    lockedRound: NONE_ROUND,
    validValue: ZERO32,
    validRound: NONE_ROUND,
    qcRef: ZERO32,
    tcRef: ZERO32,
    membershipEpoch: 11n,
    membershipRoot,
    keyEpoch: 5n,
    committedHeight: 8n
  });
  const walFrame = encodeWalFrame({ sequence: 1n, flags: 1, payload: walPayload });
  const corruptWalFrame = walFrame.slice();
  const corruptIndex = corruptWalFrame.length - 1;
  corruptWalFrame[corruptIndex] = corruptWalFrame[corruptIndex]! ^ 0x01;

  const rsBodies = [
    { id: "RS-EMPTY", body: new Uint8Array() },
    { id: "RS-ONE-BYTE", body: Uint8Array.of(0xab) },
    { id: "RS-DLE-CANONICAL", body: utf8("CoNET-DLE deterministic RS(7,4) corpus v2") }
  ];
  const rsVectors = rsBodies.map(({ id, body }) => {
    const encoded = encodeRs74(body);
    return {
      id,
      body: bytesToHex(body),
      bodyLength: encoded.bodyLength,
      shardSize: encoded.shardSize,
      shards: encoded.shards.map(bytesToHex),
      bodyCommitment: encoded.bodyCommitment,
      daRoot: encoded.daRoot
    };
  });

  const unlocked = initialTendermintState(9, 2);
  const lockedA = {
    ...initialTendermintState(9, 2),
    lockedValue: valueA,
    lockedRound: 1,
    validValue: valueA,
    validRound: 1,
    validPrevoteQCRef: sha256(utf8("round-1-prevote-qc"))
  };
  const initialLifecycle: ArchiveLifecycleState = {
    phase: "ACTIVE",
    membershipEpoch: 11,
    keyEpoch: 5,
    active: signerIds,
    standby: [sha256(utf8("standby-0")), sha256(utf8("standby-1"))],
    exiting: ZERO32,
    promoted: ZERO32
  };
  const lifecycleInputs = [
    { type: "REQUEST_EXIT", member: signerIds[2]! },
    { type: "BEGIN_DRAIN" },
    { type: "BEGIN_STANDBY_SYNC" },
    { type: "MARK_HANDOVER_READY" },
    { type: "ACTIVATE_SWITCH" }
  ] as const;

  return toJsonValue({
    schema: "dle.archive.tendermint.corpus.v2",
    revision: "2026-08-13",
    supersedesProseStateVectorsFrom: "DLE-Archive-Tendermint-Vectors-v1.json",
    compatibility: {
      v1Preserved: true,
      legacyProposalVoteVectors: v1.sszVectors
    },
    constants: {
      protocolVersion: PROTOCOL_VERSION,
      activeArchives: 5,
      readyStandbys: 2,
      quorum: 4,
      noneRound: NONE_ROUND,
      nilValue: ZERO32,
      signatureBytes: 65,
      certificateSignerSlots: 5,
      wal: {
        magicAscii: "DLEW",
        version: 1,
        headerBytes: 52,
        checksumBytes: 32,
        checksum: "SHA-256",
        safetyRecord:
          "uint16le(version) || uint8(kind) || uint8(domain) || uint64le(height) || uint32le(round) || uint8(step) || uint32le(signBytesLength) || signBytes || signingRoot[32] || signature[65] || proposalHash[32] || lockedValue[32] || uint32le(lockedRound) || validValue[32] || uint32le(validRound) || qcRef[32] || tcRef[32] || uint64le(membershipEpoch) || membershipRoot[32] || uint64le(keyEpoch) || uint64le(committedHeight)"
      },
      rs: {
        name: "dle.rs.v1",
        n: 7,
        k: 4,
        field: "GF(2^8)",
        primitivePolynomial: "0x11d",
        generatorMatrix: RS_GENERATOR_MATRIX,
        frame: "uint64le(bodyLength) || body || zero-padding",
        leafHash: "SHA-256(0x00 || uint32le(index) || uint64le(bodyLength) || shard)",
        padLeaf: "SHA-256(0x02)",
        branchHash: "SHA-256(0x01 || left || right)"
      }
    },
    errorEnums: Object.values(DleError),
    rejectReasons: Object.entries(RejectReason)
      .filter(([, value]) => typeof value === "number")
      .map(([name, value]) => ({
        name,
        code: value,
        evidenceRequired: true
      })),
    containers: CONTAINERS,
    certificateReference:
      "SHA-256(UTF8(\"dle.archive.certref.v2\") || uint8(kind) || hash_tree_root(certificate))",
    certificateVectors: [
      certificateVector("CERT-PREVOTE-QC-4-OF-5", prevoteQc),
      certificateVector("CERT-ARCHIVE-CERTIFICATE-4-OF-5", ac),
      certificateVector("CERT-TIMEOUT-CERTIFICATE-4-OF-5", tc),
      certificateVector("CERT-CANDIDATE-REJECT-4-OF-5", reject)
    ],
    coordinatorVectors: [
      {
        id: "COORDINATOR-CANONICAL-ROSTER-ROUND-2",
        input: { roster, ...coordinatorInput },
        expected: selectCoordinator(roster, coordinatorInput)
      }
    ],
    walVectors: [
      {
        id: "WAL-FRAME-VOTE-1",
        input: { sequence: "1", flags: 1, payload: bytesToHex(walPayload) },
        frame: bytesToHex(walFrame),
        frameSha256: sha256(walFrame),
        expected: { frameCount: 1, recoveryRequired: false, validBytes: walFrame.length }
      },
      {
        id: "WAL-CORRUPT-CHECKSUM",
        frame: bytesToHex(corruptWalFrame),
        expected: {
          frameCount: 0,
          recoveryRequired: true,
          validBytes: 0,
          code: DleError.WalRecoveryRequired
        }
      },
      {
        id: "WAL-TRUNCATED-TAIL",
        frame: bytesToHex(walFrame.slice(0, -9)),
        expected: {
          frameCount: 0,
          recoveryRequired: true,
          validBytes: 0,
          code: DleError.WalRecoveryRequired
        }
      }
    ],
    rsVectors,
    rsReconstructionSets: combinationsOfFourFromSeven(),
    stateMachineVectors: [
      {
        id: "TM-V2-NORMAL-COMMIT",
        initial: unlocked,
        inputs: [
          {
            type: "PROPOSAL",
            value: valueA,
            available: true,
            validRound: NONE_ROUND,
            validPrevoteQCRef: ZERO32
          },
          { type: "PREVOTE_QC", value: valueA, qcRef: certificateRef(prevoteQc) },
          { type: "PRECOMMIT_QC", value: valueA, acRef: certificateRef(ac) }
        ],
        expected: replay(unlocked, [
          {
            type: "PROPOSAL",
            value: valueA,
            available: true,
            validRound: NONE_ROUND,
            validPrevoteQCRef: ZERO32
          },
          { type: "PREVOTE_QC", value: valueA, qcRef: certificateRef(prevoteQc) },
          { type: "PRECOMMIT_QC", value: valueA, acRef: certificateRef(ac) }
        ])
      },
      {
        id: "TM-V2-NIL-ROUND-ADVANCE",
        initial: lockedA,
        inputs: [
          {
            type: "PROPOSAL",
            value: valueB,
            available: true,
            validRound: NONE_ROUND,
            validPrevoteQCRef: ZERO32
          },
          { type: "PREVOTE_QC", value: ZERO32, qcRef: ZERO32 },
          { type: "PRECOMMIT_QC", value: ZERO32, acRef: ZERO32 }
        ],
        expected: replay(lockedA, [
          {
            type: "PROPOSAL",
            value: valueB,
            available: true,
            validRound: NONE_ROUND,
            validPrevoteQCRef: ZERO32
          },
          { type: "PREVOTE_QC", value: ZERO32, qcRef: ZERO32 },
          { type: "PRECOMMIT_QC", value: ZERO32, acRef: ZERO32 }
        ])
      },
      {
        id: "TM-V2-HIGHER-VALID-ROUND",
        initial: lockedA,
        inputs: [
          {
            type: "PROPOSAL",
            value: valueB,
            available: true,
            validRound: 2,
            validPrevoteQCRef: sha256(utf8("round-2-B-prevote-qc"))
          }
        ],
        expected: replay(lockedA, [
          {
            type: "PROPOSAL",
            value: valueB,
            available: true,
            validRound: 2,
            validPrevoteQCRef: sha256(utf8("round-2-B-prevote-qc"))
          }
        ])
      },
      {
        id: "TM-V2-TIMEOUT-PRESERVES-LOCK",
        initial: { ...lockedA, step: "PRECOMMIT" },
        inputs: [{ type: "PRECOMMIT_TIMEOUT", tcRef: certificateRef(tc) }],
        expected: replay(
          { ...lockedA, step: "PRECOMMIT" },
          [{ type: "PRECOMMIT_TIMEOUT", tcRef: certificateRef(tc) }]
        )
      },
      {
        id: "TM-V2-REJECT-FREEZES",
        initial: unlocked,
        inputs: [
          {
            type: "REJECT_CERT",
            rejectRef: certificateRef(reject),
            afterFinality: false
          }
        ],
        expected: replay(unlocked, [
          {
            type: "REJECT_CERT",
            rejectRef: certificateRef(reject),
            afterFinality: false
          }
        ])
      }
    ],
    lifecycleVectors: [
      {
        id: "LIFECYCLE-5-PLUS-2-PLANNED-EXIT",
        initial: initialLifecycle,
        inputs: lifecycleInputs,
        expected: lifecycleReplay(initialLifecycle, lifecycleInputs)
      }
    ]
  }) as object;
}

function json(value: object): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function digestFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function relativeManifestLine(path: string): string {
  return `${digestFile(path)}  ${path.slice(ROOT.length + 1)}`;
}

function writeCorpus(): void {
  mkdirSync(dirname(CORPUS_PATH), { recursive: true });
  writeFileSync(CORPUS_PATH, json(buildCorpus()));
  writeFileSync(
    MANIFEST_PATH,
    `${relativeManifestLine(SCHEMA_PATH)}\n${relativeManifestLine(CORPUS_PATH)}\n`
  );
}

function checkCorpus(): void {
  const generated = json(buildCorpus());
  const checkedIn = readFileSync(CORPUS_PATH, "utf8");
  if (generated !== checkedIn) throw new Error("Canonical v2 corpus is stale");
  const expectedManifest = `${relativeManifestLine(SCHEMA_PATH)}\n${relativeManifestLine(CORPUS_PATH)}\n`;
  if (readFileSync(MANIFEST_PATH, "utf8") !== expectedManifest) {
    throw new Error("Canonical v2 SHA-256 manifest is stale");
  }
}

const mode = process.argv[2];
if (mode === "--write") {
  writeCorpus();
  process.stdout.write(`Wrote ${CORPUS_PATH}\n`);
} else if (mode === "--check") {
  checkCorpus();
  process.stdout.write("Canonical v2 corpus and manifest match\n");
} else {
  throw new Error("Usage: generate-corpus.ts --write|--check");
}
