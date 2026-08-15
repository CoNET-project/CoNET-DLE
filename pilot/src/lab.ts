import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { AppendOnlyNdjsonWriter, PublicEvidenceRedactor } from './evidence.js'
import { PilotQualificationGate } from './gate.js'
import { assertOperatorDomainPreflight, preflightOperatorDomains } from './inventory.js'
import type { MeterSampleV1, PilotInventoryV1 } from './model.js'

export const PILOT_LAB_ID = 'conet-dle-30d-lab-2026-08'
export const LAB_PORT = 27101
export const LAB_DIR = '/home/peter/dle-30d-lab'
export const PROTECTED_PROCESS_NAMES = [
  'geth',
  'beacon-chain',
  'validator',
  'prysm',
  'conet-geth-load-guard',
  'conet_load15_geth_watch',
] as const

export interface PilotLabHostV1 {
  domainId: string
  sshHost: string
  class: string
  leftoverElCl: boolean
  doNotStartValidator: true
  notes: string
}

export interface PilotLabHostsV1 {
  schema: 'PilotLabHostsV1'
  pilotId: string
  sshUser: string
  labPort: number
  labDir: string
  protectedProcessNames: string[]
  hosts: PilotLabHostV1[]
}

export interface LabCapacityNote {
  check: string
  ok: boolean
  detail: string
}

const here = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_INVENTORY_PATH = resolve(here, '../../inventories/conet-dle-30d-lab-2026-08.json')
export const DEFAULT_HOSTS_PATH = resolve(here, '../../lab/hosts.json')
export const DEFAULT_AGENT_PATH = resolve(here, '../../lab/agent.mjs')
export const DEFAULT_EVIDENCE_DIR = resolve(here, '../../evidence/conet-dle-30d-lab-2026-08')
const LAYER2_ROOT = resolve(here, here.includes(`${sep}dist${sep}src`) ? '../../..' : '../..')
export const DEFAULT_ARCHIVE_DIST_DIR = resolve(LAYER2_ROOT, 'runtime/dist/archive')
export const DEFAULT_DAEMON_PROBE_PATH = resolve(LAYER2_ROOT, 'runtime/src/daemon/probe.mjs')
export const REMOTE_ARCHIVE_ENTRY = `${LAB_DIR}/app/archive/lab-cli.js`
export const REMOTE_DAEMON_PROBE = `${LAB_DIR}/daemon/probe.mjs`
export const ARCHIVE_RUNTIME_DIST = resolve(here, '../../runtime/dist/archive')
export const ARCHIVE_REMOTE_DIR = `${LAB_DIR}/archive-runtime`
export const DAEMON_PROBE_PATH = resolve(here, '../../runtime/src/daemon/probe.mjs')
export const HTTP_QUEUE_CLIENT_HOST = '70.35.205.77'
export const HTTP_QUEUE_CLIENT_DIR = '/home/peter/dle-ondemand-clients'
export const HTTP_QUEUE_CLIENT_COUNT = 30
export const HTTP_QUEUE_GROUP_ID = 'dle.lab.group.v1'
export const DEFAULT_FLEET_DIST_DIR = resolve(LAYER2_ROOT, 'runtime/dist/fleet')
export const REMOTE_FLEET_ENTRY = `${HTTP_QUEUE_CLIENT_DIR}/app/daemon/fleet-cli.js`

export async function loadOfficialLabInventory(path = DEFAULT_INVENTORY_PATH): Promise<PilotInventoryV1> {
  const inventory = JSON.parse(await readFile(path, 'utf8')) as PilotInventoryV1
  assertOperatorDomainPreflight(inventory)
  if (inventory.pilotId !== PILOT_LAB_ID) {
    throw new Error(`unexpected pilotId ${inventory.pilotId}`)
  }
  return inventory
}

export async function loadLabHosts(path = DEFAULT_HOSTS_PATH): Promise<PilotLabHostsV1> {
  const hosts = JSON.parse(await readFile(path, 'utf8')) as PilotLabHostsV1
  if (hosts.schema !== 'PilotLabHostsV1') throw new Error('hosts schema is invalid')
  if (hosts.pilotId !== PILOT_LAB_ID) throw new Error(`unexpected hosts pilotId ${hosts.pilotId}`)
  if (hosts.hosts.length !== 7) throw new Error('lab requires exactly seven SSH hosts')
  if (hosts.labPort !== LAB_PORT) throw new Error(`lab port must be ${LAB_PORT}`)
  if (hosts.labDir !== LAB_DIR) throw new Error(`lab dir must be ${LAB_DIR}`)
  for (const name of PROTECTED_PROCESS_NAMES) {
    if (!hosts.protectedProcessNames.includes(name)) {
      throw new Error(`hosts file missing protected process ${name}`)
    }
  }
  return hosts
}

export function labCorrelationReport(inventory: PilotInventoryV1): LabCapacityNote[] {
  const asns = new Set(inventory.domains.map((domain) => domain.networkAsn))
  const providers = new Set(inventory.domains.map((domain) => domain.provider))
  const regions = new Set(inventory.domains.map((domain) => domain.region))
  return [
    {
      check: 'seven-unique-hosts',
      ok: new Set(inventory.domains.map((domain) => domain.hostId)).size === 7,
      detail: 'seven distinct hostId values',
    },
    {
      check: 'provider-diversity-honest',
      ok: providers.size >= 2,
      detail: `providers=${[...providers].join(',')}; five IONOS + two HostHatch is host-isolated, not fully provider-isolated`,
    },
    {
      check: 'asn-diversity-honest',
      ok: asns.size >= 2,
      detail: `asns=${[...asns].join(',')}; AS8560 still covers five IONOS leases`,
    },
    {
      check: 'region-diversity-honest',
      ok: regions.size >= 2,
      detail: `regions=${[...regions].join(',')}`,
    },
  ]
}

function sshArgs(host: string, remoteCommand: string): string[] {
  return [
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=20',
    '-o',
    'StrictHostKeyChecking=accept-new',
    `peter@${host}`,
    remoteCommand,
  ]
}

export async function runSsh(host: string, remoteCommand: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn('ssh', sshArgs(host, remoteCommand), { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('close', (code) => {
      resolvePromise({ code: code ?? 1, stdout, stderr })
    })
  })
}

