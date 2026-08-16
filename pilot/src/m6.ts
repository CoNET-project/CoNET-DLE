import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertOperatorDomainPreflight } from './inventory.js'
import {
  DEFAULT_ARCHIVE_DIST_DIR,
  DEFAULT_DAEMON_PROBE_PATH,
  DEFAULT_HOSTS_PATH,
  DEFAULT_INVENTORY_PATH,
  LAB_PORT,
  PILOT_LAB_ID,
  PROTECTED_PROCESS_NAMES,
  agentConfigFor,
  deployArchiveRuntime,
  loadLabHosts,
  loadOfficialLabInventory,
  planeDirectoryFromHosts,
  runLocal,
  runScp,
  runSsh,
  type PilotLabHostsV1,
} from './lab.js'
import type { PilotInventoryV1 } from './model.js'

export const PILOT_M6_ID = 'conet-dle-m6-g2-2026-08'
export const M6_LAB_DIR = '/home/peter/dle-m6-g2'
export const DLE_LAB_GROUP_ID = '0x3076a806de71ab75b2d48063cc3f1e7d8f8e3d54cb1d45a7469c75c9276f2ad0'
export const DLE_LAB_M6_GROUP_ID =
  '0x7b3b8eb959dcc0f75a309fcc16e7f840efe76dc27f2ef0d4eca8b8617f9b1a07'
export const DLE_LAB_M6_MARKER_NFT_ID = '6000000006'
export const DLE_LAB_M6_MARKER_HASH =
  '0x7ca21e5aa612caa12bbd137aa374d30a113d42c1f60ea411fdb6998a63e2345c'
export const LAB_BFT_CHAIN_NFT_ID = '42'

const here = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_M6_HOSTS_PATH = resolve(here, '../../lab/hosts-m6-g2.json')
export const DEFAULT_M6_INVENTORY_PATH = resolve(here, '../../inventories/conet-dle-m6-g2-2026-08.json')
export const DEFAULT_M6_EVIDENCE_DIR = resolve(here, '../../evidence/conet-dle-m6-g2-2026-08')
export const REMOTE_M6_ARCHIVE_ENTRY = `${M6_LAB_DIR}/app/archive/lab-cli.js`
export const REMOTE_M6_DAEMON_PROBE = `${M6_LAB_DIR}/daemon/probe.mjs`

export async function loadM6Inventory(path = DEFAULT_M6_INVENTORY_PATH): Promise<PilotInventoryV1> {
  const inventory = JSON.parse(await readFile(path, 'utf8')) as PilotInventoryV1
  assertOperatorDomainPreflight(inventory)
  if (inventory.pilotId !== PILOT_M6_ID) throw new Error(`unexpected M6 inventory pilotId ${inventory.pilotId}`)
  return inventory
}

export async function loadM6Hosts(path = DEFAULT_M6_HOSTS_PATH): Promise<PilotLabHostsV1> {
  const hosts = JSON.parse(await readFile(path, 'utf8')) as PilotLabHostsV1
  if (hosts.schema !== 'PilotLabHostsV1') throw new Error('M6 hosts schema is invalid')
  if (hosts.pilotId !== PILOT_M6_ID) throw new Error(`unexpected M6 hosts pilotId ${hosts.pilotId}`)
  if (hosts.hosts.length !== 7) throw new Error('M6 lab requires exactly seven SSH hosts')
  if (hosts.labPort !== LAB_PORT) throw new Error(`M6 lab port must be ${LAB_PORT}`)
  if (hosts.labDir !== M6_LAB_DIR) throw new Error(`M6 lab dir must be ${M6_LAB_DIR}`)
  for (const name of PROTECTED_PROCESS_NAMES) {
    if (!hosts.protectedProcessNames.includes(name)) {
      throw new Error(`M6 hosts missing protected process ${name}`)
    }
  }
  return hosts
}

const ENSURE_M6_NODE = [
  'set -euo pipefail',
  `mkdir -p '${M6_LAB_DIR}/runtime' '${M6_LAB_DIR}/wal'`,
  `if [ -f '${M6_LAB_DIR}/runtime/bin/node' ]; then chmod +x '${M6_LAB_DIR}/runtime/bin/node'; echo NODE=${M6_LAB_DIR}/runtime/bin/node; exit 0; fi`,
  'if command -v node >/dev/null 2>&1; then echo NODE=$(command -v node); exit 0; fi',
  'cd /tmp',
  'curl -fsSL https://nodejs.org/dist/v20.20.2/node-v20.20.2-linux-x64.tar.xz -o node-v20.20.2-linux-x64.tar.xz',
  `tar -xJf node-v20.20.2-linux-x64.tar.xz -C '${M6_LAB_DIR}/runtime' --strip-components=1`,
  `echo NODE=${M6_LAB_DIR}/runtime/bin/node`,
].join('\n')

