import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  AppendOnlyWal,
  ArchiveLifecycleState,
  Certificate,
  CertificateKind,
  CONTAINERS,
  CoordinatorInput,
  DleError,
  DleProtocolError,
  Hex,
  LifecycleInput,
  TendermintInput,
  TendermintState,
  WalSafetyRecord,
  ZERO32,
  applyLifecycleInput,
  applyTendermintInput,
  bytesToHex,
  certificateContainer,
  certificateRef,
  combinationsOfFourFromSeven,
  decodeWal,
  decodeWalSafetyRecord,
  encodeRs74,
  hashTreeRoot,
  hexToBytes,
  lifecycleStateRoot,
  reconstructRs74,
  selectCoordinator,
  serializeContainer,
  signingRoot,
  tendermintStateRoot,
  validateCertificate,
  verifyRs74
} from "../src/core.js";
import { processLine } from "../src/cli.js";

const ROOT = resolve(import.meta.dirname, "../../..");
const V1_PATH = resolve(ROOT, "src/whitepaper/DLE-Archive-Tendermint-Vectors-v1.json");
const SCHEMA_PATH = resolve(ROOT, "conformance/schema/dle-archive-tendermint-corpus-v2.schema.json");
const CORPUS_PATH = resolve(ROOT, "conformance/corpus/DLE-Archive-Tendermint-Vectors-v2.json");

interface Corpus {
  compatibility: {
    legacyProposalVoteVectors: Array<Record<string, unknown>>;
  };
  certificateVectors: Array<Record<string, unknown>>;
  coordinatorVectors: Array<Record<string, unknown>>;
  walVectors: Array<Record<string, unknown>>;
  rsVectors: Array<Record<string, unknown>>;
  rsReconstructionSets: number[][];
  stateMachineVectors: Array<Record<string, unknown>>;
  lifecycleVectors: Array<Record<string, unknown>>;
}

const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as object;
const corpus = JSON.parse(readFileSync(CORPUS_PATH, "utf8")) as Corpus;
const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020").default as typeof import("ajv").default;
const v1 = JSON.parse(readFileSync(V1_PATH, "utf8")) as {
  fixture: Record<string, unknown>;
  sszVectors: Array<Record<string, unknown>>;
};

function asRecord(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function hydrateContainer(
  container: keyof typeof CONTAINERS,
  raw: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    CONTAINERS[container].map(([name, type]) => [
      name,
      type === "uint64" || type === "uint256" ? BigInt(String(raw[name])) : raw[name]
    ])
  );
}

function hydrateCertificate(raw: Record<string, unknown>): Certificate {
  const probe = raw as unknown as Certificate;
  return hydrateContainer(certificateContainer(probe), raw) as unknown as Certificate;
}

function replayFsm(initial: TendermintState, inputs: readonly TendermintInput[]): object {
  let state = initial;
  const outputs: unknown[] = [];
  const errors: DleError[] = [];
  for (const input of inputs) {
    const transition = applyTendermintInput(state, input);
    state = transition.state;
    outputs.push(...transition.outputs);
    if (transition.error !== undefined) errors.push(transition.error);
  }
  return { state, outputs, errors, stateRoot: tendermintStateRoot(state) };
}

function replayLifecycle(
  initial: ArchiveLifecycleState,
  inputs: readonly LifecycleInput[]
): { state: ArchiveLifecycleState; stateRoot: Hex } {
  let state = initial;
  for (const input of inputs) state = applyLifecycleInput(state, input);
  return { state, stateRoot: lifecycleStateRoot(state) };
}

test("v2 corpus validates against its JSON Schema", () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false });
  const validate = ajv.compile(schema);
  assert.equal(validate(corpus), true, JSON.stringify(validate.errors, null, 2));
});

test("v2 embeds all immutable v1 Proposal/Vote vectors", () => {
  assert.deepEqual(corpus.compatibility.legacyProposalVoteVectors, v1.sszVectors);
});