async function runLocal(
  command: string,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv },
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: options?.env })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('close', (code) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${command} ${args.join(' ')} failed: ${stderr}`))
    })
  })
}

export async function runScp(localPath: string, host: string, remotePath: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(
      'scp',
      [
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=20',
        '-o',
        'StrictHostKeyChecking=accept-new',
        localPath,
        `peter@${host}:${remotePath}`,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('close', (code) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`scp ${localPath} -> ${host}:${remotePath} failed: ${stderr}`))
    })
  })
}

export function agentConfigFor(
  inventory: PilotInventoryV1,
  hosts: PilotLabHostsV1,
  domainId: string,
  extras?: { autoSeedLabMiners?: boolean; autoFreeze?: boolean },
): Record<string, unknown> {
  const domain = inventory.domains.find((item) => item.domainId === domainId)
  const self = hosts.hosts.find((item) => item.domainId === domainId)
  if (!domain || !self) throw new Error(`unknown domain ${domainId}`)
  const config: Record<string, unknown> = {
    schema: 'DleLabAgentConfigV1',
    agent: 'dle-30d-lab',
    domainId,
    role: domain.role,
    port: hosts.labPort,
    isolatedFromElCl: true,
    doNotStartValidator: true,
    protectedProcessNames: hosts.protectedProcessNames,
    peers: hosts.hosts
      .filter((item) => item.domainId !== domainId)
      .map((item) => {
        const peerDomain = inventory.domains.find((row) => row.domainId === item.domainId)
        return {
          domainId: item.domainId,
          host: item.sshHost,
          port: hosts.labPort,
          role: peerDomain?.role ?? 'standby',
        }
      }),
  }
  if (extras?.autoSeedLabMiners !== undefined) config.autoSeedLabMiners = extras.autoSeedLabMiners
  if (extras?.autoFreeze !== undefined) config.autoFreeze = extras.autoFreeze
  return config
}

const ENSURE_NODE = [
  'set -euo pipefail',
  `mkdir -p '${LAB_DIR}/runtime' '${LAB_DIR}/wal'`,
  `if [ -f '${LAB_DIR}/runtime/bin/node' ]; then chmod +x '${LAB_DIR}/runtime/bin/node'; echo NODE=${LAB_DIR}/runtime/bin/node; exit 0; fi`,
  'if command -v node >/dev/null 2>&1; then echo NODE=$(command -v node); exit 0; fi',
  'cd /tmp',
  'curl -fsSL https://nodejs.org/dist/v20.20.2/node-v20.20.2-linux-x64.tar.xz -o node-v20.20.2-linux-x64.tar.xz',
  `tar -xJf node-v20.20.2-linux-x64.tar.xz -C '${LAB_DIR}/runtime' --strip-components=1`,
  `echo NODE=${LAB_DIR}/runtime/bin/node`,
].join('\n')

const START_AGENT = [
  'set -euo pipefail',
  `cd '${LAB_DIR}'`,
  `if [ -x '${LAB_DIR}/runtime/bin/node' ]; then NODE='${LAB_DIR}/runtime/bin/node'; else NODE=$(command -v node); fi`,
  "PIDS=$(pgrep -f '[n]ode .*dle-30d-lab/agent.mjs' || true)",
  'if [ -n "$PIDS" ]; then echo ALREADY=$PIDS; exit 0; fi',
  `nohup "$NODE" '${LAB_DIR}/agent.mjs' --config '${LAB_DIR}/config.json' >> '${LAB_DIR}/lab.log' 2>&1 &`,
  'echo STARTED=$!',
  'sleep 2',
  `curl -fsS --max-time 3 http://127.0.0.1:${LAB_PORT}/health || true`,
].join('\n')

const STATUS_AGENT = [
  'set +e',
  `echo HOST=$(hostname)`,
  'echo USER=$(whoami)',
  'echo MEM=$(free -h | awk \'/Mem:/{print $2,$3,$7}\')',
  `echo LAB_PIDS=$(pgrep -f '[n]ode .*dle-30d-lab/agent.mjs' | tr '\\n' ' ')`,
  "echo GETH=$(pgrep -x geth | tr '\\n' ' ')",
  "echo BEACON=$(pgrep -x beacon-chain | tr '\\n' ' ')",
  "echo VALIDATOR=$(pgrep -x validator | tr '\\n' ' ')",
  `curl -fsS --max-time 3 http://127.0.0.1:${LAB_PORT}/health 2>/dev/null || echo HEALTH=down`,
].join('\n')

