export const PILOT_SCHEMA_VERSION = 'conet.dle.pilot.v1' as const

export type DomainRole = 'active' | 'standby'

export interface OperatorDomainV1 {
  domainId: string
  operatorDomainId: string
  operatorLegalName: string
  hostId: string
  provider: string
  region: string
  networkAsn: string
  role: DomainRole
  billingRef: string
}

export interface PilotInventoryV1 {
  schema: 'PilotInventoryV1'
  pilotId: string
  generatedAt: string
  domains: OperatorDomainV1[]
}

export interface PreflightCheck {
  check: string
  ok: boolean
  detail: string
}

export interface OperatorDomainPreflightReport {
  ok: boolean
  activeCount: number
  standbyCount: number
  checks: PreflightCheck[]
}

export type FailureScenarioKind =
  | 'process-crash'
  | 'network-partition'
  | 'disk-corruption'
  | 'wal-corruption'
  | 'duplicate-message'
  | 'reorder-message'
  | 'stale-membership'
  | 'oracle-fault'
  | 'treasury-fault'
  | 'l1-reorg-simulation'

export interface FailureScenarioV1 {
  schema: 'FailureScenarioV1'
  id: string
  kind: FailureScenarioKind
  targetDomainIds: string[]
  durationMs: number
  parameters: Record<string, string | number | boolean>
  simulationOnly: true
  destructive: false
}

export type FailureSampleOutcome = 'contained' | 'recovered' | 'safety-failure'

export interface FailureSampleV1 {
  schema: 'FailureSampleV1'
  sampleId: string
  pilotId: string
  scenarioId: string
  scenarioKind: FailureScenarioKind
  targetDomainIds: string[]
  startedAt: string
  endedAt: string
  outcome: FailureSampleOutcome
  safetyInvariant: string
  observation: string
  simulated: boolean
}

export interface MeterSampleV1 {
  schema: 'MeterSampleV1'
  sampleId: string
  pilotId: string
  domainId: string
  measuredAt: string
  metric: 'availability' | 'latency_ms' | 'requests' | 'bytes' | 'failovers'
  value: number
  unit: string
}

export interface InvoiceLineV1 {
  domainId: string
  meterMetric: string
  quantity: number
  unitPrice: number
  amount: number
}

export interface InvoiceV1 {
  schema: 'InvoiceV1'
  invoiceId: string
  pilotId: string
  billingPeriodStart: string
  billingPeriodEnd: string
  currency: string
  lines: InvoiceLineV1[]
  subtotal: number
  sourceBillingRefs: string[]
}

export interface EvidenceFileV1 {
  path: string
  sha256: string
  bytes: number
  records?: number
}

export interface EvidenceManifestV1 {
  schema: 'EvidenceManifestV1'
  schemaVersion: typeof PILOT_SCHEMA_VERSION
  pilotId: string
  createdAt: string
  publicBundle: true
  simulationOnly: boolean
  files: EvidenceFileV1[]
  gate: PilotGateSnapshotV1
}

export interface PilotCountersV1 {
  rotations: number
  rehomes: number
  takeovers: number
}

export interface PilotGateSnapshotV1 {
  schema: 'PilotGateSnapshotV1'
  epoch: number
  warmupStartedAt: string
  pilotStartedAt: string | null
  lastSafetyFailureAt: string | null
  resetCount: number
  counters: PilotCountersV1
}
