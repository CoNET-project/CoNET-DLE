import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

type JsonObject = Record<string, unknown>;
type JsonResponse = { id: string; ok: boolean; result?: unknown; error?: unknown };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CORPUS_PATH = resolve(ROOT, 'conformance/corpus/DLE-Archive-Tendermint-Vectors-v2.json');
const ARCHIVE_A = resolve(ROOT, 'implementations/archive-a/src/cli.ts');
const ARCHIVE_B = resolve(ROOT, 'implementations/archive-b/src/cli.ts');
const ZERO32 = `0x${'00'.repeat(32)}`;
const NONE_ROUND = 0xffff_ffff;
const LEGACY_FIXTURE: JsonObject = {
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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function invoke(script: string, request: JsonObject): Promise<JsonResponse> {
  return new Promise((resolveResponse, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', script], {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) return reject(new Error(`CLI exited ${code}: ${stderr}`));
      try {
        const lines = stdout.trim().split('\n').filter(Boolean);
        assert(lines.length === 1, `expected one JSONL response, received ${lines.length}`);
        resolveResponse(JSON.parse(lines[0]!) as JsonResponse);
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

function canonical(value: unknown): string {
  return JSON.stringify(value);
}

function hash32(label: string): string {
  return `0x${createHash('sha256').update(label).digest('hex')}`;
}

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function proposalObject(common: JsonObject, input: JsonObject): JsonObject {
  return {
    ...common,
    ...input,
    proposalValueHash: common.valueHash,
  };
}

function voteObject(common: JsonObject, input: JsonObject): JsonObject {
  return {
    ...common,
    ...input,
    valueHashOrZero: input.valueHashOrZero ?? common.valueHash,
  };
}

async function compare(label: string, a: JsonObject, b: JsonObject): Promise<void> {
  const [left, right] = await Promise.all([invoke(ARCHIVE_A, a), invoke(ARCHIVE_B, b)]);
  assert(left.ok, `${label}: Archive A rejected ${JSON.stringify(left.error)}`);
  assert(right.ok, `${label}: Archive B rejected ${JSON.stringify(right.error)}`);
  assert(canonical(left.result) === canonical(right.result), `${label}: implementation output mismatch`);
}

async function runSszVectors(corpus: JsonObject): Promise<number> {
  const compatibility = corpus.compatibility as JsonObject;
  const vectors = compatibility.legacyProposalVoteVectors as JsonObject[];
  for (const vector of vectors) {
    const isProposal = vector.type === 'ProposalSignBytesV1';
    const object = isProposal
      ? proposalObject(LEGACY_FIXTURE, vector.input as JsonObject)
      : voteObject(LEGACY_FIXTURE, vector.input as JsonObject);
    await compare(
      String(vector.id),
      { id: vector.id, method: 'container.derive', params: { container: vector.type, object } },
      {
        id: vector.id,
        op: isProposal ? 'ssz.proposal' : 'ssz.vote',
        value: object,
        domainTag: vector.signatureDomainTag,
      },
    );
  }
  return vectors.length;
}

async function runDaTranscripts(count: number): Promise<number> {
  const next = seeded(0x5a17_2026);
  for (let index = 0; index < count; index += 1) {
    const bytes = Buffer.alloc(1 + Math.floor(next() * 2048));
    for (let cursor = 0; cursor < bytes.length; cursor += 1) bytes[cursor] = Math.floor(next() * 256);
    const body = `0x${bytes.toString('hex')}`;
    const [left, right] = await Promise.all([
      invoke(ARCHIVE_A, { id: `da-${index}`, method: 'rs.encode', params: { body } }),
      invoke(ARCHIVE_B, { id: `da-${index}`, op: 'da.encode', bodyHex: body }),
    ]);
    assert(left.ok && right.ok, `da-${index}: encoder rejected a valid body`);
    const a = left.result as JsonObject;
    const b = right.result as JsonObject;
    const aShards = a.shards as string[];
    const bChunks = b.chunks as string[];
    assert(
      canonical(aShards) === canonical(bChunks) &&
        a.bodyCommitment === b.bodyCommitment &&
        a.daRoot === b.daRoot,
      `da-${index}: RS/DA output mismatch`,
    );
    const selection = [0, 2, 4, 6].map((shard) => ({ index: shard, chunk: aShards[shard] }));
    const [reconstructedA, reconstructedB] = await Promise.all([
      invoke(ARCHIVE_A, {
        id: `da-reconstruct-${index}`,
        method: 'rs.reconstruct',
        params: {
          shards: selection.map(({ index: shard, chunk }) => ({ index: shard, bytes: chunk })),
        },
      }),
      invoke(ARCHIVE_B, {
        id: `da-reconstruct-${index}`,
        op: 'da.reconstruct',
        chunks: selection.map(({ index: shard, chunk }) => ({ index: shard, chunkHex: chunk })),
        payloadLength: bytes.length,
      }),
    ]);
    assert(reconstructedA.ok && reconstructedB.ok, `da-reconstruct-${index}: reconstruction failed`);
    assert(
      (reconstructedA.result as JsonObject).body === (reconstructedB.result as JsonObject).bodyHex,
      `da-reconstruct-${index}: reconstructed body mismatch`,
    );
  }
  return count;
}

function initialState(): JsonObject {
  return {
    height: 9,
    round: 0,
    step: 'PROPOSE',
    mode: 'VOTING',
    lockedValue: ZERO32,
    lockedRound: NONE_ROUND,
    validValue: ZERO32,
    validRound: NONE_ROUND,
    validPrevoteQCRef: ZERO32,
    committedAcRef: ZERO32,
    rejectRef: ZERO32,
  };
}

async function runFsmTranscripts(count: number): Promise<number> {
  const next = seeded(0x5a17_f5a);
  for (let index = 0; index < count; index += 1) {
    const value = hash32(`differential-value-${index}`);
    const qcRef = hash32(`differential-qc-${index}`);
    const acRef = hash32(`differential-ac-${index}`);
    const available = next() > 0.15;
    const nil = next() > 0.7;
    const inputs: JsonObject[] = [
      {
        type: 'PROPOSAL',
        value,
        available,
        validRound: NONE_ROUND,
        validPrevoteQCRef: ZERO32,
      },
      { type: 'PREVOTE_QC', value: nil ? ZERO32 : value, qcRef: nil ? ZERO32 : qcRef },
      { type: 'PRECOMMIT_QC', value: nil ? ZERO32 : value, acRef: nil ? ZERO32 : acRef },
    ];
    await compare(
      `fsm-${index}`,
      { id: `fsm-${index}`, method: 'fsm.replay', params: { initial: initialState(), inputs } },
      { id: `fsm-${index}`, op: 'fsm.replay', initial: initialState(), inputs },
    );
  }
  return count;
}

export async function runDifferential(seedCount = 24): Promise<JsonObject> {
  const corpus = JSON.parse(await readFile(CORPUS_PATH, 'utf8')) as JsonObject;
  const [sszVectors, daTranscripts, fsmTranscripts] = await Promise.all([
    runSszVectors(corpus),
    runDaTranscripts(seedCount),
    runFsmTranscripts(seedCount),
  ]);
  return {
    ok: true,
    corpus: 'dle.archive.tendermint.corpus.v2',
    sszVectors,
    randomDaTranscripts: daTranscripts,
    randomFsmTranscripts: fsmTranscripts,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runDifferential()
    .then((report) => process.stdout.write(`${JSON.stringify(report)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
      process.exitCode = 1;
    });
}