export async function deployIsolatedLab(options?: {
  inventoryPath?: string
  hostsPath?: string
  agentPath?: string
}): Promise<{ ok: boolean; results: Array<{ domainId: string; host: string; ok: boolean; detail: string }> }> {
  const inventory = await loadOfficialLabInventory(options?.inventoryPath)
  const hosts = await loadLabHosts(options?.hostsPath)
  const agentPath = options?.agentPath ?? DEFAULT_AGENT_PATH
  const results: Array<{ domainId: string; host: string; ok: boolean; detail: string }> = []
  for (const host of hosts.hosts) {
    const ensure = await runSsh(host.sshHost, ENSURE_NODE)
    if (ensure.code !== 0) {
      results.push({
        domainId: host.domainId,
        host: host.sshHost,
        ok: false,
        detail: ensure.stderr || ensure.stdout || `ssh exit ${ensure.code}`,
      })
      continue
    }
    const config = agentConfigFor(inventory, hosts, host.domainId)
    const tmpConfig = `/tmp/dle-lab-${host.domainId}.json`
    await writeFile(tmpConfig, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    await runScp(agentPath, host.sshHost, `${LAB_DIR}/agent.mjs`)
    await runScp(tmpConfig, host.sshHost, `${LAB_DIR}/config.json`)
    const started = await runSsh(host.sshHost, START_AGENT)
    const healthOk = started.stdout.includes('"agent":"dle-30d-lab"') || started.stdout.includes('ALREADY=')
    results.push({
      domainId: host.domainId,
      host: host.sshHost,
      ok: started.code === 0 && healthOk,
      detail: started.stdout.trim() || started.stderr.trim(),
    })
  }
  return { ok: results.every((row) => row.ok), results }
}

const STOP_LAB_ONLY = [
  'set -euo pipefail',
  'for pattern in "[n]ode .*dle-30d-lab/agent.mjs" "[n]ode .*dle-30d-lab/app/archive/lab-cli.js"; do',
  '  PIDS=$(pgrep -f "$pattern" || true)',
  '  for pid in $PIDS; do',
  '    comm=$(ps -p "$pid" -o comm= || true)',
  '    args=$(ps -p "$pid" -o args= || true)',
  '    case "$comm $args" in',
  '      *geth*|*beacon-chain*|*validator*|*prysm*) echo PROTECTED; exit 3 ;;',
  '    esac',
  '    kill -TERM "$pid" || true',
  '    echo STOPPED=$pid',
  '  done',
  'done',
  'sleep 1',
].join('\n')

const START_ARCHIVE = [
  'set -euo pipefail',
  `mkdir -p '${LAB_DIR}/app' '${LAB_DIR}/data' '${LAB_DIR}/daemon' '${LAB_DIR}/wal'`,
  `rm -f '${LAB_DIR}/data/bft-state.json' '${LAB_DIR}/data/ondemand-state.json'`,
  `cd '${LAB_DIR}'`,
  `if [ -x '${LAB_DIR}/runtime/bin/node' ]; then NODE='${LAB_DIR}/runtime/bin/node'; else NODE=$(command -v node); fi`,
  `nohup "$NODE" '${REMOTE_ARCHIVE_ENTRY}' --config '${LAB_DIR}/config.json' --data-dir '${LAB_DIR}/data' >> '${LAB_DIR}/archive.log' 2>&1 &`,
  'echo STARTED=$!',
  'sleep 2',
  `curl -fsS --max-time 5 http://127.0.0.1:${LAB_PORT}/health`,
].join('\n')

const START_ARCHIVE_KEEP_BFT = [
  'set -euo pipefail',
  `mkdir -p '${LAB_DIR}/app' '${LAB_DIR}/data' '${LAB_DIR}/daemon' '${LAB_DIR}/wal'`,
  `rm -f '${LAB_DIR}/data/ondemand-state.json'`,
  `cd '${LAB_DIR}'`,
  `if [ -x '${LAB_DIR}/runtime/bin/node' ]; then NODE='${LAB_DIR}/runtime/bin/node'; else NODE=$(command -v node); fi`,
  `nohup "$NODE" '${REMOTE_ARCHIVE_ENTRY}' --config '${LAB_DIR}/config.json' --data-dir '${LAB_DIR}/data' >> '${LAB_DIR}/archive.log' 2>&1 &`,
  'echo STARTED=$!',
  'sleep 2',
  `curl -fsS --max-time 5 http://127.0.0.1:${LAB_PORT}/health`,
].join('\n')

const STATUS_ARCHIVE = [
  'set +e',
  `echo HOST=$(hostname)`,
  'echo USER=$(whoami)',
  'echo MEM=$(free -h | awk \'/Mem:/{print $2,$3,$7}\')',
  `echo ARCHIVE_PIDS=$(pgrep -f '[n]ode .*dle-30d-lab/app/archive/lab-cli.js' | tr '\\n' ' ')`,
  `echo AGENT_PIDS=$(pgrep -f '[n]ode .*dle-30d-lab/agent.mjs' | tr '\\n' ' ')`,
  "echo GETH=$(pgrep -x geth | tr '\\n' ' ')",
  "echo BEACON=$(pgrep -x beacon-chain | tr '\\n' ' ')",
  "echo VALIDATOR=$(pgrep -x validator | tr '\\n' ' ')",
  `curl -fsS --max-time 3 http://127.0.0.1:${LAB_PORT}/health 2>/dev/null || echo HEALTH=down`,
].join('\n')

export async function deployArchiveRuntime(options?: {
  inventoryPath?: string
  hostsPath?: string
  archiveDistDir?: string
  daemonProbePath?: string
}): Promise<{ ok: boolean; results: Array<{ domainId: string; host: string; ok: boolean; detail: string }> }> {
  const inventory = await loadOfficialLabInventory(options?.inventoryPath)
  const hosts = await loadLabHosts(options?.hostsPath)
  const archiveDistDir = options?.archiveDistDir ?? DEFAULT_ARCHIVE_DIST_DIR
  const daemonProbePath = options?.daemonProbePath ?? DEFAULT_DAEMON_PROBE_PATH
  const bundlePath = '/tmp/dle-archive-runtime.tgz'
  await runLocal('tar', ['-czf', bundlePath, '--exclude', '._*', '-C', archiveDistDir, '.'], {
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  })
  const results: Array<{ domainId: string; host: string; ok: boolean; detail: string }> = []
  for (const host of hosts.hosts) {
    const ensure = await runSsh(host.sshHost, ENSURE_NODE)
    if (ensure.code !== 0) {
      results.push({
        domainId: host.domainId,
        host: host.sshHost,
        ok: false,
        detail: ensure.stderr || ensure.stdout || `ssh exit ${ensure.code}`,
      })
      continue
    }
    const config = agentConfigFor(inventory, hosts, host.domainId)
    const tmpConfig = `/tmp/dle-lab-${host.domainId}.json`
    await writeFile(tmpConfig, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    await runSsh(
      host.sshHost,
      `mkdir -p '${LAB_DIR}/app' '${LAB_DIR}/data' '${LAB_DIR}/daemon' '${LAB_DIR}/wal'`,
    )
    await runScp(bundlePath, host.sshHost, '/tmp/dle-archive-runtime.tgz')
    await runScp(tmpConfig, host.sshHost, `${LAB_DIR}/config.json`)
    await runScp(daemonProbePath, host.sshHost, REMOTE_DAEMON_PROBE)
    const unpacked = await runSsh(
      host.sshHost,
      `rm -rf '${LAB_DIR}/app' && mkdir -p '${LAB_DIR}/app' && tar -xzf /tmp/dle-archive-runtime.tgz -C '${LAB_DIR}/app' && printf '%s\\n' '{"type":"module","private":true,"name":"@conet/dle-archive-runtime"}' > '${LAB_DIR}/app/package.json'`,
    )
    if (unpacked.code !== 0) {
      results.push({
        domainId: host.domainId,
        host: host.sshHost,
        ok: false,
        detail: unpacked.stderr || unpacked.stdout,
      })
      continue
    }
    const stopped = await runSsh(host.sshHost, STOP_LAB_ONLY)
    if (stopped.code !== 0) {
      results.push({
        domainId: host.domainId,
        host: host.sshHost,
        ok: false,
        detail: stopped.stderr || stopped.stdout || 'refused to stop protected process',
      })
      continue
    }
    const started = await runSsh(host.sshHost, START_ARCHIVE)
    const healthOk = started.stdout.includes('"command":"archive"')
    results.push({
      domainId: host.domainId,
      host: host.sshHost,
      ok: started.code === 0 && healthOk,
      detail: `${stopped.stdout.trim()}\n${started.stdout.trim() || started.stderr.trim()}`.trim(),
    })
  }
  return { ok: results.every((row) => row.ok), results }
}

export async function acceptArchiveRuntime(): Promise<{
  ok: boolean
  meshOk: boolean
  daemonOk: boolean
  protectedOk: boolean
  bftOk: boolean
  rows: Array<{
    domainId: string
    command?: string
    role?: string
    lastPeerOk?: number
    lastQuorumOk?: boolean
    daemonOk: boolean
    peerHits: number
    expectedPeers: number
    certificateAvailable?: boolean
    certificateHash?: string
    certificateSigners?: string[]
    geth?: string
    beacon?: string
    validator?: string
    detail: string
  }>
}> {
  const hosts = await loadLabHosts()
  const inventory = await loadOfficialLabInventory()
  const activeIds = inventory.domains.filter((domain) => domain.role === 'active').map((domain) => domain.domainId)
  const standbyIds = inventory.domains.filter((domain) => domain.role === 'standby').map((domain) => domain.domainId)
  const expectedPeers = hosts.hosts.length
  const peerCurl = hosts.hosts
    .map(
      (peer) =>
        `curl -fsS --max-time 4 http://${peer.sshHost}:${LAB_PORT}/health >/tmp/dle-peer-${peer.domainId}.json && echo PEER_${peer.domainId}=ok || echo PEER_${peer.domainId}=fail`,
    )
    .join('\n')
  const acceptScript = [
    'set +e',
    STATUS_ARCHIVE,
    `if [ -x '${LAB_DIR}/runtime/bin/node' ]; then NODE='${LAB_DIR}/runtime/bin/node'; else NODE=$(command -v node); fi`,
    `"$NODE" '${REMOTE_DAEMON_PROBE}' --archive http://127.0.0.1:${LAB_PORT} > /tmp/dle-daemon-probe.json`,
    'echo DAEMON_EXIT=$?',
    'echo DAEMON_PROBE_BEGIN',
    'cat /tmp/dle-daemon-probe.json 2>/dev/null',
    'echo DAEMON_PROBE_END',
    'echo CERT_BEGIN',
    `for i in 1 2 3 4 5 6 7 8 9 10 11 12; do curl -fsS --max-time 4 http://127.0.0.1:${LAB_PORT}/api/v2/dle/certificate > /tmp/dle-cert.json && grep -q '"available":true' /tmp/dle-cert.json && break; sleep 3; done`,
    'cat /tmp/dle-cert.json 2>/dev/null',
    'echo',
    'echo CERT_END',
    peerCurl,
  ].join('\n')
  const rows: Array<{
    domainId: string
    command?: string
    role?: string
    lastPeerOk?: number
    lastQuorumOk?: boolean
    daemonOk: boolean
    peerHits: number
    expectedPeers: number
    certificateAvailable?: boolean
    certificateHash?: string
    certificateSigners?: string[]
    geth?: string
    beacon?: string
    validator?: string
    detail: string
  }> = []
  for (const host of hosts.hosts) {
    const result = await runSsh(host.sshHost, acceptScript)
    const stdout = result.stdout
    let health: Record<string, unknown> = {}
    const healthMatch = stdout.match(/\{"ok":true,"command":"archive"[^\n]*?\}/)
    if (healthMatch?.[0]) {
      try {
        health = JSON.parse(healthMatch[0]) as Record<string, unknown>
      } catch {
        health = {}
      }
    }
    let certificate: Record<string, unknown> = {}
    const certMatch = stdout.match(/CERT_BEGIN\n([\s\S]*?)\nCERT_END/)
    if (certMatch?.[1]) {
      try {
        certificate = JSON.parse(certMatch[1].trim()) as Record<string, unknown>
      } catch {
        certificate = {}
      }
    }
    const daemonOk = stdout.includes('"command": "daemon"') && stdout.includes('"ok": true')
    const peerHits = [...stdout.matchAll(/PEER_[^=]+=ok/g)].length
    const geth = stdout.match(/^GETH=(.*)$/m)?.[1]?.trim()
    const beacon = stdout.match(/^BEACON=(.*)$/m)?.[1]?.trim()
    const validator = stdout.match(/^VALIDATOR=(.*)$/m)?.[1]?.trim()
    const signers = Array.isArray(certificate.signers)
      ? certificate.signers.filter((item): item is string => typeof item === 'string')
      : undefined
    rows.push({
      domainId: host.domainId,
      ...(typeof health.command === 'string' ? { command: health.command } : {}),
      ...(typeof health.role === 'string' ? { role: health.role } : {}),
      ...(typeof health.lastPeerOk === 'number' ? { lastPeerOk: health.lastPeerOk } : {}),
      ...(typeof health.lastQuorumOk === 'boolean' ? { lastQuorumOk: health.lastQuorumOk } : {}),
      daemonOk,
      peerHits,
      expectedPeers,
      ...(typeof certificate.available === 'boolean' ? { certificateAvailable: certificate.available } : {}),
      ...(typeof certificate.hash === 'string' ? { certificateHash: certificate.hash } : {}),
      ...(signers !== undefined ? { certificateSigners: signers } : {}),
      ...(geth !== undefined ? { geth } : {}),
      ...(beacon !== undefined ? { beacon } : {}),
      ...(validator !== undefined ? { validator } : {}),
      detail: stdout.slice(0, 4000),
    })
  }
  const meshOk = rows.every((row) => row.command === 'archive' && row.peerHits === expectedPeers)
  const daemonOk = rows.every((row) => row.daemonOk)
  const protectedOk = rows.every((row) => {
    const leftover = hosts.hosts.find((item) => item.domainId === row.domainId)
    if (!leftover) return false
    if (leftover.leftoverElCl) return true
    return (row.geth ?? '') === '' && (row.beacon ?? '') === '' && (row.validator ?? '') === ''
  })
  const hashes = rows.map((row) => row.certificateHash).filter((hash): hash is string => typeof hash === 'string')
  const sameHash = hashes.length === rows.length && hashes.every((hash) => hash === hashes[0])
  const signersOk = rows.every((row) => {
    const next = row.certificateSigners ?? []
    if (next.length < 4) return false
    if (next.some((id) => !activeIds.includes(id))) return false
    if (next.some((id) => standbyIds.includes(id))) return false
    return true
  })
  const bftOk = rows.every((row) => row.certificateAvailable === true) && sameHash && signersOk
  const summary = {
    ok: meshOk && daemonOk && protectedOk && bftOk,
    meshOk,
    daemonOk,
    protectedOk,
    bftOk,
    rows,
  }
  await mkdir(DEFAULT_EVIDENCE_DIR, { recursive: true })
  await writeFile(
    join(DEFAULT_EVIDENCE_DIR, 'bft-p1-accept.json'),
    `${JSON.stringify(
      {
        schema: 'BftP1AcceptV1',
        pilotId: PILOT_LAB_ID,
        acceptedAt: new Date().toISOString(),
        port: LAB_PORT,
        note: 'Lab networked PrecommitQC on TCP 27101. HMAC-SHA256 lab MAC derived from public domainId — forgeable, not a frozen EIP-712 L1 wrapper or corpus SSZ object. Not 30-day qualification.',
        valueHash: hashes[0] ?? null,
        activeArchives: activeIds,
        standbyArchives: standbyIds,
        ...summary,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  return summary
}

export async function acceptOnDemandRuntime(): Promise<{
  ok: boolean
  poolOk: boolean
  selectionOk: boolean
  endorsedOk: boolean
  protectedOk: boolean
  rows: Array<{
    domainId: string
    role?: string
    frozen?: boolean
    poolRoot?: string
    roulette?: string
    committee?: string[]
    standbys?: string[]
    attestors?: string[]
    endorsed?: boolean
    attestCount?: number
    geth?: string
    beacon?: string
    validator?: string
    detail: string
  }>
}> {
  const hosts = await loadLabHosts()
  const inventory = await loadOfficialLabInventory()
  const activeIds = inventory.domains.filter((domain) => domain.role === 'active').map((domain) => domain.domainId)
  const standbyIds = inventory.domains.filter((domain) => domain.role === 'standby').map((domain) => domain.domainId)
  const acceptScript = [
    'set +e',
    STATUS_ARCHIVE,
    'echo SEL_BEGIN',
    `for i in 1 2 3 4 5 6 7 8 9 10 11 12; do curl -fsS --max-time 4 http://127.0.0.1:${LAB_PORT}/ondemand/selection > /tmp/dle-sel.json && grep -q '"endorsed":true' /tmp/dle-sel.json && break; sleep 3; done`,
    'cat /tmp/dle-sel.json 2>/dev/null',
    'echo',
    'echo SEL_END',
    'echo POOL_BEGIN',
    `curl -fsS --max-time 4 http://127.0.0.1:${LAB_PORT}/ondemand/pool`,
    'echo',
    'echo POOL_END',
  ].join('\n')
  const rows: Array<{
    domainId: string
    role?: string
    frozen?: boolean
    poolRoot?: string
    roulette?: string
    committee?: string[]
    standbys?: string[]
    attestors?: string[]
    endorsed?: boolean
    attestCount?: number
    geth?: string
    beacon?: string
    validator?: string
    detail: string
  }> = []
  for (const host of hosts.hosts) {
    const result = await runSsh(host.sshHost, acceptScript)
    const stdout = result.stdout
    let health: Record<string, unknown> = {}
    const healthMatch = stdout.match(/\{"ok":true,"command":"archive"[^\n]*?\}/)
    if (healthMatch?.[0]) {
      try {
        health = JSON.parse(healthMatch[0]) as Record<string, unknown>
      } catch {
        health = {}
      }
    }
    let selection: Record<string, unknown> = {}
    const selMatch = stdout.match(/SEL_BEGIN\n([\s\S]*?)\nSEL_END/)
    if (selMatch?.[1]) {
      try {
        selection = JSON.parse(selMatch[1].trim()) as Record<string, unknown>
      } catch {
        selection = {}
      }
    }
    let pool: Record<string, unknown> = {}
    const poolMatch = stdout.match(/POOL_BEGIN\n([\s\S]*?)\nPOOL_END/)
    if (poolMatch?.[1]) {
      try {
        pool = JSON.parse(poolMatch[1].trim()) as Record<string, unknown>
      } catch {
        pool = {}
      }
    }
    const committee = Array.isArray(selection.committee)
      ? selection.committee.filter((item): item is string => typeof item === 'string')
      : undefined
    const standbys = Array.isArray(selection.standbys)
      ? selection.standbys.filter((item): item is string => typeof item === 'string')
      : undefined
    const attestors = Array.isArray(selection.attestors)
      ? selection.attestors.filter((item): item is string => typeof item === 'string')
      : undefined
    const geth = stdout.match(/^GETH=(.*)$/m)?.[1]?.trim()
    const beacon = stdout.match(/^BEACON=(.*)$/m)?.[1]?.trim()
    const validator = stdout.match(/^VALIDATOR=(.*)$/m)?.[1]?.trim()
    rows.push({
      domainId: host.domainId,
      ...(typeof health.role === 'string' ? { role: health.role } : {}),
      ...(typeof pool.frozen === 'boolean' ? { frozen: pool.frozen } : {}),
      ...(typeof selection.poolRoot === 'string' ? { poolRoot: selection.poolRoot } : {}),
      ...(typeof selection.roulette === 'string' ? { roulette: selection.roulette } : {}),
      ...(committee !== undefined ? { committee } : {}),
      ...(standbys !== undefined ? { standbys } : {}),
      ...(attestors !== undefined ? { attestors } : {}),
      ...(typeof selection.endorsed === 'boolean' ? { endorsed: selection.endorsed } : {}),
      ...(typeof health.ondemandAttestCount === 'number' ? { attestCount: health.ondemandAttestCount } : {}),
      ...(geth !== undefined ? { geth } : {}),
      ...(beacon !== undefined ? { beacon } : {}),
      ...(validator !== undefined ? { validator } : {}),
      detail: stdout.slice(0, 4000),
    })
  }
  const roots = rows.map((row) => row.poolRoot).filter((hash): hash is string => typeof hash === 'string')
  const sameRoot = roots.length === rows.length && roots.every((hash) => hash === roots[0])
  const firstCommittee = rows[0]?.committee ?? []
  const firstStandbys = rows[0]?.standbys ?? []
  const sameDraw = rows.every(
    (row) =>
      row.committee?.length === 7 &&
      row.standbys?.length === 2 &&
      JSON.stringify(row.committee) === JSON.stringify(firstCommittee) &&
      JSON.stringify(row.standbys) === JSON.stringify(firstStandbys),
  )
  const poolOk = rows.every((row) => row.frozen === true) && sameRoot
  const selectionOk = sameDraw && sameRoot
  const endorsedOk = rows.every((row) => {
    const next = row.attestors ?? []
    if (row.endorsed !== true) return false
    if (next.length < 4) return false
    if (next.some((id) => !activeIds.includes(id))) return false
    if (next.some((id) => standbyIds.includes(id))) return false
    return true
  })
  const protectedOk = rows.every((row) => {
    const leftover = hosts.hosts.find((item) => item.domainId === row.domainId)
    if (!leftover) return false
    if (leftover.leftoverElCl) return true
    return (row.geth ?? '') === '' && (row.beacon ?? '') === '' && (row.validator ?? '') === ''
  })
  const summary = {
    ok: poolOk && selectionOk && endorsedOk && protectedOk,
    poolOk,
    selectionOk,
    endorsedOk,
    protectedOk,
    rows,
  }
  await mkdir(DEFAULT_EVIDENCE_DIR, { recursive: true })
  await writeFile(
    join(DEFAULT_EVIDENCE_DIR, 'ondemand-p3-accept.json'),
    `${JSON.stringify(
      {
        schema: 'OnDemandP3AcceptV1',
        pilotId: PILOT_LAB_ID,
        acceptedAt: new Date().toISOString(),
        port: LAB_PORT,
        note: 'Lab on-demand SelectionLog on TCP 27101. Beacon is keccak after freeze, not CoNET L1 CL RANDAO. HMAC-SHA256 attests are derived from public domainId — forgeable. SelectionLog is not an Archive Certificate and not 30-day qualification.',
        poolRoot: roots[0] ?? null,
        committee: firstCommittee,
        standbys: firstStandbys,
        activeArchives: activeIds,
        standbyArchives: standbyIds,
        ...summary,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  return summary
}

export async function statusIsolatedLab(): Promise<
  Array<{ domainId: string; host: string; stdout: string; code: number }>
> {
  const hosts = await loadLabHosts()
  const rows: Array<{ domainId: string; host: string; stdout: string; code: number }> = []
  for (const host of hosts.hosts) {
    const result = await runSsh(host.sshHost, STATUS_AGENT)
    rows.push({
      domainId: host.domainId,
      host: host.sshHost,
      stdout: result.stdout.trim(),
      code: result.code,
    })
  }
  return rows
}

export function httpArchiveUrls(hosts: PilotLabHostsV1): string[] {
  return hosts.hosts.map((host) => `http://${host.sshHost}:${hosts.labPort}`)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms)
  })
}

function httpQueueMinerAddress(index: number): string {
  return `0xb1100000000000000000000000000000000000${index.toString(16).padStart(2, '0')}`
}

function httpQueueMinerSet(): Set<string> {
  return new Set(Array.from({ length: HTTP_QUEUE_CLIENT_COUNT }, (_, index) => httpQueueMinerAddress(index + 1)))
}

async function fetchArchiveJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) })
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`)
  const body: unknown = await response.json()
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error(`invalid JSON ${url}`)
  return body as Record<string, unknown>
}

export async function openOnDemandHttpQueue(options?: {
  inventoryPath?: string
  hostsPath?: string
  archiveDistDir?: string
}): Promise<{
  ok: boolean
  results: Array<{ domainId: string; host: string; ok: boolean; frozen?: boolean; minerCount?: number; detail: string }>
}> {
  const inventory = await loadOfficialLabInventory(options?.inventoryPath)
  const hosts = await loadLabHosts(options?.hostsPath)
  const archiveDistDir = options?.archiveDistDir ?? DEFAULT_ARCHIVE_DIST_DIR
  const bundlePath = '/tmp/dle-archive-runtime.tgz'
  await runLocal('tar', ['-czf', bundlePath, '--exclude', '._*', '-C', archiveDistDir, '.'], {
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  })
  const results: Array<{
    domainId: string
    host: string
    ok: boolean
    frozen?: boolean
    minerCount?: number
    detail: string
  }> = []
  for (const host of hosts.hosts) {
    const ensure = await runSsh(host.sshHost, ENSURE_NODE)
    if (ensure.code !== 0) {
      results.push({
        domainId: host.domainId,
        host: host.sshHost,
        ok: false,
        detail: ensure.stderr || ensure.stdout || `ssh exit ${ensure.code}`,
      })
      continue
    }
    const config = agentConfigFor(inventory, hosts, host.domainId, {
      autoSeedLabMiners: false,
      autoFreeze: false,
    })
    const tmpConfig = `/tmp/dle-lab-http-queue-${host.domainId}.json`
    await writeFile(tmpConfig, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    const stopped = await runSsh(host.sshHost, STOP_LAB_ONLY)
    if (stopped.code !== 0) {
      results.push({
        domainId: host.domainId,
        host: host.sshHost,
        ok: false,
        detail: stopped.stderr || stopped.stdout || 'refused to stop protected process',
      })
      continue
    }
    await runSsh(host.sshHost, `mkdir -p '${LAB_DIR}/app' '${LAB_DIR}/data' '${LAB_DIR}/daemon' '${LAB_DIR}/wal'`)
    await runScp(bundlePath, host.sshHost, '/tmp/dle-archive-runtime.tgz')
    await runScp(tmpConfig, host.sshHost, `${LAB_DIR}/config.json`)
    const unpacked = await runSsh(
      host.sshHost,
      `rm -rf '${LAB_DIR}/app' && mkdir -p '${LAB_DIR}/app' && tar -xzf /tmp/dle-archive-runtime.tgz -C '${LAB_DIR}/app' && printf '%s\\n' '{"type":"module","private":true,"name":"@conet/dle-archive-runtime"}' > '${LAB_DIR}/app/package.json'`,
    )
    if (unpacked.code !== 0) {
      results.push({
        domainId: host.domainId,
        host: host.sshHost,
        ok: false,
        detail: unpacked.stderr || unpacked.stdout,
      })
      continue
    }
    const started = await runSsh(host.sshHost, START_ARCHIVE_KEEP_BFT)
    let frozen: boolean | undefined
    let minerCount: number | undefined
    try {
      const health = await fetchArchiveJson(`http://${host.sshHost}:${LAB_PORT}/health`)
      frozen = health.ondemandFrozen === true
      minerCount = typeof health.ondemandMinerCount === 'number' ? health.ondemandMinerCount : undefined
    } catch {
      frozen = undefined
      minerCount = undefined
    }
    const healthOk =
      started.code === 0 &&
      started.stdout.includes('"command":"archive"') &&
      frozen === false &&
      minerCount === 0
    const row: {
      domainId: string
      host: string
      ok: boolean
      frozen?: boolean
      minerCount?: number
      detail: string
    } = {
      domainId: host.domainId,
      host: host.sshHost,
      ok: healthOk,
      detail: `${stopped.stdout.trim()}\n${started.stdout.trim() || started.stderr.trim()}`.trim(),
    }
    if (frozen !== undefined) row.frozen = frozen
    if (minerCount !== undefined) row.minerCount = minerCount
    results.push(row)
  }
  return { ok: results.every((row) => row.ok), results }
}

