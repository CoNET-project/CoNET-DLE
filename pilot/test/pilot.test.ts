import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { verifyPublicEvidenceBundle } from '../src/evidence.js'
import { PILOT_WINDOW_MS, PilotQualificationGate, WARMUP_WINDOW_MS } from '../src/gate.js'
import { preflightOperatorDomains } from '../src/inventory.js'
import type { OperatorDomainV1, PilotInventoryV1 } from '../src/model.js'
import { defaultDryRunScenarios, SimulationOnlyScenarioRunner } from '../src/scenarios.js'
import { SerialPilotScheduler } from '../src/scheduler.js'
import { labCorrelationReport, loadOfficialLabInventory } from '../src/lab.js'
import { runDryRunSimulation } from '../src/simulation.js'

function domains(): OperatorDomainV1[] {
  return Array.from({ length: 7 }, (_, index) => ({
    domainId: `domain-${index}`,
    operatorDomainId: `operator-${index}`,
    operatorLegalName: `Operator ${index}`,
    hostId: `host-${index}`,
    provider: `provider-${index}`,
    region: `region-${index}`,
    networkAsn: `AS${65000 + index}`,
    role: index < 5 ? 'active' : 'standby',
    billingRef: `bill-${index}`,
  }))
}

function inventory(): PilotInventoryV1 {
  return {
    schema: 'PilotInventoryV1',
    pilotId: 'test-pilot',
    generatedAt: new Date().toISOString(),
    domains: domains(),
  }
}

test('official 2026-08 seven-host inventory passes 5+2 preflight', async () => {
  const official = await loadOfficialLabInventory()
  const report = preflightOperatorDomains(official)
  assert.equal(report.ok, true)
  assert.equal(official.domains.filter((domain) => domain.role === 'active').length, 5)
  assert.equal(official.domains.filter((domain) => domain.role === 'standby').length, 2)
  const correlation = labCorrelationReport(official)
  assert.equal(correlation.every((note) => note.ok), true)
  assert.match(correlation.find((note) => note.check === 'asn-diversity-honest')?.detail ?? '', /AS8560/u)
  assert.equal(
    official.domains.every((domain) => domain.billingRef.startsWith('usd-4-unmetered-')),
    true,
  )
})

test('official lab invoice is USD 4 per host-month with unmetered traffic', async () => {
  const invoicePath = join(
    fileURLToPath(new URL('../../evidence/conet-dle-30d-lab-2026-08/invoice.json', import.meta.url)),
  )
  const invoice = JSON.parse(await readFile(invoicePath, 'utf8')) as {
    schema: string
    currency: string
    subtotal: number
    lines: Array<{ meterMetric: string; unitPrice: number; amount: number }>
    sourceBillingRefs: string[]
  }
  assert.equal(invoice.schema, 'InvoiceV1')
  assert.equal(invoice.currency, 'USD')
  assert.equal(invoice.subtotal, 28)
  const hostMonth = invoice.lines.filter((line) => line.meterMetric === 'host-month')
  const traffic = invoice.lines.filter((line) => line.meterMetric === 'unmetered-traffic')
  assert.equal(hostMonth.length, 7)
  assert.equal(traffic.length, 7)
  assert.equal(hostMonth.every((line) => line.unitPrice === 4 && line.amount === 4), true)
  assert.equal(traffic.every((line) => line.unitPrice === 0 && line.amount === 0), true)
  assert.equal(invoice.sourceBillingRefs.length, 7)
})

test('OperatorDomain preflight enforces seven independent 5+2 domains', () => {
  assert.equal(preflightOperatorDomains(inventory()).ok, true)
  const invalid = inventory()
  const first = invalid.domains[0]
  const second = invalid.domains[1]
  assert.ok(first && second)
  second.operatorDomainId = first.operatorDomainId
  const report = preflightOperatorDomains(invalid)
  assert.equal(report.ok, false)
  assert.equal(report.checks.find((check) => check.check === 'unique-operatorDomainId')?.ok, false)
})

