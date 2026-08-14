import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { AppendOnlyNdjsonWriter, buildPublicEvidenceBundle, PublicEvidenceRedactor, verifyPublicEvidenceBundle } from './evidence.js'
import { PILOT_WINDOW_MS, PilotQualificationGate, WARMUP_WINDOW_MS } from './gate.js'
import { assertOperatorDomainPreflight } from './inventory.js'
import type {
  InvoiceV1,
  MeterSampleV1,
  OperatorDomainV1,
  PilotInventoryV1,
} from './model.js'
import { defaultDryRunScenarios, SimulationOnlyScenarioRunner } from './scenarios.js'

function dryRunDomains(): OperatorDomainV1[] {
  return Array.from({ length: 7 }, (_, index) => ({
    domainId: `failure-domain-${index + 1}`,
    operatorDomainId: `simulated-operator-${index + 1}`,
    operatorLegalName: `Simulated Operator ${index + 1}`,
    hostId: `simulation-host-${index + 1}`,
    provider: `simulation-provider-${index + 1}`,
    region: `sim-region-${index + 1}`,
    networkAsn: `AS65${String(index + 1).padStart(3, '0')}`,
    role: index < 5 ? 'active' : 'standby',
    billingRef: `simulation-bill-${index + 1}`,
  }))
}

export interface DryRunResult {
  pilotId: string
  sourceDir: string
  bundleDir: string
  samples: number
  /**
   * Confirms only that the gate arithmetic can accept a synthetic trace.
   * A dry-run never qualifies a real pilot, cost epoch, or production release.
   */
  simulatedQualificationValidated: boolean
  verifiedFiles: number
}

export async function runDryRunSimulation(outputRoot?: string): Promise<DryRunResult> {
  const root =
    outputRoot === undefined
      ? await mkdtemp(join(tmpdir(), 'conet-dle-pilot-'))
      : resolve(outputRoot)
  const sourceDir = join(root, 'source')
  const bundleDir = join(root, 'public-bundle')
  await mkdir(sourceDir, { recursive: true })
  const pilotId = `dry-run-${randomUUID()}`
  const inventory: PilotInventoryV1 = {
    schema: 'PilotInventoryV1',
    pilotId,
    generatedAt: new Date().toISOString(),
    domains: dryRunDomains(),
  }
  assertOperatorDomainPreflight(inventory)

  const redactor = new PublicEvidenceRedactor(`dry-run-${pilotId}`)
  await writeFile(
    join(sourceDir, 'inventory.json'),
    `${JSON.stringify(redactor.redact(inventory), null, 2)}\n`,
    'utf8',
  )
  const failureWriter = new AppendOnlyNdjsonWriter(join(sourceDir, 'failures.ndjson'), redactor)
  const meterWriter = new AppendOnlyNdjsonWriter<MeterSampleV1>(
    join(sourceDir, 'meter.ndjson'),
    redactor,
  )
  const runner = new SimulationOnlyScenarioRunner()
  const scenarios = defaultDryRunScenarios(inventory.domains.map((domain) => domain.domainId))
  for (const scenario of scenarios) {
    await failureWriter.append(await runner.run(pilotId, scenario))
  }
  for (const domain of inventory.domains) {
    await meterWriter.append({
      schema: 'MeterSampleV1',
      sampleId: randomUUID(),
      pilotId,
      domainId: domain.domainId,
      measuredAt: new Date().toISOString(),
      metric: 'availability',
      value: 1,
      unit: 'ratio',
    })
  }
  await Promise.all([failureWriter.flush(), meterWriter.flush()])

  const gate = new PilotQualificationGate(0)
  const pilotStart = WARMUP_WINDOW_MS
  gate.evaluate(pilotStart)
  gate.recordCounter('rotations', 100, pilotStart)
  gate.recordCounter('rehomes', 30, pilotStart)
  gate.recordCounter('takeovers', 100, pilotStart)
  const evaluation = gate.evaluate(pilotStart + PILOT_WINDOW_MS)
  if (!evaluation.qualified) throw new Error('dry-run qualification simulation failed')
  await writeFile(join(sourceDir, 'gate.json'), `${JSON.stringify(gate.snapshot(), null, 2)}\n`, 'utf8')

  const invoice: InvoiceV1 = {
    schema: 'InvoiceV1',
    invoiceId: `sim-${randomUUID()}`,
    pilotId,
    billingPeriodStart: new Date(0).toISOString(),
    billingPeriodEnd: new Date(PILOT_WINDOW_MS).toISOString(),
    currency: 'USD',
    lines: inventory.domains.map((domain) => ({
      domainId: domain.domainId,
      meterMetric: 'host-day',
      quantity: 30,
      unitPrice: 0,
      amount: 0,
    })),
    subtotal: 0,
    sourceBillingRefs: inventory.domains.map((domain) => domain.billingRef),
  }
  await writeFile(
    join(sourceDir, 'invoice.json'),
    `${JSON.stringify(redactor.redact(invoice), null, 2)}\n`,
    'utf8',
  )

  const manifest = await buildPublicEvidenceBundle({
    sourceDir,
    outputDir: bundleDir,
    pilotId,
    gate: gate.snapshot(),
    simulationOnly: true,
    redactor,
  })
  const verified = await verifyPublicEvidenceBundle(bundleDir)
  return {
    pilotId,
    sourceDir,
    bundleDir,
    samples: scenarios.length,
    simulatedQualificationValidated: evaluation.qualified,
    verifiedFiles: verified.files.length,
  }
}