const STOP_M6_ONLY = [
  'set -euo pipefail',
  'for pattern in "[n]ode .*dle-m6-g2/app/archive/lab-cli.js" "[n]ode .*dle-m6-g2/agent.mjs"; do',
  '  PIDS=$(pgrep -f "$pattern" || true)',
  '  for pid in $PIDS; do',
  '    comm=$(ps -p "$pid" -o comm= || true)',
  '    args=$(ps -p "$pid" -o args= || true)',
  '    case "$comm $args" in',
  '      *geth*|*beacon-chain*|*validator*|*prysm*|*dle-30d-lab*) echo PROTECTED; exit 3 ;;',
  '    esac',
  '    kill -TERM "$pid" || true',
  '    echo STOPPED=$pid',
  '  done',
  'done',
  'sleep 1',
].join('\n')

const START_M6_ARCHIVE = [
  'set -euo pipefail',
  `rm -rf '${M6_LAB_DIR}/data'`,
  `mkdir -p '${M6_LAB_DIR}/app' '${M6_LAB_DIR}/data' '${M6_LAB_DIR}/daemon' '${M6_LAB_DIR}/wal'`,
  `cd '${M6_LAB_DIR}'`,
  `if [ -x '${M6_LAB_DIR}/runtime/bin/node' ]; then NODE='${M6_LAB_DIR}/runtime/bin/node'; else NODE=$(command -v node); fi`,
  `nohup "$NODE" '${REMOTE_M6_ARCHIVE_ENTRY}' --config '${M6_LAB_DIR}/config.json' --data-dir '${M6_LAB_DIR}/data' >> '${M6_LAB_DIR}/archive.log' 2>&1 &`,
  'echo STARTED=$!',
  'sleep 8',
  `curl -fsS --max-time 8 http://127.0.0.1:${LAB_PORT}/health`,
].join('\n')

function mergePlaneDirectories(
  ...rows: Array<ReturnType<typeof planeDirectoryFromHosts>>
): NonNullable<ReturnType<typeof planeDirectoryFromHosts>> {
  const merged: NonNullable<ReturnType<typeof planeDirectoryFromHosts>> = []
  for (const group of rows) {
    if (group === undefined) continue
    merged.push(...group)
  }
  return merged
}