test('serial scheduler never overlaps and preserves five active plus two standby', async () => {
  let concurrent = 0
  let maximumConcurrent = 0
  let ticks = 0
  let finish: (() => void) | undefined
  const done = new Promise<void>((resolve) => {
    finish = resolve
  })
  const scheduler = new SerialPilotScheduler(domains(), 1, async () => {
    concurrent += 1
    maximumConcurrent = Math.max(maximumConcurrent, concurrent)
    await new Promise<void>((resolve) => setTimeout(resolve, 3))
    concurrent -= 1
    ticks += 1
    if (ticks === 4) {
      scheduler.stop()
      finish?.()
    }
  })
  scheduler.start()
  await done
  await scheduler.waitForIdle()
  assert.equal(maximumConcurrent, 1)
  assert.equal(scheduler.topology.active.length, 5)
  assert.equal(scheduler.topology.standby.length, 2)
  const failed = scheduler.topology.active[0]
  assert.ok(failed)
  const takeover = scheduler.simulateTakeover(failed.domainId)
  assert.notEqual(takeover.promoted, takeover.demoted)
  assert.equal(scheduler.topology.active.length, 5)
  assert.equal(scheduler.topology.standby.length, 2)
})

test('scheduler rejects a topology that only appears to be 5+2', () => {
  const invalid = domains()
  const first = invalid[0]
  const second = invalid[1]
  assert.ok(first && second)
  second.hostId = first.hostId
  assert.throws(
    () => new SerialPilotScheduler(invalid, 1, async () => undefined),
    /OperatorDomain preflight failed/u,
  )
})

test('72h warmup, 30-day window, counters, and safety reset are strict', () => {
  const gate = new PilotQualificationGate(0)
  assert.equal(gate.evaluate(WARMUP_WINDOW_MS - 1).pilotRunning, false)
  assert.equal(gate.evaluate(WARMUP_WINDOW_MS).pilotRunning, true)
  gate.recordCounter('rotations', 100, WARMUP_WINDOW_MS)
  gate.recordCounter('rehomes', 30, WARMUP_WINDOW_MS)
  gate.recordCounter('takeovers', 100, WARMUP_WINDOW_MS)
  assert.equal(gate.evaluate(WARMUP_WINDOW_MS + PILOT_WINDOW_MS - 1).qualified, false)
  assert.equal(gate.evaluate(WARMUP_WINDOW_MS + PILOT_WINDOW_MS).qualified, true)
  const reset = gate.recordSafetyFailure(WARMUP_WINDOW_MS + PILOT_WINDOW_MS + 1)
  assert.equal(reset.epoch, 2)
  assert.equal(reset.pilotStartedAt, null)
  assert.deepEqual(reset.counters, { rotations: 0, rehomes: 0, takeovers: 0 })
  assert.equal(gate.evaluate(WARMUP_WINDOW_MS + PILOT_WINDOW_MS + 1).qualified, false)
  assert.throws(() => gate.recordSafetyFailure(WARMUP_WINDOW_MS), /monotonic/u)
})

test('failure DSL catalog executes only synthetic non-destructive samples', async () => {
  const scenarios = defaultDryRunScenarios(domains().map((domain) => domain.domainId))
  assert.equal(scenarios.length, 10)
  assert.equal(new Set(scenarios.map((scenario) => scenario.kind)).size, 10)
  const runner = new SimulationOnlyScenarioRunner()
  for (const scenario of scenarios) {
    const sample = await runner.run('test-pilot', scenario)
    assert.equal(sample.simulated, true)
    assert.match(sample.observation, /no infrastructure action executed/u)
  }
})

test('public evidence requires the allowlisted schema, redacts, verifies, and detects tampering', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pilot-evidence-test-'))
  const result = await runDryRunSimulation(join(root, 'run'))
  const publicInventory = await readFile(join(result.bundleDir, 'inventory.json'), 'utf8')
  assert.doesNotMatch(publicInventory, /simulation-host|simulation-bill|Simulated Operator/u)
  await verifyPublicEvidenceBundle(result.bundleDir)
  const failurePath = join(result.bundleDir, 'failures.ndjson')
  await writeFile(failurePath, `${await readFile(failurePath, 'utf8')}{"tampered":true}\n`, 'utf8')
  await assert.rejects(verifyPublicEvidenceBundle(result.bundleDir), /integrity mismatch/u)
})

test('full dry-run produces a verified public bundle without infrastructure access', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pilot-dry-run-test-'))
  const result = await runDryRunSimulation(join(root, 'run'))
  assert.equal(result.samples, 10)
  assert.equal(result.simulatedQualificationValidated, true)
  assert.ok(result.verifiedFiles >= 5)
})
