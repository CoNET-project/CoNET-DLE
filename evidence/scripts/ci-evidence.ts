import { createHash } from 'node:crypto'
import { copyFile, lstat, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type JsonObject = Record<string, unknown>

type DigestFile = {
  path: string
  sha256: string
  bytes: number
}

type CheckDefinition = {
  id: string
  command: string
  artifact: string
}

type JsonSchemaValidator = {
  (value: unknown): boolean
  errors?: unknown
}

type JsonSchemaCompiler = {
  compile(schema: unknown): JsonSchemaValidator
}

type Ajv2020Constructor = new (options?: Record<string, unknown>) => JsonSchemaCompiler

type CiEvidenceManifest = {
  schema: 'DleTypeScriptMvpCiEvidenceManifestV1'
  schemaVersion: 'conet.dle.typescript-mvp.ci.v1'
  sourceRevision: string
  corpus: {
    schema: DigestFile
    corpus: DigestFile
    integrityManifest: DigestFile
  }
  dependencyBoundary: {
    sourceRoots: ['implementations/archive-a', 'implementations/archive-b']
    prohibitedCrossImports: true
  }
  checks: Array<CheckDefinition & { status: 'passed' }>
  artifacts: DigestFile[]
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const CORPUS_SCHEMA = 'conformance/schema/dle-archive-tendermint-corpus-v2.schema.json'
const CORPUS = 'conformance/corpus/DLE-Archive-Tendermint-Vectors-v2.json'
const CORPUS_INTEGRITY_MANIFEST = 'conformance/DLE-Archive-Tendermint-Corpus-v2.sha256'
const CI_EVIDENCE_SCHEMA = 'evidence/schemas/dle-typescript-mvp-ci-evidence-v1.schema.json'
const require = createRequire(import.meta.url)
const Ajv2020 = require('ajv/dist/2020').default as Ajv2020Constructor
const CHECKS: readonly CheckDefinition[] = [
  { id: 'ci-evidence-contract', command: 'npm run evidence:verify', artifact: 'logs/ci-evidence-contract.log' },
  { id: 'corpus-integrity', command: 'npm run corpus:check', artifact: 'logs/corpus-integrity.log' },
  { id: 'dependency-boundary', command: 'npm run boundary:check', artifact: 'logs/dependency-boundary.log' },
  { id: 'archive-a-build', command: 'npm run archive-a:build', artifact: 'logs/archive-a-build.log' },
  { id: 'archive-a-test', command: 'npm run archive-a:test', artifact: 'logs/archive-a-test.log' },
  { id: 'archive-a-conformance', command: 'npm run archive-a:conformance', artifact: 'logs/archive-a-conformance.log' },
  { id: 'archive-b-build', command: 'npm run archive-b:build', artifact: 'logs/archive-b-build.log' },
  { id: 'archive-b-test', command: 'npm run archive-b:test', artifact: 'logs/archive-b-test.log' },
  { id: 'archive-b-conformance', command: 'npm run archive-b:conformance', artifact: 'logs/archive-b-conformance.log' },
  { id: 'differential', command: 'npm run differential', artifact: 'logs/differential.log' },
]

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function exactKeys(value: JsonObject, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const sorted = [...expected].sort()
  assert(actual.length === sorted.length && actual.every((key, index) => key === sorted[index]), `${label} has invalid fields`)
}

function safeRelativePath(path: string): void {
  assert(path.length > 0 && !path.startsWith('/') && !path.split(/[\\/]/u).includes('..'), `unsafe evidence path: ${path}`)
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function describe(root: string, path: string): Promise<DigestFile> {
  safeRelativePath(path)
  const absolute = resolve(root, path)
  assert(relative(root, absolute) === path, `evidence path escapes root: ${path}`)
  const metadata = await lstat(absolute)
  assert(metadata.isFile() && !metadata.isSymbolicLink(), `evidence artifact is not a regular file: ${path}`)
  return { path, sha256: await sha256(absolute), bytes: (await stat(absolute)).size }
}

async function verifyCorpusIntegrity(): Promise<void> {
  const integrityPath = resolve(ROOT, CORPUS_INTEGRITY_MANIFEST)
  const lines = (await readFile(integrityPath, 'utf8')).trim().split('\n').filter(Boolean)
  const expectedPaths = [CORPUS_SCHEMA, CORPUS].sort()
  const expected = new Map<string, string>()
  for (const line of lines) {
    const match = /^([0-9a-f]{64}) {2}([A-Za-z0-9._/-]+)$/u.exec(line)
    assert(match !== null, `invalid corpus integrity line: ${line}`)
    const [, digest, path] = match
    assert(digest !== undefined && path !== undefined && !expected.has(path), `duplicate corpus integrity path: ${line}`)
    expected.set(path, digest)
  }
  assert(expected.size === expectedPaths.length, 'corpus integrity manifest has an unexpected file set')
  for (const path of expectedPaths) {
    const digest = expected.get(path)
    assert(digest !== undefined, `corpus integrity manifest is missing ${path}`)
    assert((await sha256(resolve(ROOT, path))) === digest, `corpus integrity mismatch: ${path}`)
  }
}

async function verifyEvidenceSchemaContract(): Promise<void> {
  const value = JSON.parse(await readFile(resolve(ROOT, CI_EVIDENCE_SCHEMA), 'utf8')) as unknown
  assert(isRecord(value), 'CI evidence schema must be an object')
  assert(value.type === 'object' && value.additionalProperties === false, 'CI evidence schema must freeze its top-level shape')
  assert(Array.isArray(value.required), 'CI evidence schema must define required fields')
  for (const field of ['schema', 'schemaVersion', 'sourceRevision', 'corpus', 'dependencyBoundary', 'checks', 'artifacts']) {
    assert(value.required.includes(field), `CI evidence schema is missing required field: ${field}`)
  }
  new Ajv2020({ allErrors: true, strict: true }).compile(value)
}

async function validateManifestAgainstSchema(value: unknown): Promise<void> {
  const schema = JSON.parse(await readFile(resolve(ROOT, CI_EVIDENCE_SCHEMA), 'utf8')) as unknown
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema)
  assert(validate(value), `CI evidence manifest violates its schema: ${JSON.stringify(validate.errors)}`)
}

async function verifyPackageCommands(): Promise<void> {
  const value = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8')) as unknown
  assert(isRecord(value) && isRecord(value.scripts), 'package.json scripts are missing')
  const scripts = value.scripts
  const requiredScripts: Record<string, string> = {
    'evidence:verify': 'tsx evidence/scripts/ci-evidence.ts verify',
    'corpus:check': 'tsx implementations/archive-a/src/generate-corpus.ts --check',
    'boundary:check': 'tsx evidence/scripts/check-dependency-boundaries.ts',
    'archive-a:build': 'tsc -p tsconfig.json',
    'archive-a:test': 'tsx --test implementations/archive-a/test/**/*.test.ts',
    'archive-a:conformance': 'tsx --test implementations/archive-a/test/core.test.ts',
    'archive-b:build': 'npm --prefix implementations/archive-b run build',
    'archive-b:test': 'npm --prefix implementations/archive-b run test',
    'archive-b:conformance': 'npm --prefix implementations/archive-b run conformance',
    differential: 'tsx conformance/differential/runner.ts',
  }
  for (const [name, command] of Object.entries(requiredScripts)) {
    assert(scripts[name] === command, `package script ${name} must be exactly "${command}"`)
  }
}

async function verifyConfiguration(): Promise<void> {
  await Promise.all([verifyCorpusIntegrity(), verifyEvidenceSchemaContract(), verifyPackageCommands()])
}

function parseArguments(args: readonly string[]): Map<string, string> {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    assert(key !== undefined && value !== undefined && key.startsWith('--'), 'arguments must be --key value pairs')
    values.set(key, value)
  }
  return values
}

async function writeArtifactIndex(outputDir: string, files: readonly DigestFile[]): Promise<void> {
  const indexFiles = [...files, await describe(outputDir, 'manifest.json')].sort((left, right) => left.path.localeCompare(right.path))
  const content = `${indexFiles.map((file) => `${file.sha256}  ${file.bytes}  ${file.path}`).join('\n')}\n`
  await writeFile(join(outputDir, 'SHA256SUMS'), content, { encoding: 'utf8', flag: 'wx' })
}

async function verifyCheckLogSet(artifactDir: string): Promise<void> {
  const expected = new Set(CHECKS.map((check) => check.artifact.slice('logs/'.length)))
  const entries = await readdir(resolve(artifactDir, 'logs'), { withFileTypes: true })
  assert(entries.length === expected.size, 'CI evidence has an unexpected check log set')
  for (const entry of entries) {
    assert(entry.isFile() && !entry.isSymbolicLink() && expected.has(entry.name), `unexpected CI evidence check log: ${entry.name}`)
  }
}

async function collect(outputDir: string, artifactDir: string, sourceRevision: string): Promise<void> {
  await verifyConfiguration()
  assert(sourceRevision.length > 0, 'source revision must not be empty')
  await verifyCheckLogSet(artifactDir)
  await mkdir(outputDir, { recursive: false })
  await mkdir(join(outputDir, 'logs'), { recursive: false })

  const artifacts: DigestFile[] = []
  for (const check of CHECKS) {
    const source = resolve(artifactDir, check.artifact)
    const sourceMetadata = await lstat(source)
    assert(sourceMetadata.isFile() && !sourceMetadata.isSymbolicLink(), `missing successful check log: ${check.artifact}`)
    const destination = resolve(outputDir, check.artifact)
    await copyFile(source, destination, 0)
    artifacts.push(await describe(outputDir, check.artifact))
  }

  const manifest: CiEvidenceManifest = {
    schema: 'DleTypeScriptMvpCiEvidenceManifestV1',
    schemaVersion: 'conet.dle.typescript-mvp.ci.v1',
    sourceRevision,
    corpus: {
      schema: await describe(ROOT, CORPUS_SCHEMA),
      corpus: await describe(ROOT, CORPUS),
      integrityManifest: await describe(ROOT, CORPUS_INTEGRITY_MANIFEST),
    },
    dependencyBoundary: {
      sourceRoots: ['implementations/archive-a', 'implementations/archive-b'],
      prohibitedCrossImports: true,
    },
    checks: CHECKS.map((check) => ({ ...check, status: 'passed' })),
    artifacts,
  }
  await writeFile(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  })
  await writeArtifactIndex(outputDir, artifacts)
  await verifyManifest(outputDir)
}

