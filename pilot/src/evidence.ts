import { createHash } from 'node:crypto'
import {
  appendFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import type {
  EvidenceFileV1,
  EvidenceManifestV1,
  PilotGateSnapshotV1,
} from './model.js'
import { PILOT_SCHEMA_VERSION } from './model.js'

const PUBLIC_EVIDENCE_FILES = [
  'inventory.json',
  'gate.json',
  'failures.ndjson',
  'meter.ndjson',
  'invoice.json',
] as const

type PublicEvidenceFile = (typeof PUBLIC_EVIDENCE_FILES)[number]
type JsonRecord = Record<string, unknown>

const SENSITIVE_KEY =
  /(?:secret|password|private.?key|mnemonic|authorization|bearer|cookie|token|host|ip|endpoint|email|billingRef|sourceBillingRefs|account|payment|legal.?name|api.?key|credential|ssh.?key|pem|access.?key|session)/iu
const SENSITIVE_VALUE = [
  /-----BEGIN(?: [A-Z]+)* (?:PRIVATE )?KEY-----/giu,
  /\bAKIA[0-9A-Z]{16}\b/gu,
  /\b(?:eyJ[A-Za-z0-9_-]{8,}\.){2}[A-Za-z0-9_-]{8,}\b/gu,
  /\b(?:xox[baprs]-[A-Za-z0-9-]{10,}|gh[pousr]_[A-Za-z0-9_]{20,})\b/giu,
] as const

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: JsonRecord, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has unsupported or missing fields`)
  }
}

function requiredString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`)
}

