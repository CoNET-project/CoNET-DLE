import { createHash, randomUUID } from 'node:crypto'
import type {
  FailureSampleOutcome,
  FailureSampleV1,
  FailureScenarioKind,
  FailureScenarioV1,
} from './model.js'

export const FAILURE_SCENARIO_KINDS: readonly FailureScenarioKind[] = [
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
]

export function parseFailureScenarioDsl(source: string): FailureScenarioV1[] {
  const parsed: unknown = JSON.parse(source)
  if (!Array.isArray(parsed)) throw new Error('scenario DSL root must be an array')
  return parsed.map((value, index) => assertFailureScenario(value, index))
}

function assertFailureScenario(value: unknown, index: number): FailureScenarioV1 {
  if (typeof value !== 'object' || value === null) throw new Error(`scenario[${index}] must be an object`)
  const row = value as Record<string, unknown>
  if (row.schema !== 'FailureScenarioV1') throw new Error(`scenario[${index}] has invalid schema`)
  if (typeof row.id !== 'string' || row.id.length === 0) throw new Error(`scenario[${index}] needs id`)
  if (!FAILURE_SCENARIO_KINDS.includes(row.kind as FailureScenarioKind)) {
    throw new Error(`scenario[${index}] has unsupported kind`)
  }
  if (!Array.isArray(row.targetDomainIds) || row.targetDomainIds.length === 0) {
    throw new Error(`scenario[${index}] needs targets`)
  }
  if (!row.targetDomainIds.every((target) => typeof target === 'string' && target.length > 0)) {
    throw new Error(`scenario[${index}] has invalid target`)
  }
  if (typeof row.durationMs !== 'number' || row.durationMs < 0) {
    throw new Error(`scenario[${index}] has invalid durationMs`)
  }
  if (row.simulationOnly !== true || row.destructive !== false) {
    throw new Error(`scenario[${index}] must be simulationOnly and non-destructive`)
  }
  if (typeof row.parameters !== 'object' || row.parameters === null || Array.isArray(row.parameters)) {
    throw new Error(`scenario[${index}] has invalid parameters`)
  }
  return row as unknown as FailureScenarioV1
}

export function defaultDryRunScenarios(domainIds: readonly string[]): FailureScenarioV1[] {
  if (domainIds.length !== 7) throw new Error('dry-run scenarios require seven domains')
  return FAILURE_SCENARIO_KINDS.map((kind, index) => ({
    schema: 'FailureScenarioV1',
    id: `dry-${String(index + 1).padStart(2, '0')}-${kind}`,
    kind,
    targetDomainIds: [domainIds[index % domainIds.length] as string],
    durationMs: 1_000,
    parameters: scenarioDefaults(kind),
    simulationOnly: true,
    destructive: false,
  }))
}

function scenarioDefaults(kind: FailureScenarioKind): Record<string, string | number | boolean> {
  switch (kind) {
    case 'process-crash':
      return { exitCode: 137 }
    case 'network-partition':
      return { lossPercent: 100, direction: 'bidirectional' }
    case 'disk-corruption':
      return { affectedBlocks: 1, syntheticBytes: true }
    case 'wal-corruption':
      return { affectedRecords: 1, syntheticBytes: true }
    case 'duplicate-message':
      return { duplicateCount: 2 }
    case 'reorder-message':
      return { reorderWindow: 3 }
    case 'stale-membership':
      return { staleEpochs: 2 }
    case 'oracle-fault':
      return { priceDeviationBps: 500 }
    case 'treasury-fault':
      return { rejectSettlement: true }
    case 'l1-reorg-simulation':
      return { depth: 2, syntheticChain: true }
  }
}

export class SimulationOnlyScenarioRunner {
  async run(
    pilotId: string,
    scenario: FailureScenarioV1,
    outcome: FailureSampleOutcome = 'recovered',
  ): Promise<FailureSampleV1> {
    if (!scenario.simulationOnly || scenario.destructive) {
      throw new Error('runner refuses non-simulation or destructive scenarios')
    }
    const startedAt = new Date().toISOString()
    const digest = createHash('sha256').update(JSON.stringify(scenario)).digest('hex').slice(0, 16)
    await Promise.resolve()
    return {
      schema: 'FailureSampleV1',
      sampleId: randomUUID(),
      pilotId,
      scenarioId: scenario.id,
      scenarioKind: scenario.kind,
      targetDomainIds: [...scenario.targetDomainIds],
      startedAt,
      endedAt: new Date().toISOString(),
      outcome,
      safetyInvariant: outcome === 'safety-failure' ? 'synthetic invariant breach' : 'no unsafe state committed',
      observation: `simulation digest=${digest}; no infrastructure action executed`,
      simulated: true,
    }
  }
}