function validateManifestShape(value: unknown): asserts value is CiEvidenceManifest {
  assert(isRecord(value), 'CI evidence manifest must be an object')
  exactKeys(value, ['schema', 'schemaVersion', 'sourceRevision', 'corpus', 'dependencyBoundary', 'checks', 'artifacts'], 'CI evidence manifest')
  assert(value.schema === 'DleTypeScriptMvpCiEvidenceManifestV1', 'invalid CI evidence schema')
  assert(value.schemaVersion === 'conet.dle.typescript-mvp.ci.v1', 'invalid CI evidence schema version')
  assert(typeof value.sourceRevision === 'string' && value.sourceRevision.length > 0, 'invalid CI evidence source revision')
  assert(isRecord(value.corpus), 'invalid CI evidence corpus')
  exactKeys(value.corpus, ['schema', 'corpus', 'integrityManifest'], 'CI evidence corpus')
  assert(isRecord(value.dependencyBoundary), 'invalid CI evidence dependency boundary')
  exactKeys(value.dependencyBoundary, ['sourceRoots', 'prohibitedCrossImports'], 'CI evidence dependency boundary')
  assert(value.dependencyBoundary.prohibitedCrossImports === true, 'cross-archive imports must be prohibited')
  assert(Array.isArray(value.dependencyBoundary.sourceRoots), 'CI evidence source roots must be an array')
  assert(JSON.stringify(value.dependencyBoundary.sourceRoots) === JSON.stringify(['implementations/archive-a', 'implementations/archive-b']), 'unexpected CI evidence source roots')
  assert(Array.isArray(value.checks) && value.checks.length === CHECKS.length, 'CI evidence check set is incomplete')
  for (const [index, expected] of CHECKS.entries()) {
    const check = value.checks[index]
    assert(isRecord(check), 'CI evidence check must be an object')
    exactKeys(check, ['id', 'command', 'artifact', 'status'], 'CI evidence check')
    assert(
      check.id === expected.id &&
        check.command === expected.command &&
        check.artifact === expected.artifact &&
        check.status === 'passed',
      `CI evidence check mismatch: ${expected.id}`,
    )
  }
  assert(Array.isArray(value.artifacts) && value.artifacts.length === CHECKS.length, 'CI evidence artifacts are incomplete')
}