const STOP_HTTP_QUEUE_CLIENTS = [
  'set -euo pipefail',
  `PIDS=$(pgrep -f '[n]ode .*dle-ondemand-clients/' || true)`,
  'for pid in $PIDS; do',
  '  comm=$(ps -p "$pid" -o comm= || true)',
  '  args=$(ps -p "$pid" -o args= || true)',
  '  case "$comm $args" in',
  '    *geth*|*beacon-chain*|*validator*|*prysm*) echo PROTECTED; exit 3 ;;',
  '    *dle-30d-lab*) echo PROTECTED_LAB; exit 3 ;;',
  '  esac',
  '  kill -TERM "$pid" || true',
  '  echo STOPPED=$pid',
  'done',
  'sleep 1',
].join('\n')

const START_HTTP_QUEUE_CLIENTS = [
  'set -euo pipefail',
  `mkdir -p '${HTTP_QUEUE_CLIENT_DIR}/data'`,
  `cd '${HTTP_QUEUE_CLIENT_DIR}'`,
  'NODE=$(command -v node)',
  `PIDS=$(pgrep -f '[n]ode .*dle-ondemand-clients/' || true)`,
  'if [ -n "$PIDS" ]; then echo ALREADY=$PIDS; exit 0; fi',
  `nohup "$NODE" '${REMOTE_FLEET_ENTRY}' --supervisor --archives-file '${HTTP_QUEUE_CLIENT_DIR}/archives.json' --data-dir '${HTTP_QUEUE_CLIENT_DIR}/data' --client-count ${HTTP_QUEUE_CLIENT_COUNT} >> '${HTTP_QUEUE_CLIENT_DIR}/fleet.log' 2>&1 &`,
  'echo STARTED=$!',
  'sleep 2',
  `echo FLEET_PIDS=$(pgrep -f '[n]ode .*dle-ondemand-clients/' | tr '\\n' ' ')`,
].join('\n')

