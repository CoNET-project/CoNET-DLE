#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import {
  buildPublicEvidenceBundle,
  PublicEvidenceRedactor,
  verifyPublicEvidenceBundle,
} from './evidence.js'
import { preflightOperatorDomains } from './inventory.js'
import {
  acceptArchiveRuntime,
  acceptOnDemandRuntime,
  deployArchiveRuntime,
  deployIsolatedLab,
  deployOnDemandHttpClients,
  injectIsolatedProcessCrash,
  labCorrelationReport,
  loadOfficialLabInventory,
  startOfficialWarmup,
  statusIsolatedLab,
} from './lab.js'
import type { PilotGateSnapshotV1, PilotInventoryV1 } from './model.js'
import { runDryRunSimulation } from './simulation.js'

function flags(args: string[]): Map<string, string> {
  const result = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (key === undefined || value === undefined || !key.startsWith('--')) {
      throw new Error(`invalid argument near ${key ?? '<end>'}`)
    }
    result.set(key.slice(2), value)
  }
  return result
}

function required(input: Map<string, string>, key: string): string {
  const value = input.get(key)
  if (value === undefined || value.length === 0) throw new Error(`missing --${key}`)
  return value
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2)
  const input = flags(rest)
  switch (command) {
    case 'preflight': {
      const inventory = JSON.parse(
        await readFile(required(input, 'inventory'), 'utf8'),
      ) as PilotInventoryV1
      const report = preflightOperatorDomains(inventory)
      process.stdout.write(`${JSON.stringify({ ok: report.ok, command, report }, null, 2)}\n`)
      if (!report.ok) process.exitCode = 2
      return
    }
    case 'dry-run': {
      const output = input.get('output')
      const result = await runDryRunSimulation(output)
      process.stdout.write(`${JSON.stringify({ ok: true, command, ...result }, null, 2)}\n`)
      return
    }
    case 'bundle': {
      const gate = JSON.parse(
        await readFile(required(input, 'gate'), 'utf8'),
      ) as PilotGateSnapshotV1
      const pilotId = required(input, 'pilot-id')
      const manifest = await buildPublicEvidenceBundle({
        sourceDir: required(input, 'source'),
        outputDir: required(input, 'output'),
        pilotId,
        gate,
        simulationOnly: input.get('simulation-only') === 'true',
        redactor: new PublicEvidenceRedactor(input.get('redaction-salt') ?? pilotId),
      })
      process.stdout.write(`${JSON.stringify({ ok: true, command, manifest }, null, 2)}\n`)
      return
    }
    case 'verify': {
      const manifest = await verifyPublicEvidenceBundle(required(input, 'bundle'))
      process.stdout.write(
        `${JSON.stringify({ ok: true, command, pilotId: manifest.pilotId, files: manifest.files.length }, null, 2)}\n`,
      )
      return
    }
    case 'lab-preflight': {
      const inventory = await loadOfficialLabInventory(input.get('inventory'))
      const report = preflightOperatorDomains(inventory)
      const correlation = labCorrelationReport(inventory)
      process.stdout.write(`${JSON.stringify({ ok: report.ok, command, report, correlation }, null, 2)}\n`)
      if (!report.ok) process.exitCode = 2
      return
    }
    case 'lab-deploy': {
      const result = await deployIsolatedLab()
      process.stdout.write(`${JSON.stringify({ command, ...result }, null, 2)}\n`)
      if (!result.ok) process.exitCode = 2
      return
    }
    case 'lab-deploy-archive': {
      const result = await deployArchiveRuntime()
      process.stdout.write(`${JSON.stringify({ command, ...result }, null, 2)}\n`)
      if (!result.ok) process.exitCode = 2
      return
    }
    case 'lab-accept-archive': {
      const result = await acceptArchiveRuntime()
      process.stdout.write(`${JSON.stringify({ command, ...result }, null, 2)}\n`)
      if (!result.ok) process.exitCode = 2
      return
    }
    case 'lab-accept-ondemand': {
      const result = await acceptOnDemandRuntime()
      process.stdout.write(`${JSON.stringify({ command, ...result }, null, 2)}\n`)
      if (!result.ok) process.exitCode = 2
      return
    }
    case 'lab-deploy-ondemand-http-clients': {
      const result = await deployOnDemandHttpClients()
      process.stdout.write(`${JSON.stringify({ command, ...result }, null, 2)}\n`)
      if (!result.ok) process.exitCode = 2
      return
    }
    case 'lab-status': {
      const rows = await statusIsolatedLab()
      process.stdout.write(`${JSON.stringify({ ok: true, command, rows }, null, 2)}\n`)
      return
    }
    case 'lab-warmup': {
      const started = await startOfficialWarmup(input.get('evidence'))
      process.stdout.write(`${JSON.stringify({ ok: true, command, ...started }, null, 2)}\n`)
      return
    }
    case 'lab-inject-crash': {
      const result = await injectIsolatedProcessCrash(required(input, 'domain'))
      process.stdout.write(`${JSON.stringify({ command, ...result }, null, 2)}\n`)
      if (!result.ok) process.exitCode = 2
      return
    }
    default:
      throw new Error(
        'usage: cli preflight --inventory FILE | dry-run [--output DIR] | bundle --source DIR --output DIR --pilot-id ID --gate FILE [--simulation-only true] [--redaction-salt SALT] | verify --bundle DIR | lab-preflight [--inventory FILE] | lab-deploy | lab-deploy-archive | lab-accept-archive | lab-accept-ondemand | lab-deploy-ondemand-http-clients | lab-status | lab-warmup [--evidence DIR] | lab-inject-crash --domain ID',
      )
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`pilot CLI failed: ${message}\n`)
  process.exitCode = 1
})