test("archive-a reproduces all v1 Proposal/Vote SSZ bytes and roots", () => {
  for (const vector of v1.sszVectors) {
    const container = String(vector.type) as "ProposalSignBytesV1" | "VoteSignBytesV1";
    const fixture = {
      protocolVersion: v1.fixture.protocolVersion,
      l1ChainId: BigInt(String(v1.fixture.l1ChainId)),
      archiveGroupId: BigInt(String(v1.fixture.archiveGroupId)),
      chainNftId: BigInt(String(v1.fixture.chainNftId)),
      tipHeight: BigInt(String(v1.fixture.tipHeight)),
      round: Number(v1.fixture.round),
      proposalValueHash: v1.fixture.valueHash,
      validRoundOrNone: 0,
      validPrevoteQCRefOrZero: ZERO32,
      step: 0,
      valueHashOrZero: ZERO32,
      attemptNonce: BigInt(String(v1.fixture.attemptNonce)),
      membershipEpoch: BigInt(String(v1.fixture.membershipEpoch)),
      membershipRoot: v1.fixture.membershipRoot,
      keyEpoch: BigInt(String(v1.fixture.keyEpoch)),
      prevoteQCRefOrZero: ZERO32,
      ...asRecord(vector.input)
    };
    const object = hydrateContainer(container, fixture);
    assert.equal(bytesToHex(serializeContainer(container, object)), vector.canonicalSsz, vector.id as string);
    assert.equal(hashTreeRoot(container, object), vector.hashTreeRoot, vector.id as string);
    assert.equal(signingRoot(container, object), vector.signingRoot, vector.id as string);
  }
});

test("archive-a reproduces and validates all certificate vectors", () => {
  for (const vector of corpus.certificateVectors) {
    const container = String(vector.container) as keyof typeof CONTAINERS;
    const certificate = hydrateCertificate(asRecord(vector.input));
    validateCertificate(certificate);
    const record = certificate as unknown as Record<string, unknown>;
    assert.equal(bytesToHex(serializeContainer(container, record)), vector.canonicalSsz);
    assert.equal(hashTreeRoot(container, record), vector.hashTreeRoot);
    assert.equal(signingRoot(container, record), vector.signingRoot);
    assert.equal(certificateRef(certificate), vector.certificateRef);
  }
});

test("certificate validation rejects fewer than four signatures", () => {
  const certificate = hydrateCertificate(asRecord(corpus.certificateVectors[0]!.input));
  const invalid = { ...certificate, signerBitmap: 0x07 } as Certificate;
  assert.throws(
    () => validateCertificate(invalid),
    (error: unknown) => error instanceof DleProtocolError && error.code === DleError.InvalidQuorum
  );
});

test("coordinator vector is deterministic and roster-order independent", () => {
  const vector = corpus.coordinatorVectors[0]!;
  const input = asRecord(vector.input);
  const roster = input.roster as Hex[];
  const parsed: CoordinatorInput = {
    archiveGroupId: BigInt(String(input.archiveGroupId)),
    chainNftId: BigInt(String(input.chainNftId)),
    tipHeight: BigInt(String(input.tipHeight)),
    attemptNonce: BigInt(String(input.attemptNonce)),
    membershipRoot: input.membershipRoot as Hex,
    round: Number(input.round)
  };
  const expected = asRecord(vector.expected);
  const selected = selectCoordinator(roster, parsed);
  assert.deepEqual(
    { ...selected, sample: selected.sample },
    expected
  );
  assert.equal(selectCoordinator([...roster].reverse(), parsed).coordinator, selected.coordinator);
});

test("WAL vectors detect valid, corrupt, and truncated frames", () => {
  for (const vector of corpus.walVectors) {
    const expected = asRecord(vector.expected);
    const decoded = decodeWal(hexToBytes(String(vector.frame)));
    assert.equal(decoded.frames.length, expected.frameCount);
    assert.equal(decoded.recoveryRequired, expected.recoveryRequired);
    assert.equal(decoded.validBytes, expected.validBytes);
    if (!decoded.recoveryRequired) {
      assert.equal(bytesToHex(decoded.frames[0]!.payload), asRecord(vector.input).payload);
      decodeWalSafetyRecord(decoded.frames[0]!.payload);
    }
  }
});

