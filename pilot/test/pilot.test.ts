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
import {
  FD01_DOMAIN_ID,
  FD01_SSH_HOST,
  FD03_DOMAIN_ID,
  FD03_SSH_HOST,
  FD06_DOMAIN_ID,
  FD06_SSH_HOST,
  FD07_DOMAIN_ID,
  FD07_SSH_HOST,
  OFFICIAL_SEVEN_DOMAIN_IDS,
  OPERATOR_INVENTORY_FREEZE_SCHEMA,
  OPERATOR_PILOT_CLOCK_SCHEMA,
  openOfficialPilotClock,
  operatorInventoryFreezeRemoteDocument,
  operatorPilotClockRemoteDocument,
  startOfficialWarmup,
  REMAP_KEEP_FD06_DOMAIN_IDS,
  REMAP_PEER_REFRESH_AFTER_FD06_DOMAIN_IDS,
  G1_SYNC_JOIN_KEEPER_DOMAIN_IDS,
  assertMvpSshHostAllowed,
  G1_SYNC_JOIN_REQUIRED_ACTIVE_WIPE,
  P11_JOINER_DOMAIN_ID,
  P11_JOINER_SSH_HOST,
  agentConfigFor,
  agentConfigForJoiner,
  labCorrelationReport,
  loadLabHosts,
  loadOfficialLabInventory,
  p11JoinerHost,
  p11JoinerPeer,
  REMAP_KEEP_L2_DOMAIN_IDS,
  REMAP_PEER_REFRESH_DOMAIN_IDS,
  selectLabKeepHosts,
  pickRandomWipeJoiners,
  resolveWipeJoinDomainIds,
} from '../src/lab.js'
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

const LIVE_WARMUP = '2026-08-14T17:10:16.786Z'
const LIVE_PILOT_MS = Date.parse('2026-08-18T09:00:00.000Z')

function cleanGateSnapshot(pilotStartedAt: string | null = null) {
  return {
    schema: 'PilotGateSnapshotV1' as const,
    epoch: 1,
    warmupStartedAt: LIVE_WARMUP,
    pilotStartedAt,
    lastSafetyFailureAt: null,
    resetCount: 0,
    counters: { rotations: 0, rehomes: 0, takeovers: 0 },
  }
}

test('fromSnapshot startPilotClock stamps after warmup and does not overwrite', () => {
  const first = PilotQualificationGate.fromSnapshot(cleanGateSnapshot()).startPilotClock(LIVE_PILOT_MS)
  assert.equal(first.warmupStartedAt, LIVE_WARMUP)
  assert.equal(first.pilotStartedAt, new Date(LIVE_PILOT_MS).toISOString())
  const again = PilotQualificationGate.fromSnapshot(first).startPilotClock(LIVE_PILOT_MS + 60_000)
  assert.equal(again.pilotStartedAt, first.pilotStartedAt)
  assert.deepEqual(again.counters, { rotations: 0, rehomes: 0, takeovers: 0 })
})

test('startPilotClock refuses an incomplete warmup', () => {
  const gate = new PilotQualificationGate(0)
  assert.throws(() => gate.startPilotClock(WARMUP_WINDOW_MS - 1), /warmup window is not complete/u)
})

test('startOfficialWarmup refuses to reset a clean existing gate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pilot-warmup-'))
  await writeFile(join(root, 'gate.json'), `${JSON.stringify(cleanGateSnapshot(), null, 2)}\n`)
  await assert.rejects(startOfficialWarmup(root), /already recorded/u)
  const kept = JSON.parse(await readFile(join(root, 'gate.json'), 'utf8')) as { warmupStartedAt: string }
  assert.equal(kept.warmupStartedAt, LIVE_WARMUP)
})

test('operator pilot clock document is not qualification', () => {
  const document = JSON.parse(
    operatorPilotClockRemoteDocument({
      warmupStartedAt: LIVE_WARMUP,
      pilotStartedAt: '2026-08-18T09:00:00.000Z',
      epoch: 1,
      resetCount: 0,
      counters: { rotations: 0, rehomes: 0, takeovers: 0 },
    }),
  ) as {
    schema: string
    clockIsNotQualification: boolean
    notThirtyDayQualification: boolean
    pilotStartedAt: string
  }
  assert.equal(document.schema, OPERATOR_PILOT_CLOCK_SCHEMA)
  assert.equal(document.clockIsNotQualification, true)
  assert.equal(document.notThirtyDayQualification, true)
  assert.equal(document.pilotStartedAt, '2026-08-18T09:00:00.000Z')
})