async function verifyArtifactIndex(outputDir: string, expected: readonly DigestFile[]): Promise<void> {
  const text = await readFile(join(outputDir, 'SHA256SUMS'), 'utf8')
  const indexed = new Map<string, { sha256: string; bytes: number }>()
  for (const line of text.trim().split('\n')) {
    const match = /^([0-9a-f]{64}) {2}(\d+) {2}([A-Za-z0-9._/-]+)$/u.exec(line)
    assert(match !== null, `invalid CI evidence index entry: ${line}`)
    const [, digest, bytes, path] = match
    assert(digest !== undefined && bytes !== undefined && path !== undefined && !indexed.has(path), `duplicate CI evidence index entry: ${line}`)
    indexed.set(path, { sha256: digest, bytes: Number(bytes) })
  }
  const files = [...expected, await describe(outputDir, 'manifest.json')]
  assert(indexed.size === files.length, 'CI evidence index has an unexpected file set')
  for (const file of files) {
    const actual = indexed.get(file.path)
    assert(actual !== undefined && actual.sha256 === file.sha256 && actual.bytes === file.bytes, `CI evidence index mismatch: ${file.path}`)
  }
}

async function verifyManifest(outputDir: string): Promise<void> {
  await verifyConfiguration()
  const manifest = JSON.parse(await readFile(join(outputDir, 'manifest.json'), 'utf8')) as unknown
  await validateManifestAgainstSchema(manifest)
  validateManifestShape(manifest)
  const expectedCorpus = {
    schema: await describe(ROOT, CORPUS_SCHEMA),
    corpus: await describe(ROOT, CORPUS),
    integrityManifest: await describe(ROOT, CORPUS_INTEGRITY_MANIFEST),
  }
  assert(JSON.stringify(manifest.corpus) === JSON.stringify(expectedCorpus), 'CI evidence corpus digests do not match the checked-in artifacts')
  const artifacts = manifest.artifacts as DigestFile[]
  for (const artifact of artifacts) {
    assert(isRecord(artifact), 'CI evidence artifact must be an object')
    exactKeys(artifact, ['path', 'sha256', 'bytes'], 'CI evidence artifact')
    assert(typeof artifact.path === 'string' && typeof artifact.sha256 === 'string' && typeof artifact.bytes === 'number', 'invalid CI evidence artifact')
    const actual = await describe(outputDir, artifact.path)
    assert(JSON.stringify(actual) === JSON.stringify(artifact), `CI evidence artifact integrity mismatch: ${artifact.path}`)
  }
  await verifyArtifactIndex(outputDir, artifacts)
}

async function main(): Promise<void> {
  const [mode, ...args] = process.argv.slice(2)
  if (mode === 'verify') {
    await verifyConfiguration()
    process.stdout.write('CI evidence contract and corpus integrity configuration verified\n')
    return
  }
  const options = parseArguments(args)
  if (mode === 'collect') {
    const output = options.get('--output')
    const artifacts = options.get('--artifacts')
    const revision = options.get('--revision')
    assert(output !== undefined && artifacts !== undefined && revision !== undefined, 'collect requires --output --artifacts --revision')
    await collect(resolve(output), resolve(artifacts), revision)
    process.stdout.write(`CI evidence bundle written to ${resolve(output)}\n`)
    return
  }
  if (mode === 'verify-manifest') {
    const output = options.get('--output')
    assert(output !== undefined, 'verify-manifest requires --output')
    await verifyManifest(resolve(output))
    process.stdout.write(`CI evidence bundle verified at ${resolve(output)}\n`)
    return
  }
  throw new Error('usage: ci-evidence.ts verify | collect --output <dir> --artifacts <dir> --revision <revision> | verify-manifest --output <dir>')
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