test("append-only WAL fsync path is idempotent and prevents double-signing", () => {
  const directory = mkdtempSync(join(tmpdir(), "dle-wal-"));
  const path = join(directory, "archive.wal");
  try {
    const vector = corpus.walVectors[0]!;
    const payload = hexToBytes(String(asRecord(vector.input).payload));
    const record = decodeWalSafetyRecord(payload);
    const wal = new AppendOnlyWal(path);
    assert.equal(wal.appendSafetyRecord(record)?.sequence, 1n);
    assert.equal(wal.appendSafetyRecord(record), null);
    const conflicting: WalSafetyRecord = {
      ...record,
      canonicalSignBytes: record.canonicalSignBytes.map((byte, index) =>
        index === record.canonicalSignBytes.length - 1 ? byte ^ 1 : byte
      )
    };
    assert.throws(
      () => wal.appendSafetyRecord(conflicting),
      (error: unknown) => error instanceof DleProtocolError && error.code === DleError.WalDoubleSign
    );
    assert.equal(wal.read().frames.length, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("RS vectors reproduce exact shards, body commitments, and DA roots", () => {
  for (const vector of corpus.rsVectors) {
    const body = hexToBytes(String(vector.body));
    const encoded = encodeRs74(body);
    assert.deepEqual(encoded.shards.map(bytesToHex), vector.shards);
    assert.equal(encoded.bodyCommitment, vector.bodyCommitment);
    assert.equal(encoded.daRoot, vector.daRoot);
    verifyRs74(body, encoded.shards);
  }
});

test("RS(7,4) reconstructs every vector from all 35 four-shard subsets", () => {
  assert.deepEqual(corpus.rsReconstructionSets, combinationsOfFourFromSeven());
  assert.equal(corpus.rsReconstructionSets.length, 35);
  for (const vector of corpus.rsVectors) {
    const body = hexToBytes(String(vector.body));
    const shards = (vector.shards as string[]).map((shard) => hexToBytes(shard));
    for (const indexes of corpus.rsReconstructionSets) {
      const rebuilt = reconstructRs74(
        indexes.map((index) => ({ index, bytes: shards[index]! }))
      );
      assert.deepEqual(rebuilt, body, `${String(vector.id)} from ${indexes.join(",")}`);
    }
  }
});

test("machine-readable Tendermint vectors replay to exact outputs and state roots", () => {
  for (const vector of corpus.stateMachineVectors) {
    const actual = replayFsm(
      vector.initial as TendermintState,
      vector.inputs as TendermintInput[]
    );
    assert.deepEqual(actual, vector.expected, String(vector.id));
  }
});

test("5+2 lifecycle vector preserves five active members across atomic switch", () => {
  for (const vector of corpus.lifecycleVectors) {
    const actual = replayLifecycle(
      vector.initial as ArchiveLifecycleState,
      vector.inputs as LifecycleInput[]
    );
    assert.deepEqual(actual, vector.expected, String(vector.id));
    const final = actual.state;
    assert.equal(final.active.length, 5);
    assert.equal(final.standby.length, 1);
    assert.equal(final.membershipEpoch, 12);
    assert.equal(final.keyEpoch, 6);
  }
});

test("stdin/stdout runner emits one deterministic JSON response", () => {
  assert.deepEqual(
    processLine('{"id":1,"method":"health"}'),
    {
      id: 1,
      ok: true,
      result: {
        implementation: "archive-a",
        protocol: "dle.archive.tendermint.corpus.v2"
      }
    }
  );
  const invalid = processLine("not-json");
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error?.code, "ERR_INVALID_REQUEST");
});