test('openOfficialPilotClock stamps a temp gate and is idempotent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pilot-clock-'))
  await writeFile(join(root, 'gate.json'), `${JSON.stringify(cleanGateSnapshot(), null, 2)}\n`)
  const first = await openOfficialPilotClock({ evidenceDir: root, atMs: LIVE_PILOT_MS })
  assert.equal(first.stamp.warmupStartedAt, LIVE_WARMUP)
  assert.equal(first.stamp.pilotStartedAt, new Date(LIVE_PILOT_MS).toISOString())
  const second = await openOfficialPilotClock({ evidenceDir: root, atMs: LIVE_PILOT_MS + 1_000 })
  assert.equal(second.stamp.pilotStartedAt, first.stamp.pilotStartedAt)
  const persisted = JSON.parse(await readFile(join(root, 'gate.json'), 'utf8')) as { pilotStartedAt: string }
  assert.equal(persisted.pilotStartedAt, first.stamp.pilotStartedAt)
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

test('MVP official seven remap fd-01, fd-03, and fd-06 and exclude leftover IPs', async () => {
  const inventory = await loadOfficialLabInventory()
  const hosts = await loadLabHosts()
  const fd01 = hosts.hosts.find((host) => host.domainId === FD01_DOMAIN_ID)
  const fd03 = hosts.hosts.find((host) => host.domainId === FD03_DOMAIN_ID)
  const fd06 = hosts.hosts.find((host) => host.domainId === FD06_DOMAIN_ID)
  assert.notEqual(fd01?.retired, true)
  assert.equal(fd01?.sshHost, FD01_SSH_HOST)
  assert.notEqual(fd03?.retired, true)
  assert.equal(fd03?.sshHost, FD03_SSH_HOST)
  assert.notEqual(fd06?.retired, true)
  assert.equal(fd06?.sshHost, FD06_SSH_HOST)
  assert.equal(fd06?.leftoverElCl, false)
  assert.equal(
    hosts.hosts.some(
      (host) =>
        host.sshHost === '74.208.224.45' ||
        host.sshHost === '198.251.77.98' ||
        host.sshHost === '216.225.193.174',
    ),
    false,
  )
  assert.equal(
    inventory.domains.some((domain) =>
      /74\.208\.224\.45|74-208-224-45|198\.251\.77\.98|198-251-77-98|216\.225\.193\.174|216-225-193-174/u.test(
        JSON.stringify(domain),
      ),
    ),
    false,
  )
  assert.equal(/RETIRED/i.test(inventory.domains.find((domain) => domain.domainId === FD01_DOMAIN_ID)?.operatorLegalName ?? ''), false)
  assert.equal(/RETIRED/i.test(inventory.domains.find((domain) => domain.domainId === FD03_DOMAIN_ID)?.operatorLegalName ?? ''), false)
  assert.equal(/RETIRED/i.test(inventory.domains.find((domain) => domain.domainId === FD06_DOMAIN_ID)?.operatorLegalName ?? ''), false)
  assert.equal(inventory.domains.find((domain) => domain.domainId === FD06_DOMAIN_ID)?.hostId.includes('70-35-205-77'), true)
  assert.match(
    JSON.stringify(inventory.domains.find((domain) => domain.domainId === FD06_DOMAIN_ID)),
    /0xb25932EBB7460B40741aA9431798b0f18331fE7a/u,
  )
  assert.throws(() => assertMvpSshHostAllowed('74.208.224.45'), /excludes retired SSH host/u)
  assert.doesNotThrow(() => assertMvpSshHostAllowed(FD01_SSH_HOST))
  assert.throws(() => assertMvpSshHostAllowed('198.251.77.98'), /excludes retired SSH host/u)
  assert.doesNotThrow(() => assertMvpSshHostAllowed(FD03_SSH_HOST))
  assert.throws(() => assertMvpSshHostAllowed('216.225.193.174'), /excludes retired SSH host/u)
  assert.doesNotThrow(() => assertMvpSshHostAllowed(FD06_SSH_HOST))
  const fd01Config = agentConfigFor(inventory, hosts, FD01_DOMAIN_ID)
  const fd01Peers = fd01Config.peers as Array<{ host: string }>
  assert.equal(fd01Peers.some((peer) => peer.host === '74.208.224.45'), false)
  const fd03Config = agentConfigFor(inventory, hosts, FD03_DOMAIN_ID)
  const fd03Peers = fd03Config.peers as Array<{ host: string }>
  assert.equal(fd03Peers.some((peer) => peer.host === '198.251.77.98'), false)
  const fd06Config = agentConfigFor(inventory, hosts, FD06_DOMAIN_ID)
  const fd06Peers = fd06Config.peers as Array<{ domainId: string; host: string }>
  assert.equal(fd06Config.domainId, FD06_DOMAIN_ID)
  assert.equal(fd06Config.role, 'standby')
  assert.equal(fd06Peers.some((peer) => peer.host === '216.225.193.174'), false)
  const fd02Config = agentConfigFor(inventory, hosts, 'fd-02-ionos-189')
  const fd02Peers = fd02Config.peers as Array<{ domainId: string; host: string }>
  assert.equal(
    fd02Peers.some((peer) => peer.domainId === FD01_DOMAIN_ID && peer.host === FD01_SSH_HOST),
    true,
  )
  assert.equal(
    fd02Peers.some((peer) => peer.domainId === FD03_DOMAIN_ID && peer.host === FD03_SSH_HOST),
    true,
  )
  assert.equal(
    fd02Peers.some((peer) => peer.domainId === FD06_DOMAIN_ID && peer.host === FD06_SSH_HOST),
    true,
  )
  const remapOnly = selectLabKeepHosts(hosts, REMAP_KEEP_L2_DOMAIN_IDS)
  assert.deepEqual(
    remapOnly.map((host) => host.sshHost),
    [FD01_SSH_HOST, FD03_SSH_HOST],
  )
  const remapFd06 = selectLabKeepHosts(hosts, REMAP_KEEP_FD06_DOMAIN_IDS)
  assert.deepEqual(
    remapFd06.map((host) => host.sshHost),
    [FD06_SSH_HOST],
  )
  const peerRefresh = selectLabKeepHosts(hosts, REMAP_PEER_REFRESH_DOMAIN_IDS)
  assert.equal(
    peerRefresh.some((host) => host.sshHost === '216.225.193.174' || host.sshHost === '212.227.242.207'),
    false,
  )
  const peerRefreshAfterFd06 = selectLabKeepHosts(hosts, REMAP_PEER_REFRESH_AFTER_FD06_DOMAIN_IDS)
  assert.deepEqual(
    peerRefreshAfterFd06.map((host) => host.domainId),
    [
      FD01_DOMAIN_ID,
      'fd-02-ionos-189',
      FD03_DOMAIN_ID,
      'fd-04-hosthatch-tokyo1',
      'fd-05-hosthatch-tokyo2',
      FD07_DOMAIN_ID,
    ],
  )
  assert.equal(
    peerRefreshAfterFd06.some((host) => host.sshHost === FD07_SSH_HOST),
    true,
  )
  assert.equal(
    peerRefreshAfterFd06.some((host) => host.sshHost === '216.225.193.174' || host.domainId === FD06_DOMAIN_ID),
    false,
  )
  assert.throws(() => selectLabKeepHosts(hosts, ['no-such-seat']), /not in official hosts/u)
  const root = await mkdtemp(join(tmpdir(), 'pilot-mvp-hosts-'))
  const badFd01Path = join(root, 'hosts-fd01.json')
  await writeFile(
    badFd01Path,
    JSON.stringify({
      ...hosts,
      hosts: hosts.hosts.map((host) =>
        host.domainId === FD01_DOMAIN_ID ? { ...host, sshHost: '74.208.224.45' } : host,
      ),
    }),
  )
  await assert.rejects(loadLabHosts(badFd01Path), /must point|excludes retired/u)
  const badFd03Path = join(root, 'hosts-fd03.json')
  await writeFile(
    badFd03Path,
    JSON.stringify({
      ...hosts,
      hosts: hosts.hosts.map((host) =>
        host.domainId === FD03_DOMAIN_ID ? { ...host, sshHost: '198.251.77.98' } : host,
      ),
    }),
  )
  await assert.rejects(loadLabHosts(badFd03Path), /must point|excludes retired/u)
  const badFd06Path = join(root, 'hosts-fd06.json')
  await writeFile(
    badFd06Path,
    JSON.stringify({
      ...hosts,
      hosts: hosts.hosts.map((host) =>
        host.domainId === FD06_DOMAIN_ID ? { ...host, sshHost: '216.225.193.174' } : host,
      ),
    }),
  )
  await assert.rejects(loadLabHosts(badFd06Path), /must point|excludes retired/u)
})