function requiredDate(value: unknown, label: string): void {
  requiredString(value, label)
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO date`)
}

function requiredNumber(value: unknown, label: string, minimum = 0): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
    throw new Error(`${label} must be a finite number >= ${minimum}`)
  }
}

function requiredInteger(value: unknown, label: string, minimum = 0): void {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new Error(`${label} must be an integer >= ${minimum}`)
  }
}

function validateGate(value: unknown): asserts value is PilotGateSnapshotV1 {
  if (!isRecord(value)) throw new Error('gate must be an object')
  exactKeys(
    value,
    ['schema', 'epoch', 'warmupStartedAt', 'pilotStartedAt', 'lastSafetyFailureAt', 'resetCount', 'counters'],
    'gate',
  )
  if (value.schema !== 'PilotGateSnapshotV1') throw new Error('gate schema is invalid')
  requiredInteger(value.epoch, 'gate.epoch', 1)
  requiredDate(value.warmupStartedAt, 'gate.warmupStartedAt')
  for (const field of ['pilotStartedAt', 'lastSafetyFailureAt'] as const) {
    if (value[field] !== null) requiredDate(value[field], `gate.${field}`)
  }
  requiredInteger(value.resetCount, 'gate.resetCount')
  if (!isRecord(value.counters)) throw new Error('gate.counters must be an object')
  exactKeys(value.counters, ['rotations', 'rehomes', 'takeovers'], 'gate.counters')
  for (const field of ['rotations', 'rehomes', 'takeovers'] as const) {
    requiredInteger(value.counters[field], `gate.counters.${field}`)
  }
}

function validateInventory(value: unknown): void {
  if (!isRecord(value)) throw new Error('inventory must be an object')
  exactKeys(value, ['schema', 'pilotId', 'generatedAt', 'domains'], 'inventory')
  if (value.schema !== 'PilotInventoryV1') throw new Error('inventory schema is invalid')
  requiredString(value.pilotId, 'inventory.pilotId')
  requiredDate(value.generatedAt, 'inventory.generatedAt')
  if (!Array.isArray(value.domains) || value.domains.length !== 7) {
    throw new Error('inventory must contain seven domains')
  }
  for (const [index, domain] of value.domains.entries()) {
    if (!isRecord(domain)) throw new Error(`inventory.domains[${index}] must be an object`)
    exactKeys(
      domain,
      ['domainId', 'operatorDomainId', 'operatorLegalName', 'hostId', 'provider', 'region', 'networkAsn', 'role', 'billingRef'],
      `inventory.domains[${index}]`,
    )
    for (const key of Object.keys(domain)) requiredString(domain[key], `inventory.domains[${index}].${key}`)
    if (domain.role !== 'active' && domain.role !== 'standby') throw new Error('inventory has invalid role')
  }
}

const FAILURE_KINDS = new Set([
  'process-crash',
  'network-partition',
  'disk-corruption',
  'wal-corruption',
  'duplicate-message',
  'reorder-message',
  'stale-membership',
  'oracle-fault',
  'treasury-fault',
  'l1-reorg-simulation',
])

function validateFailure(value: unknown): void {
  if (!isRecord(value)) throw new Error('failure record must be an object')
  exactKeys(
    value,
    ['schema', 'sampleId', 'pilotId', 'scenarioId', 'scenarioKind', 'targetDomainIds', 'startedAt', 'endedAt', 'outcome', 'safetyInvariant', 'observation', 'simulated'],
    'failure',
  )
  if (value.schema !== 'FailureSampleV1' || !FAILURE_KINDS.has(value.scenarioKind as string)) {
    throw new Error('failure schema or kind is invalid')
  }
  for (const key of ['sampleId', 'pilotId', 'scenarioId', 'safetyInvariant', 'observation'] as const) {
    requiredString(value[key], `failure.${key}`)
  }
  if (!['contained', 'recovered', 'safety-failure'].includes(value.outcome as string)) {
    throw new Error('failure outcome is invalid')
  }
  if (!Array.isArray(value.targetDomainIds) || value.targetDomainIds.length === 0) {
    throw new Error('failure targetDomainIds is invalid')
  }
  value.targetDomainIds.forEach((id, index) => requiredString(id, `failure.targetDomainIds[${index}]`))
  requiredDate(value.startedAt, 'failure.startedAt')
  requiredDate(value.endedAt, 'failure.endedAt')
  if (typeof value.simulated !== 'boolean') throw new Error('failure.simulated must be boolean')
}

function validateMeter(value: unknown): void {
  if (!isRecord(value)) throw new Error('meter record must be an object')
  exactKeys(value, ['schema', 'sampleId', 'pilotId', 'domainId', 'measuredAt', 'metric', 'value', 'unit'], 'meter')
  if (value.schema !== 'MeterSampleV1') throw new Error('meter schema is invalid')
  for (const key of ['sampleId', 'pilotId', 'domainId', 'unit'] as const) requiredString(value[key], `meter.${key}`)
  requiredDate(value.measuredAt, 'meter.measuredAt')
  if (!['availability', 'latency_ms', 'requests', 'bytes', 'failovers'].includes(value.metric as string)) {
    throw new Error('meter metric is invalid')
  }
  requiredNumber(value.value, 'meter.value')
}

function validateInvoice(value: unknown): void {
  if (!isRecord(value)) throw new Error('invoice must be an object')
  exactKeys(value, ['schema', 'invoiceId', 'pilotId', 'billingPeriodStart', 'billingPeriodEnd', 'currency', 'lines', 'subtotal', 'sourceBillingRefs'], 'invoice')
  if (value.schema !== 'InvoiceV1') throw new Error('invoice schema is invalid')
  for (const key of ['invoiceId', 'pilotId'] as const) requiredString(value[key], `invoice.${key}`)
  requiredDate(value.billingPeriodStart, 'invoice.billingPeriodStart')
  requiredDate(value.billingPeriodEnd, 'invoice.billingPeriodEnd')
  if (typeof value.currency !== 'string' || !/^[A-Z]{3}$/u.test(value.currency)) throw new Error('invoice currency is invalid')
  requiredNumber(value.subtotal, 'invoice.subtotal')
  if (!Array.isArray(value.sourceBillingRefs) || !Array.isArray(value.lines)) throw new Error('invoice arrays are invalid')
  value.sourceBillingRefs.forEach((entry, index) => requiredString(entry, `invoice.sourceBillingRefs[${index}]`))
  for (const [index, line] of value.lines.entries()) {
    if (!isRecord(line)) throw new Error(`invoice.lines[${index}] must be an object`)
    exactKeys(line, ['domainId', 'meterMetric', 'quantity', 'unitPrice', 'amount'], `invoice.lines[${index}]`)
    requiredString(line.domainId, `invoice.lines[${index}].domainId`)
    requiredString(line.meterMetric, `invoice.lines[${index}].meterMetric`)
    requiredNumber(line.quantity, `invoice.lines[${index}].quantity`)
    requiredNumber(line.unitPrice, `invoice.lines[${index}].unitPrice`)
    requiredNumber(line.amount, `invoice.lines[${index}].amount`)
  }
}

function validatePublicEvidence(name: PublicEvidenceFile, value: unknown): void {
  switch (name) {
    case 'inventory.json':
      return validateInventory(value)
    case 'gate.json':
      return validateGate(value)
    case 'failures.ndjson':
      return validateFailure(value)
    case 'meter.ndjson':
      return validateMeter(value)
    case 'invoice.json':
      return validateInvoice(value)
  }
}

export class PublicEvidenceRedactor {
  readonly #salt: string

  constructor(salt: string) {
    if (salt.length < 8) throw new Error('redaction salt must contain at least 8 characters')
    this.#salt = salt
  }

  redact<T>(value: T): T {
    return this.#walk(value, '') as T
  }

  #walk(value: unknown, key: string): unknown {
    if (SENSITIVE_KEY.test(key) && typeof value === 'string') return this.#token(value)
    if (Array.isArray(value)) return value.map((item) => this.#walk(item, key))
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, this.#walk(child, childKey)]))
    if (typeof value !== 'string') return value
    let redacted = value
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/gu, (match) => this.#token(match))
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, (match) => this.#token(match))
      .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/giu, (match) => `Bearer ${this.#token(match)}`)
    for (const pattern of SENSITIVE_VALUE) redacted = redacted.replace(pattern, (match) => this.#token(match))
    return redacted
  }

  #token(value: string): string {
    const digest = createHash('sha256').update(this.#salt).update('\0').update(value).digest('hex')
    return `[redacted:${digest.slice(0, 16)}]`
  }
}

export class AppendOnlyNdjsonWriter<T extends object> {
  readonly #path: string
  readonly #redactor: PublicEvidenceRedactor
  #chain: Promise<void> = Promise.resolve()

  constructor(path: string, redactor: PublicEvidenceRedactor) {
    this.#path = path
    this.#redactor = redactor
  }

  append(record: T): Promise<void> {
    const line = `${JSON.stringify(this.#redactor.redact(record))}\n`
    this.#chain = this.#chain.then(async () => {
      await mkdir(resolve(this.#path, '..'), { recursive: true })
      await appendFile(this.#path, line, { encoding: 'utf8', flag: 'a' })
    })
    return this.#chain
  }

  flush(): Promise<void> {
    return this.#chain
  }
}

async function regularFile(path: string): Promise<void> {
  const metadata = await lstat(path)
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`evidence path must be a regular file: ${path}`)
}

async function safeBundlePath(root: string, file: string): Promise<string> {
  if (!PUBLIC_EVIDENCE_FILES.includes(file as PublicEvidenceFile) && file !== 'manifest.json') {
    throw new Error(`unsupported bundle path: ${file}`)
  }
  const canonicalRoot = await realpath(root)
  const candidate = resolve(canonicalRoot, file)
  if (!candidate.startsWith(`${canonicalRoot}${sep}`)) throw new Error(`unsafe bundle path: ${file}`)
  await regularFile(candidate)
  const canonicalCandidate = await realpath(candidate)
  if (!canonicalCandidate.startsWith(`${canonicalRoot}${sep}`)) throw new Error(`symlink escapes bundle root: ${file}`)
  return canonicalCandidate
}

async function sha256File(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function parseEvidenceFile(name: PublicEvidenceFile, path: string): Promise<{ records?: number }> {
  const text = await readFile(path, 'utf8')
  if (name.endsWith('.ndjson')) {
    const rows = text.split('\n').filter((line) => line.length > 0)
    for (const [index, row] of rows.entries()) {
      try {
        validatePublicEvidence(name, JSON.parse(row))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`${name}:${index + 1}: ${message}`)
      }
    }
    return { records: rows.length }
  }
  validatePublicEvidence(name, JSON.parse(text))
  return {}
}

async function describeFile(root: string, name: PublicEvidenceFile): Promise<EvidenceFileV1> {
  const path = await safeBundlePath(root, name)
  const parsed = await parseEvidenceFile(name, path)
  const base = { path: name, sha256: await sha256File(path), bytes: (await stat(path)).size }
  return parsed.records === undefined ? base : { ...base, records: parsed.records }
}

export interface BuildBundleOptions {
  sourceDir: string
  outputDir: string
  pilotId: string
  gate: PilotGateSnapshotV1
  simulationOnly: boolean
  redactor: PublicEvidenceRedactor
}

export async function buildPublicEvidenceBundle(options: BuildBundleOptions): Promise<EvidenceManifestV1> {
  validateGate(options.gate)
  const sourceEntries = await readdir(options.sourceDir)
  const allowed = new Set<string>(PUBLIC_EVIDENCE_FILES)
  if (sourceEntries.length !== allowed.size || sourceEntries.some((entry) => !allowed.has(entry))) {
    throw new Error('source evidence must contain exactly the required public evidence files')
  }
  await mkdir(options.outputDir, { recursive: false })
  for (const name of PUBLIC_EVIDENCE_FILES) {
    const sourcePath = await safeBundlePath(options.sourceDir, name)
    const text = await readFile(sourcePath, 'utf8')
    const outputPath = join(options.outputDir, name)
    if (name.endsWith('.ndjson')) {
      const rows = text
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => {
          const value = JSON.parse(line)
          validatePublicEvidence(name, value)
          const redacted = options.redactor.redact(value)
          validatePublicEvidence(name, redacted)
          return JSON.stringify(redacted)
        })
      await writeFile(outputPath, `${rows.join('\n')}\n`, { encoding: 'utf8', flag: 'wx' })
    } else {
      const value = JSON.parse(text)
      validatePublicEvidence(name, value)
      const redacted = options.redactor.redact(value)
      validatePublicEvidence(name, redacted)
      await writeFile(outputPath, `${JSON.stringify(redacted, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    }
  }

  const files = await Promise.all(PUBLIC_EVIDENCE_FILES.map((name) => describeFile(options.outputDir, name)))
  const manifest: EvidenceManifestV1 = {
    schema: 'EvidenceManifestV1',
    schemaVersion: PILOT_SCHEMA_VERSION,
    pilotId: options.pilotId,
    createdAt: new Date().toISOString(),
    publicBundle: true,
    simulationOnly: options.simulationOnly,
    files,
    gate: options.gate,
  }
  const manifestPath = join(options.outputDir, 'manifest.json')
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  const manifestFile = { path: 'manifest.json', sha256: await sha256File(manifestPath), bytes: (await stat(manifestPath)).size }
  const indexedFiles: Array<{ path: string; sha256: string; bytes: number; records?: number }> = [...files, manifestFile]
  const index = indexedFiles
    .map((file) => `${file.sha256}  ${file.bytes}  ${file.records ?? '-'}  ${file.path}`)
    .join('\n')
  await writeFile(join(options.outputDir, 'SHA256SUMS'), `${index}\n`, { encoding: 'utf8', flag: 'wx' })
  return manifest
}

function validateManifest(value: unknown): asserts value is EvidenceManifestV1 {
  if (!isRecord(value)) throw new Error('manifest must be an object')
  exactKeys(value, ['schema', 'schemaVersion', 'pilotId', 'createdAt', 'publicBundle', 'simulationOnly', 'files', 'gate'], 'manifest')
  if (value.schema !== 'EvidenceManifestV1' || value.schemaVersion !== PILOT_SCHEMA_VERSION || value.publicBundle !== true) {
    throw new Error('invalid EvidenceManifestV1')
  }
  requiredString(value.pilotId, 'manifest.pilotId')
  requiredDate(value.createdAt, 'manifest.createdAt')
  if (typeof value.simulationOnly !== 'boolean') throw new Error('manifest.simulationOnly must be boolean')
  validateGate(value.gate)
  if (!Array.isArray(value.files) || value.files.length !== PUBLIC_EVIDENCE_FILES.length) {
    throw new Error('manifest must contain all required evidence files')
  }
  const names = new Set<string>()
  for (const file of value.files) {
    if (!isRecord(file)) throw new Error('manifest file must be an object')
    exactKeys(file, file.records === undefined ? ['path', 'sha256', 'bytes'] : ['path', 'sha256', 'bytes', 'records'], 'manifest file')
    requiredString(file.path, 'manifest file path')
    if (!PUBLIC_EVIDENCE_FILES.includes(file.path as PublicEvidenceFile) || names.has(file.path)) {
      throw new Error('manifest evidence paths are invalid or duplicate')
    }
    names.add(file.path)
    if (typeof file.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(file.sha256)) throw new Error('manifest hash is invalid')
    requiredInteger(file.bytes, 'manifest file bytes')
    if (file.records !== undefined) requiredInteger(file.records, 'manifest file records')
  }
  if (PUBLIC_EVIDENCE_FILES.some((name) => !names.has(name))) throw new Error('manifest is missing required evidence')
}

export async function verifyPublicEvidenceBundle(bundleDir: string): Promise<EvidenceManifestV1> {
  const manifestPath = await safeBundlePath(bundleDir, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as EvidenceManifestV1
  validateManifest(manifest)
  const indexPath = join(await realpath(bundleDir), 'SHA256SUMS')
  await regularFile(indexPath)
  const indexText = await readFile(indexPath, 'utf8')
  const indexed = new Map<string, { hash: string; bytes: number }>()
  for (const line of indexText.trim().split('\n')) {
    const match = /^([0-9a-f]{64}) {2}(\d+) {2}(?:\d+|-) {2}([A-Za-z0-9._-]+)$/u.exec(line)
    if (match === null || indexed.has(match[3] as string)) throw new Error(`invalid SHA256SUMS line: ${line}`)
    indexed.set(match[3] as string, { hash: match[1] as string, bytes: Number(match[2]) })
  }
  const expectedNames = [...PUBLIC_EVIDENCE_FILES, 'manifest.json']
  if (indexed.size !== expectedNames.length || expectedNames.some((name) => !indexed.has(name))) {
    throw new Error('SHA256SUMS is incomplete')
  }
  for (const file of [...manifest.files, { path: 'manifest.json' }]) {
    const expected = indexed.get(file.path)
    if (expected === undefined) throw new Error(`missing index entry: ${file.path}`)
    const path = await safeBundlePath(bundleDir, file.path)
    const actualHash = await sha256File(path)
    const actualBytes = (await stat(path)).size
    if (actualHash !== expected.hash || actualBytes !== expected.bytes) {
      throw new Error(`evidence integrity mismatch: ${file.path}`)
    }
    if ('sha256' in file && (file.sha256 !== actualHash || file.bytes !== actualBytes)) {
      throw new Error(`manifest integrity mismatch: ${file.path}`)
    }
    if (file.path !== 'manifest.json') {
      const actual = await describeFile(bundleDir, file.path as PublicEvidenceFile)
      if ('records' in file && file.records !== actual.records) throw new Error(`manifest record count mismatch: ${file.path}`)
    }
  }
  return manifest
}