export async function deployM6G2(options?: {
  archiveDistDir?: string
  daemonProbePath?: string
}): Promise<{ ok: boolean; results: Array<{ domainId: string; host: string; ok: boolean; detail: string }> }> {
  const g2Inventory = await loadM6Inventory()
  const g2Hosts = await loadM6Hosts()
  const g1Inventory = await loadOfficialLabInventory(DEFAULT_INVENTORY_PATH)
  const g1Hosts = await loadLabHosts(DEFAULT_HOSTS_PATH)
  if (g1Hosts.pilotId !== PILOT_LAB_ID) throw new Error('refusing to deploy M6 without first-group hosts')
  const archiveDistDir = options?.archiveDistDir ?? DEFAULT_ARCHIVE_DIST_DIR
  const daemonProbePath = options?.daemonProbePath ?? DEFAULT_DAEMON_PROBE_PATH
  const bundlePath = '/tmp/dle-m6-g2-runtime.tgz'
  await runLocal('tar', ['-czf', bundlePath, '--exclude', '._*', '-C', archiveDistDir, '.'], {
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  })
  const extras = {
    ownGroupId: DLE_LAB_M6_GROUP_ID,
    enableBft: false,
    enableOndemand: false,
    seedFissionMarker: true,
    planeDirectory: mergePlaneDirectories(
      planeDirectoryFromHosts(DLE_LAB_GROUP_ID, g1Hosts, g1Inventory),
      planeDirectoryFromHosts(DLE_LAB_M6_GROUP_ID, g2Hosts, g2Inventory),
    ),
    foreignChains: [{ chainNftId: LAB_BFT_CHAIN_NFT_ID, groupId: DLE_LAB_GROUP_ID }],
  }
  const results: Array<{ domainId: string; host: string; ok: boolean; detail: string }> = []
  for (const host of g2Hosts.hosts) {
    const ensure = await runSsh(host.sshHost, ENSURE_M6_NODE)
    if (ensure.code !== 0) {
      results.push({
        domainId: host.domainId,
        host: host.sshHost,
        ok: false,
        detail: ensure.stderr || ensure.stdout || `ssh exit ${ensure.code}`,
      })
      continue
    }
    const config = agentConfigFor(g2Inventory, g2Hosts, host.domainId, extras)
    const tmpConfig = `/tmp/dle-m6-${host.domainId}.json`
    await writeFile(tmpConfig, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    await runSsh(
      host.sshHost,
      `mkdir -p '${M6_LAB_DIR}/app' '${M6_LAB_DIR}/data' '${M6_LAB_DIR}/daemon' '${M6_LAB_DIR}/wal'`,
    )
    await runScp(bundlePath, host.sshHost, '/tmp/dle-m6-g2-runtime.tgz')
    await runScp(tmpConfig, host.sshHost, `${M6_LAB_DIR}/config.json`)
    await runScp(daemonProbePath, host.sshHost, REMOTE_M6_DAEMON_PROBE)
    const unpacked = await runSsh(
      host.sshHost,
      `rm -rf '${M6_LAB_DIR}/app' && mkdir -p '${M6_LAB_DIR}/app' && tar -xzf /tmp/dle-m6-g2-runtime.tgz -C '${M6_LAB_DIR}/app' && printf '%s\\n' '{"type":"module","private":true,"name":"@conet/dle-archive-runtime"}' > '${M6_LAB_DIR}/app/package.json'`,
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
    const stopped = await runSsh(host.sshHost, STOP_M6_ONLY)
    if (stopped.code !== 0) {
      results.push({
        domainId: host.domainId,
        host: host.sshHost,
        ok: false,
        detail: stopped.stderr || stopped.stdout || 'refused to stop protected process',
      })
      continue
    }
    const started = await runSsh(host.sshHost, START_M6_ARCHIVE)
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

export async function keepUpdateG1PlaneDirectory(): Promise<{
  ok: boolean
  results: Array<{ domainId: string; host: string; ok: boolean; detail: string }>
}> {
  const g2Inventory = await loadM6Inventory()
  const g2Hosts = await loadM6Hosts()
  return deployArchiveRuntime({
    keepData: true,
    extras: {
      planeDirectory: mergePlaneDirectories(
        planeDirectoryFromHosts(DLE_LAB_M6_GROUP_ID, g2Hosts, g2Inventory),
      ),
    },
  })
}

export async function deployM6Plane(): Promise<{
  ok: boolean
  g2: Awaited<ReturnType<typeof deployM6G2>>
  g1: Awaited<ReturnType<typeof keepUpdateG1PlaneDirectory>>
}> {
  const g2 = await deployM6G2()
  if (!g2.ok) return { ok: false, g2, g1: { ok: false, results: [] } }
  const g1 = await keepUpdateG1PlaneDirectory()
  return { ok: g2.ok && g1.ok, g2, g1 }
}

function parseHealthJson(stdout: string): Record<string, unknown> {
  const needle = '"command":"archive"'
  const at = stdout.indexOf(needle)
  const start = at >= 0 ? stdout.lastIndexOf('{', at) : stdout.indexOf('{')
  if (start < 0) return {}
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < stdout.length; i += 1) {
    const ch = stdout[i]
    if (inString) {
      if (escape) {
        escape = false
        continue
      }
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') depth += 1
    if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(stdout.slice(start, i + 1)) as Record<string, unknown>
        } catch {
          return {}
        }
      }
    }
  }
  return {}
}

function rpcBody(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if ('result' in value) return (value as { result: unknown }).result
  return value
}

async function rpcOnHost(
  host: string,
  method: string,
  params: unknown[],
): Promise<unknown> {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  const remote = [
    'set +e',
    `curl -fsS --max-time 8 -H 'content-type: application/json' -d '${body.replace(/'/g, `'\\''`)}' http://127.0.0.1:${LAB_PORT}/rpc`,
  ].join('\n')
  const result = await runSsh(host, remote)
  if (result.code !== 0) return { error: result.stderr || result.stdout }
  try {
    return JSON.parse(result.stdout) as unknown
  } catch {
    return { error: result.stdout }
  }
}

export async function acceptM6Plane(): Promise<{
  ok: boolean
  g1Health: Record<string, unknown>
  g2Health: Record<string, unknown>
  evidence: Record<string, unknown>
}> {
  const g1Hosts = await loadLabHosts()
  const g2Hosts = await loadM6Hosts()
  const g1Host = g1Hosts.hosts[0]
  const g2Host = g2Hosts.hosts[0]
  if (g1Host === undefined || g2Host === undefined) {
    throw new Error('M6 accept requires at least one first-group host and one second-group host')
  }
  const g1Status = await runSsh(
    g1Host.sshHost,
    `curl -fsS --max-time 5 http://127.0.0.1:${LAB_PORT}/health`,
  )
  const g2Status = await runSsh(
    g2Host.sshHost,
    `curl -fsS --max-time 5 http://127.0.0.1:${LAB_PORT}/health`,
  )
  const g1Health = parseHealthJson(g1Status.stdout)
  const g2Health = parseHealthJson(g2Status.stdout)
  const unknown = `0x${'ee'.repeat(32)}`
  const g2MarkerThisGroup = await rpcOnHost(g2Host.sshHost, 'dle_locateHash', [
    DLE_LAB_M6_MARKER_HASH,
    { thisGroupOnly: true },
  ])
  const g1MarkerThisGroup = await rpcOnHost(g1Host.sshHost, 'dle_locateHash', [
    DLE_LAB_M6_MARKER_HASH,
    { thisGroupOnly: true },
  ])
  const g1MarkerPlane = await rpcOnHost(g1Host.sshHost, 'dle_locateHash', [DLE_LAB_M6_MARKER_HASH])
  const g1UnknownThisGroup = await rpcOnHost(g1Host.sshHost, 'dle_locateHash', [
    unknown,
    { thisGroupOnly: true },
  ])
  const g2UnknownThisGroup = await rpcOnHost(g2Host.sshHost, 'dle_locateHash', [
    unknown,
    { thisGroupOnly: true },
  ])
  const planeUnknown = await rpcOnHost(g1Host.sshHost, 'dle_locateHash', [unknown])
  const planeBlock = await rpcOnHost(g1Host.sshHost, 'eth_getBlockByHash', [unknown, false])
  const g1Ids = Array.isArray(g1Health.liveGroupIds) ? (g1Health.liveGroupIds as string[]) : []
  const g2Ids = Array.isArray(g2Health.liveGroupIds) ? (g2Health.liveGroupIds as string[]) : []
  const twoGroups =
    g1Ids.includes(DLE_LAB_GROUP_ID) &&
    g1Ids.includes(DLE_LAB_M6_GROUP_ID) &&
    g2Ids.includes(DLE_LAB_GROUP_ID) &&
    g2Ids.includes(DLE_LAB_M6_GROUP_ID) &&
    g1Health.liveGroupCount === 2 &&
    g2Health.liveGroupCount === 2
  const g2Marker = rpcBody(g2MarkerThisGroup) as { status?: string; locator?: { chainNftId?: string } }
  const g1MarkerLocal = rpcBody(g1MarkerThisGroup) as { status?: string; planeWideNull?: boolean }
  const g1MarkerAcross = rpcBody(g1MarkerPlane) as { status?: string }
  const g1This = rpcBody(g1UnknownThisGroup) as { status?: string; planeWideNull?: boolean; scope?: string }
  const g2This = rpcBody(g2UnknownThisGroup) as { status?: string; planeWideNull?: boolean; scope?: string }
  const plane = rpcBody(planeUnknown) as { status?: string; planeWideNull?: boolean; scope?: string }
  const planeFacts =
    g2Marker.status === 'hit' &&
    g2Marker.locator?.chainNftId === DLE_LAB_M6_MARKER_NFT_ID &&
    g1MarkerLocal.status === 'notFound' &&
    g1MarkerLocal.planeWideNull === false &&
    g1MarkerAcross.status === 'hit' &&
    g1This.status === 'notFound' &&
    g1This.planeWideNull === false &&
    g1This.scope === 'thisGroup' &&
    g2This.status === 'notFound' &&
    g2This.planeWideNull === false &&
    plane.status === 'notFound' &&
    plane.planeWideNull === true &&
    plane.scope === 'allLiveGroups' &&
    rpcBody(planeBlock) === null
  const evidence = {
    schema: 'DleLabM6EvidenceV1',
    labOnly: true,
    notProductionDepin: true,
    notThirtyDayQualification: true,
    g2GroupIdIsLabHash: true,
    g2GroupIdNotL1RegisterTx: true,
    g1Host: g1Host.sshHost,
    g2Host: g2Host.sshHost,
    g1LiveGroupIds: g1Ids,
    g2LiveGroupIds: g2Ids,
    g2MarkerThisGroup,
    g1MarkerThisGroup,
    g1MarkerPlane,
    g1UnknownThisGroup,
    g2UnknownThisGroup,
    planeUnknown,
    planeBlock,
    twoGroups,
    planeFacts,
  }
  await mkdir(DEFAULT_M6_EVIDENCE_DIR, { recursive: true })
  await writeFile(
    resolve(DEFAULT_M6_EVIDENCE_DIR, 'm6-plane-accept.json'),
    `${JSON.stringify({ twoGroups, planeFacts, evidence, g1Health, g2Health }, null, 2)}\n`,
    'utf8',
  )
  return {
    ok: twoGroups && planeFacts && g1Status.code === 0 && g2Status.code === 0,
    g1Health,
    g2Health,
    evidence,
  }
}