test('operator inventory freeze covers official seven plus extras and never leftover .174', async () => {
  const hosts = await loadLabHosts()
  assert.equal(OFFICIAL_SEVEN_DOMAIN_IDS.length, 7)
  assert.equal(
    (OFFICIAL_SEVEN_DOMAIN_IDS as readonly string[]).includes(P11_JOINER_DOMAIN_ID),
    false,
  )
  const official = selectLabKeepHosts(hosts, OFFICIAL_SEVEN_DOMAIN_IDS)
  assert.equal(official.length, 7)
  assert.equal(
    official.some((host) => host.sshHost === '216.225.193.174' || host.domainId === P11_JOINER_DOMAIN_ID),
    false,
  )
  const fd06 = official.find((host) => host.domainId === FD06_DOMAIN_ID)
  assert.equal(fd06?.sshHost, FD06_SSH_HOST)
  const document = JSON.parse(operatorInventoryFreezeRemoteDocument()) as {
    schema: string
    frozen: boolean
    reason: string
  }
  assert.equal(document.schema, OPERATOR_INVENTORY_FREEZE_SCHEMA)
  assert.equal(document.frozen, true)
  assert.equal(document.reason, 'operator')
})

test('P11 extra joiner stays outside official 5+2 and extraPeers merge', async () => {
  const inventory = await loadOfficialLabInventory()
  const hosts = await loadLabHosts()
  assert.equal(inventory.domains.length, 7)
  assert.equal(hosts.hosts.length, 7)
  assert.equal(
    inventory.domains.some((domain) => domain.domainId === P11_JOINER_DOMAIN_ID),
    false,
  )
  assert.equal(
    hosts.hosts.some((host) => host.sshHost === P11_JOINER_SSH_HOST),
    false,
  )
  const extra = p11JoinerPeer()
  const keeperConfig = agentConfigFor(inventory, hosts, 'fd-02-ionos-189', { extraPeers: [extra] })
  const keeperPeers = keeperConfig.peers as Array<{ domainId: string }>
  assert.equal(
    keeperPeers.some((peer) => peer.domainId === P11_JOINER_DOMAIN_ID),
    true,
  )
  assert.equal(
    keeperPeers.some((peer) => peer.domainId === 'fd-01-ionos-45'),
    true,
  )
  const joinerConfig = agentConfigForJoiner(inventory, hosts, p11JoinerHost())
  assert.equal(joinerConfig.domainId, P11_JOINER_DOMAIN_ID)
  assert.equal(joinerConfig.role, 'standby')
  const joinerPeers = joinerConfig.peers as Array<{ domainId: string }>
  assert.equal(joinerPeers.length, 7)
  assert.equal(
    joinerPeers.some((peer) => peer.domainId === P11_JOINER_DOMAIN_ID),
    false,
  )
})