export async function deployOnDemandHttpClients(options?: {
  inventoryPath?: string
  hostsPath?: string
  archiveDistDir?: string
  fleetDistDir?: string
  waitMs?: number
}): Promise<{
  ok: boolean
  opened: boolean
  queued: boolean
  frozen: boolean
  endorsed: boolean
  poolRoot: string | null
  clientHost: string
  results: unknown
}> {
  const hosts = await loadLabHosts(options?.hostsPath)
  const openOptions: { inventoryPath?: string; hostsPath?: string; archiveDistDir?: string } = {}
  if (options?.inventoryPath !== undefined) openOptions.inventoryPath = options.inventoryPath
  if (options?.hostsPath !== undefined) openOptions.hostsPath = options.hostsPath
  if (options?.archiveDistDir !== undefined) openOptions.archiveDistDir = options.archiveDistDir
  const opened = await openOnDemandHttpQueue(openOptions)
  if (!opened.ok) {
    return {
      ok: false,
      opened: false,
      queued: false,
      frozen: false,
      endorsed: false,
      poolRoot: null,
      clientHost: HTTP_QUEUE_CLIENT_HOST,
      results: opened.results,
    }
  }
  const fleetDistDir = options?.fleetDistDir ?? DEFAULT_FLEET_DIST_DIR
  const bundlePath = '/tmp/dle-ondemand-fleet.tgz'
  await runLocal('tar', ['-czf', bundlePath, '--exclude', '._*', '-C', fleetDistDir, '.'], {
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  })
  const archives = httpArchiveUrls(hosts)
  const archivesFile = {
    schema: 'DleOnDemandHttpArchivesV1',
    groupId: HTTP_QUEUE_GROUP_ID,
    archives,
  }
  const tmpArchives = '/tmp/dle-ondemand-archives.json'
  await writeFile(tmpArchives, `${JSON.stringify(archivesFile, null, 2)}\n`, 'utf8')
  const ensure = await runSsh(
    HTTP_QUEUE_CLIENT_HOST,
    `mkdir -p '${HTTP_QUEUE_CLIENT_DIR}/app' '${HTTP_QUEUE_CLIENT_DIR}/data'`,
  )
  if (ensure.code !== 0) {
    return {
      ok: false,
      opened: true,
      queued: false,
      frozen: false,
      endorsed: false,
      poolRoot: null,
      clientHost: HTTP_QUEUE_CLIENT_HOST,
      results: ensure.stderr || ensure.stdout,
    }
  }
  const stopped = await runSsh(HTTP_QUEUE_CLIENT_HOST, STOP_HTTP_QUEUE_CLIENTS)
  if (stopped.code !== 0) {
    return {
      ok: false,
      opened: true,
      queued: false,
      frozen: false,
      endorsed: false,
      poolRoot: null,
      clientHost: HTTP_QUEUE_CLIENT_HOST,
      results: stopped.stderr || stopped.stdout || 'refused to stop protected process',
    }
  }
  await runScp(bundlePath, HTTP_QUEUE_CLIENT_HOST, '/tmp/dle-ondemand-fleet.tgz')
  await runScp(tmpArchives, HTTP_QUEUE_CLIENT_HOST, `${HTTP_QUEUE_CLIENT_DIR}/archives.json`)
  const unpacked = await runSsh(
    HTTP_QUEUE_CLIENT_HOST,
    `rm -rf '${HTTP_QUEUE_CLIENT_DIR}/app' && mkdir -p '${HTTP_QUEUE_CLIENT_DIR}/app' && tar -xzf /tmp/dle-ondemand-fleet.tgz -C '${HTTP_QUEUE_CLIENT_DIR}/app' && printf '%s\\n' '{"type":"module","private":true,"name":"@conet/dle-ondemand-fleet"}' > '${HTTP_QUEUE_CLIENT_DIR}/app/package.json'`,
  )
  if (unpacked.code !== 0) {
    return {
      ok: false,
      opened: true,
      queued: false,
      frozen: false,
      endorsed: false,
      poolRoot: null,
      clientHost: HTTP_QUEUE_CLIENT_HOST,
      results: unpacked.stderr || unpacked.stdout,
    }
  }
  const started = await runSsh(HTTP_QUEUE_CLIENT_HOST, START_HTTP_QUEUE_CLIENTS)
  const expected = httpQueueMinerSet()
  const deadline = Date.now() + (options?.waitMs ?? 240_000)
  let queued = false
  let frozen = false
  let endorsed = false
  let poolRoot: string | null = null
  let lastPools: unknown = null
  while (Date.now() < deadline) {
    const pools = []
    for (const url of archives) {
      try {
        const pool = await fetchArchiveJson(`${url}/ondemand/pool`)
        const miners = Array.isArray(pool.miners) ? pool.miners.map((row) => String(row).toLowerCase()) : []
        pools.push({
          url,
          frozen: pool.frozen === true,
          minerCount: pool.minerCount,
          present: [...expected].every((miner) => miners.includes(miner)),
          poolRoot: typeof pool.poolRoot === 'string' ? pool.poolRoot : null,
        })
      } catch (error) {
        pools.push({
          url,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    lastPools = pools
    queued = pools.every((row) => 'present' in row && row.present === true && row.minerCount === HTTP_QUEUE_CLIENT_COUNT)
    if (queued) {
      for (const url of archives) {
        try {
          await fetch(`${url}/ondemand/freeze`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ schema: 'DleOnDemandFreezeV1' }),
            signal: AbortSignal.timeout(8_000),
          })
        } catch {
          /* supervisor may already be freezing */
        }
      }
    }
    const selections: Array<{ available: boolean; endorsed: boolean }> = []
    for (const url of archives) {
      try {
        const selection = await fetchArchiveJson(`${url}/ondemand/selection`)
        selections.push({
          available: selection.available === true,
          endorsed: selection.endorsed === true,
        })
      } catch {
        selections.push({ available: false, endorsed: false })
      }
    }
    frozen = pools.every((row) => 'frozen' in row && row.frozen === true)
    const roots = pools
      .map((row) => ('poolRoot' in row ? row.poolRoot : null))
      .filter((hash): hash is string => typeof hash === 'string' && hash.startsWith('0x'))
    poolRoot = roots[0] ?? null
    endorsed =
      frozen &&
      selections.every((row) => row.available === true && row.endorsed === true) &&
      roots.length === archives.length &&
      roots.every((hash) => hash === poolRoot)
    if (queued && frozen && endorsed) break
    await delay(5_000)
  }
  const evidence = {
    schema: 'OnDemandHttpQueue30V1',
    pilotId: PILOT_LAB_ID,
    acceptedAt: new Date().toISOString(),
    clientHost: HTTP_QUEUE_CLIENT_HOST,
    clientDir: HTTP_QUEUE_CLIENT_DIR,
    clientCount: HTTP_QUEUE_CLIENT_COUNT,
    transport: 'http',
    archivePort: LAB_PORT,
    minerPrefix: '0xb110…0001–001e',
    note: 'HTTP wait-hook queue on seven archive nodes. Hooks do not gossip; each client posted to every archive. Lab beacon ≠ CoNET L1 CL RANDAO. HMAC attests are forgeable. SelectionLog is not an Archive Certificate and not 30-day qualification.',
    opened: opened.ok,
    queued,
    frozen,
    endorsed,
    poolRoot,
    start: started.stdout.trim() || started.stderr.trim(),
    lastPools,
  }
  await mkdir(DEFAULT_EVIDENCE_DIR, { recursive: true })
  await writeFile(
    join(DEFAULT_EVIDENCE_DIR, 'ondemand-http-queue-30.json'),
    `${JSON.stringify(evidence, null, 2)}\n`,
    'utf8',
  )
  return {
    ok: opened.ok && queued && frozen && endorsed,
    opened: opened.ok,
    queued,
    frozen,
    endorsed,
    poolRoot,
    clientHost: HTTP_QUEUE_CLIENT_HOST,
    results: { opened: opened.results, start: started.stdout.trim(), lastPools },
  }
}

export async function injectIsolatedProcessCrash(domainId: string): Promise<{ ok: boolean; detail: string }> {
  const hosts = await loadLabHosts()
  const host = hosts.hosts.find((item) => item.domainId === domainId)
  if (!host) throw new Error(`unknown domain ${domainId}`)
  const script = [
    'set -euo pipefail',
    "PIDS=$(pgrep -f '[n]ode .*dle-30d-lab/' || true)",
    'if [ -z "$PIDS" ]; then echo none; exit 0; fi',
    'for pid in $PIDS; do',
    '  comm=$(ps -p "$pid" -o comm= || true)',
    '  args=$(ps -p "$pid" -o args= || true)',
    `  case "$comm $args" in`,
    '    *geth*|*beacon-chain*|*validator*|*prysm*) echo PROTECTED; exit 3 ;;',
    '  esac',
    '  if echo "$args" | grep -Eq "dle-30d-lab/(agent.mjs|app/archive/lab-cli.js)"; then kill -TERM "$pid"; echo KILLED=$pid; fi',
    'done',
  ].join('\n')
  const result = await runSsh(host.sshHost, script)
  return { ok: result.code === 0, detail: result.stdout.trim() || result.stderr.trim() }
}

export async function startOfficialWarmup(evidenceDir = DEFAULT_EVIDENCE_DIR): Promise<{
  gatePath: string
  inventoryPath: string
  correlation: LabCapacityNote[]
}> {
  const inventory = await loadOfficialLabInventory()
  const report = preflightOperatorDomains(inventory)
  if (!report.ok) throw new Error('official inventory preflight failed')
  const gate = new PilotQualificationGate(Date.now())
  await mkdir(evidenceDir, { recursive: true })
  const inventoryPath = join(evidenceDir, 'inventory.json')
  const gatePath = join(evidenceDir, 'gate.json')
  await writeFile(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8')
  await writeFile(gatePath, `${JSON.stringify(gate.snapshot(), null, 2)}\n`, 'utf8')
  const meter = new AppendOnlyNdjsonWriter<MeterSampleV1>(
    join(evidenceDir, 'meter.ndjson'),
    new PublicEvidenceRedactor(inventory.pilotId),
  )
  for (const domain of inventory.domains) {
    await meter.append({
      schema: 'MeterSampleV1',
      sampleId: randomUUID(),
      pilotId: inventory.pilotId,
      domainId: domain.domainId,
      measuredAt: new Date().toISOString(),
      metric: 'availability',
      value: 1,
      unit: 'ratio',
    })
  }
  await writeFile(
    join(evidenceDir, 'correlation.json'),
    `${JSON.stringify({ schema: 'LabCorrelationV1', notes: labCorrelationReport(inventory) }, null, 2)}\n`,
    'utf8',
  )
  return { gatePath, inventoryPath, correlation: labCorrelationReport(inventory) }
}