test('P8d wipe path still refuses keepers and the P11 extra joiner', () => {
  const previous = process.env.LAB_SYNC_JOIN_WIPE_DOMAIN_IDS
  try {
    process.env.LAB_SYNC_JOIN_WIPE_DOMAIN_IDS = 'fd-01-ionos-45'
    assert.throws(() => resolveWipeJoinDomainIds(), /keeper/u)
    process.env.LAB_SYNC_JOIN_WIPE_DOMAIN_IDS = P11_JOINER_DOMAIN_ID
    assert.throws(() => resolveWipeJoinDomainIds(), /not wipe-safe/u)
    process.env.LAB_SYNC_JOIN_WIPE_DOMAIN_IDS = 'fd-06-ionos-174'
    assert.throws(() => resolveWipeJoinDomainIds(), /fd-05/u)
  } finally {
    if (previous === undefined) delete process.env.LAB_SYNC_JOIN_WIPE_DOMAIN_IDS
    else process.env.LAB_SYNC_JOIN_WIPE_DOMAIN_IDS = previous
  }
})

test('P8d random wipe pick always includes fd-05 and never keepers', () => {
  const seen = new Set<string>()
  for (let i = 0; i < 8; i += 1) {
    const picked = pickRandomWipeJoiners({
      count: 2,
      randomInt: (maxExclusive) => i % maxExclusive,
    })
    assert.equal(picked.includes(G1_SYNC_JOIN_REQUIRED_ACTIVE_WIPE), true)
    assert.equal(picked.length, 2)
    assert.equal(
      picked.some((id) => (G1_SYNC_JOIN_KEEPER_DOMAIN_IDS as readonly string[]).includes(id)),
      false,
    )
    seen.add(picked.join(','))
  }
  const live = pickRandomWipeJoiners()
  assert.equal(live.includes(G1_SYNC_JOIN_REQUIRED_ACTIVE_WIPE), true)
  assert.equal(live.length, 2)
})

test('full dry-run produces a verified public bundle without infrastructure access', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pilot-dry-run-test-'))
  const result = await runDryRunSimulation(join(root, 'run'))
  assert.equal(result.samples, 10)
  assert.equal(result.simulatedQualificationValidated, true)
  assert.ok(result.verifiedFiles >= 5)
})
