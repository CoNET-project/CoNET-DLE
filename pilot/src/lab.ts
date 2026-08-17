import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomInt, randomUUID } from 'node:crypto'
import { AppendOnlyNdjsonWriter, PublicEvidenceRedactor } from './evidence.js'
import { PilotQualificationGate } from './gate.js'
import { assertOperatorDomainPreflight, preflightOperatorDomains } from './inventory.js'
import type { MeterSampleV1, PilotInventoryV1 } from './model.js'
const DLE_LAB_GROUP_ID = '0x3076a806de71ab75b2d48063cc3f1e7d8f8e3d54cb1d45a7469c75c9276f2ad0'
const DLE_LAB_GROUP_ID_LEGACY = 'dle.lab.group.v1'

function sameGroupId(left: string, right: string): boolean {
  const canon = (raw: string): string => {
    const lower = raw.trim().toLowerCase()
    if (lower === DLE_LAB_GROUP_ID_LEGACY || lower === '1' || lower === '0x1') return DLE_LAB_GROUP_ID
    return /^0x[0-9a-f]{64}$/.test(lower) ? lower : raw.trim()
  }
  return canon(left) === canon(right)
}

export const PILOT_LAB_ID = 'conet-dle-30d-lab-2026-08'
export const LAB_PORT = 27101
export const LAB_DIR = '/home/peter/dle-30d-lab'
function extractJsonObject(stdout: string, marker: string): Record<string, unknown> {
  const start = stdout.indexOf(marker)
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

function extractArchiveHealthJson(stdout: string): Record<string, unknown> {
  return extractJsonObject(stdout, '{"ok":true,"command":"archive"')
}

function extractSyncStatusJson(stdout: string): Record<string, unknown> {
  return extractJsonObject(stdout, '{"schema":"ArchiveSyncQualificationLabV1"')
}

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
  /** Official roster may keep the seat; live SSH / keep / nginx must skip it. */
  retired?: boolean
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
export const DEFAULT_SYNC_JOIN_EVIDENCE_DIR = resolve(here, '../../evidence/conet-dle-sync-join-2026-08')
export const G1_SYNC_JOIN_KEEPER_DOMAIN_IDS = [
  'fd-01-ionos-45',
  'fd-02-ionos-189',
  'fd-03-ionos-98',
  'fd-04-hosthatch-tokyo1',
] as const
/** Old IONOS IPs retired from DLE TypeScript MVP. Seats stay live on remapped hosts. */
export const MVP_EXCLUDED_SSH_HOSTS = ['74.208.224.45', '198.251.77.98'] as const
export const MVP_EXCLUDED_INVENTORY_MARKS = [
  '74.208.224.45',
  '74-208-224-45',
  '198.251.77.98',
  '198-251-77-98',
] as const
/** No official seat is retired; only the two old IONOS IPs are excluded. */
export const MVP_RETIRED_DOMAIN_IDS = [] as const
/** Seat stays live; only old IONOS 74.208.224.45 is excluded. */
export const FD01_DOMAIN_ID = 'fd-01-ionos-45'
export const FD01_SSH_HOST = '45.132.74.220'
/** Seat stays live; only old IONOS 198.251.77.98 is excluded. */
export const FD03_DOMAIN_ID = 'fd-03-ionos-98'
export const FD03_SSH_HOST = '45.132.74.221'

export function isRetiredLabDomain(domainId: string): boolean {
  return (MVP_RETIRED_DOMAIN_IDS as readonly string[]).includes(domainId)
}

export function isRetiredLabHost(host: Pick<PilotLabHostV1, 'domainId' | 'retired'>): boolean {
  return host.retired === true || isRetiredLabDomain(host.domainId)
}

export function liveLabHosts(hosts: PilotLabHostsV1): PilotLabHostV1[] {
  return hosts.hosts.filter((row) => !isRetiredLabHost(row))
}

/** Keep / start L2 only on these remapped live keepers. Do not use official-seven keep (it would also start standby). */
export const REMAP_KEEP_L2_DOMAIN_IDS = [FD01_DOMAIN_ID, FD03_DOMAIN_ID] as const

/** Already-running live L2 peers that must refresh extraPeers after a remap. Never standby. */
export const REMAP_PEER_REFRESH_DOMAIN_IDS = [
  'fd-02-ionos-189',
  'fd-04-hosthatch-tokyo1',
  'fd-05-hosthatch-tokyo2',
] as const

export function selectLabKeepHosts(
  hosts: PilotLabHostsV1,
  onlyDomainIds?: readonly string[],
): PilotLabHostV1[] {
  if (onlyDomainIds === undefined || onlyDomainIds.length === 0) {
    return liveLabHosts(hosts)
  }
  const selected: PilotLabHostV1[] = []
  for (const domainId of onlyDomainIds) {
    const row = hosts.hosts.find((item) => item.domainId === domainId)
    if (!row) throw new Error(`keep target ${domainId} is not in official hosts`)
    if (isRetiredLabHost(row)) throw new Error(`refusing keep on retired ${domainId}`)
    assertMvpSshHostAllowed(row.sshHost)
    selected.push(row)
  }
  return selected
}

export function assertMvpSshHostAllowed(host: string): void {
  if ((MVP_EXCLUDED_SSH_HOSTS as readonly string[]).includes(host)) {
    throw new Error(`MVP excludes retired SSH host ${host}`)
  }
}

function assertRemappedLiveSeat(
  hosts: PilotLabHostsV1,
  domainId: string,
  sshHost: string,
): PilotLabHostV1 {
  const row = hosts.hosts.find((item) => item.domainId === domainId)
  if (!row) throw new Error(`MVP requires ${domainId}`)
  if (row.retired === true || isRetiredLabDomain(row.domainId)) {
    throw new Error(`${domainId} must stay live; do not retire the seat`)
  }
  if (row.sshHost !== sshHost) {
    throw new Error(`${domainId} must point at ${sshHost}`)
  }
  return row
}

export function assertOfficialLabMvpHosts(hosts: PilotLabHostsV1, inventory?: PilotInventoryV1): void {
  assertRemappedLiveSeat(hosts, FD01_DOMAIN_ID, FD01_SSH_HOST)
  assertRemappedLiveSeat(hosts, FD03_DOMAIN_ID, FD03_SSH_HOST)
  for (const row of hosts.hosts) {
    if (isRetiredLabHost(row)) continue
    assertMvpSshHostAllowed(row.sshHost)
  }
  if (!inventory) return
  const blob = JSON.stringify(inventory.domains)
  for (const mark of MVP_EXCLUDED_INVENTORY_MARKS) {
    if (blob.includes(mark)) {
      throw new Error(`MVP inventory still references excluded host ${mark}`)
    }
  }
  const fd01Row = inventory.domains.find((domain) => domain.domainId === FD01_DOMAIN_ID)
  if (!fd01Row) throw new Error(`MVP inventory missing ${FD01_DOMAIN_ID}`)
  if (/RETIRED/i.test(fd01Row.operatorLegalName)) {
    throw new Error(`${FD01_DOMAIN_ID} inventory must stay live`)
  }
  if (!fd01Row.hostId.includes('45-132-74-220')) {
    throw new Error(`${FD01_DOMAIN_ID} inventory must use HostHatch 45.132.74.220`)
  }
  const fd03Row = inventory.domains.find((domain) => domain.domainId === FD03_DOMAIN_ID)
  if (!fd03Row) throw new Error(`MVP inventory missing ${FD03_DOMAIN_ID}`)
  if (/RETIRED/i.test(fd03Row.operatorLegalName)) {
    throw new Error(`${FD03_DOMAIN_ID} inventory must stay live`)
  }
  if (!fd03Row.hostId.includes('45-132-74-221')) {
    throw new Error(`${FD03_DOMAIN_ID} inventory must use HostHatch 45.132.74.221`)
  }
}

/** Only wipe-safe G1 joiners. Keepers are never in this set. */
export const G1_SYNC_JOIN_WIPE_SAFE_DOMAIN_IDS = [
  'fd-05-hosthatch-tokyo2',
  'fd-06-ionos-174',
  'fd-07-ionos-207',
] as const
/** Only wipe-safe active. Standby-only wipe would not freeze cataloguing. */
export const G1_SYNC_JOIN_REQUIRED_ACTIVE_WIPE = 'fd-05-hosthatch-tokyo2' as const
const G1_SYNC_JOIN_WIPE_SAFE_STANDBY_IDS = ['fd-06-ionos-174', 'fd-07-ionos-207'] as const
/** @deprecated Prefer resolveWipeJoinDomainIds(); kept as the historical P7 pair. */
export const G1_SYNC_JOIN_WIPE_DOMAIN_IDS = ['fd-05-hosthatch-tokyo2', 'fd-07-ionos-207'] as const
/** Extra standby joiner for P11 full-open from-zero. Never official 5+2. Never wipe fd-01..07. */
export const P11_JOINER_DOMAIN_ID = 'fd-08-hosthatch-hk1'
export const P11_JOINER_SSH_HOST = '167.104.98.104'
export const P11_JOINER_ROLE = 'standby' as const
export const DEFAULT_P11_JOINER_HOSTS_PATH = resolve(here, '../../lab/hosts-p11-joiner.json')

export function pickRandomWipeJoiners(options?: {
  count?: number
  randomInt?: (maxExclusive: number) => number
}): string[] {
  const total = options?.count ?? 2
  if (total < 2 || total > G1_SYNC_JOIN_WIPE_SAFE_DOMAIN_IDS.length) {
    throw new Error('P8d wipe count must be 2 or 3 wipe-safe hosts')
  }
  const rand = options?.randomInt ?? ((maxExclusive: number) => randomInt(maxExclusive))
  const standbys = [...G1_SYNC_JOIN_WIPE_SAFE_STANDBY_IDS]
  for (let i = standbys.length - 1; i > 0; i -= 1) {
    const j = rand(i + 1)
    const current = standbys[i]!
    standbys[i] = standbys[j]!
    standbys[j] = current
  }
  const extra = total - 1
  return [G1_SYNC_JOIN_REQUIRED_ACTIVE_WIPE, ...standbys.slice(0, extra)].sort()
}

export function resolveWipeJoinDomainIds(): string[] {
  const raw = process.env.LAB_SYNC_JOIN_WIPE_DOMAIN_IDS?.trim()
  if (!raw) return pickRandomWipeJoiners()
  const ids = [...new Set(raw.split(',').map((item) => item.trim()).filter(Boolean))].sort()
  for (const id of ids) {
    if ((G1_SYNC_JOIN_KEEPER_DOMAIN_IDS as readonly string[]).includes(id)) {
      throw new Error(`refusing to wipe keeper ${id}`)
    }
    if (!(G1_SYNC_JOIN_WIPE_SAFE_DOMAIN_IDS as readonly string[]).includes(id)) {
      throw new Error(`wipe target ${id} is not wipe-safe`)
    }
  }
  if (!ids.includes(G1_SYNC_JOIN_REQUIRED_ACTIVE_WIPE)) {
    throw new Error('P8d freeze requires wiping the only wipe-safe active fd-05')
  }
  return ids
}
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
export const HTTP_QUEUE_GROUP_ID = DLE_LAB_GROUP_ID
export const DEFAULT_FLEET_DIST_DIR = resolve(LAYER2_ROOT, 'runtime/dist/fleet')
export const REMOTE_FLEET_ENTRY = `${HTTP_QUEUE_CLIENT_DIR}/app/daemon/fleet-cli.js`
export const NEWCHAIN_USER_HOST = HTTP_QUEUE_CLIENT_HOST
export const NEWCHAIN_USER_DIR = '/home/peter/dle-newchain-user'
export const DEFAULT_NEWCHAIN_USER_DIST_DIR = resolve(LAYER2_ROOT, 'runtime/dist/newchain-user')
export const REMOTE_NEWCHAIN_USER_ENTRY = `${NEWCHAIN_USER_DIR}/app/daemon/newchain-user-cli.js`
export const LAB_BFT_CHAIN_NFT_ID = '42'

export async function loadOfficialLabInventory(path = DEFAULT_INVENTORY_PATH): Promise<PilotInventoryV1> {
  const inventory = JSON.parse(await readFile(path, 'utf8')) as PilotInventoryV1
  assertOperatorDomainPreflight(inventory)
  if (inventory.pilotId !== PILOT_LAB_ID) {
    throw new Error(`unexpected pilotId ${inventory.pilotId}`)
  }
  const blob = JSON.stringify(inventory.domains)
  for (const mark of MVP_EXCLUDED_INVENTORY_MARKS) {
    if (blob.includes(mark)) {
      throw new Error(`MVP inventory still references excluded host ${mark}`)
    }
  }
  const fd01 = inventory.domains.find((domain) => domain.domainId === FD01_DOMAIN_ID)
  if (!fd01 || /RETIRED/i.test(fd01.operatorLegalName) || !fd01.hostId.includes('45-132-74-220')) {
    throw new Error(`${FD01_DOMAIN_ID} inventory must stay live on HostHatch 45.132.74.220`)
  }
  const fd03 = inventory.domains.find((domain) => domain.domainId === FD03_DOMAIN_ID)
  if (!fd03 || /RETIRED/i.test(fd03.operatorLegalName) || !fd03.hostId.includes('45-132-74-221')) {
    throw new Error(`${FD03_DOMAIN_ID} inventory must stay live on HostHatch 45.132.74.221`)
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
  assertOfficialLabMvpHosts(hosts)
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
      detail: `providers=${[...providers].join(',')}; fd-01 remapped to HostHatch NYC 45.132.74.220; fd-03 remapped to HostHatch NYC 45.132.74.221`,
    },
    {
      check: 'asn-diversity-honest',
      ok: asns.size >= 2,
      detail: `asns=${[...asns].join(',')}; AS8560 still covers three leftover IONOS leases`,
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
  assertMvpSshHostAllowed(host)
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

export async function runLocal(
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
  assertMvpSshHostAllowed(host)
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

const SSH_RETRY_ATTEMPTS = 4

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms)
  })
}

function isTransientRemoteError(text: string, code?: number): boolean {
  if (code === 3 || /PROTECTED/.test(text)) return false
  return (
    code === 255 ||
    /Connection closed|Connection reset|Connection timed out|Broken pipe|kex_exchange_identification|Connection refused|No route to host|Operation timed out/i.test(
      text,
    )
  )
}

export async function runSshRetry(
  host: string,
  remoteCommand: string,
  attempts = SSH_RETRY_ATTEMPTS,
): Promise<{ code: number; stdout: string; stderr: string }> {
  let last = { code: 1, stdout: '', stderr: '' }
  for (let i = 0; i < attempts; i += 1) {
    last = await runSsh(host, remoteCommand)
    if (last.code === 0) return last
    const text = `${last.stderr}\n${last.stdout}`
    if (!isTransientRemoteError(text, last.code) || i === attempts - 1) return last
    await sleep(1500 * (i + 1))
  }
  return last
}

export async function runScpRetry(
  localPath: string,
  host: string,
  remotePath: string,
  attempts = SSH_RETRY_ATTEMPTS,
): Promise<void> {
  let lastError: unknown
  for (let i = 0; i < attempts; i += 1) {
    try {
      await runScp(localPath, host, remotePath)
      return
    } catch (error) {
      lastError = error
      const text = error instanceof Error ? error.message : String(error)
      if (!isTransientRemoteError(text, 255) || i === attempts - 1) throw error
      await sleep(1500 * (i + 1))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

export interface LabPeerSpec {
  domainId: string
  host: string
  port: number
  role: string
}

export interface AgentConfigExtras {
  autoSeedLabMiners?: boolean
  autoFreeze?: boolean
  ownGroupId?: string
  enableBft?: boolean
  enableOndemand?: boolean
  seedFissionMarker?: boolean
  extraPeers?: LabPeerSpec[]
  planeDirectory?: Array<{
    groupId: string
    wallets: Array<{ domainId: string; role: string; url?: string; labOnly: true }>
  }>
  foreignChains?: Array<{ chainNftId: string; groupId: string }>
}

export function p11JoinerPeer(): LabPeerSpec {
  return {
    domainId: P11_JOINER_DOMAIN_ID,
    host: P11_JOINER_SSH_HOST,
    port: LAB_PORT,
    role: P11_JOINER_ROLE,
  }
}

export function p11JoinerHost(): PilotLabHostV1 {
  return {
    domainId: P11_JOINER_DOMAIN_ID,
    sshHost: P11_JOINER_SSH_HOST,
    class: 'greenfield-lab',
    leftoverElCl: false,
    doNotStartValidator: true,
    notes:
      'P11 extra standby joiner. HostHatch HK1 167.104.98.104. Empty datadir only. Never official 5+2. Never wipe fd-01..07.',
  }
}

export async function loadP11JoinerHost(path = DEFAULT_P11_JOINER_HOSTS_PATH): Promise<PilotLabHostV1> {
  const file = JSON.parse(await readFile(path, 'utf8')) as {
    schema?: string
    joiner?: PilotLabHostV1
  }
  if (file.schema !== 'PilotLabP11JoinerV1' || file.joiner === undefined) {
    throw new Error('p11 joiner schema is invalid')
  }
  if (file.joiner.domainId !== P11_JOINER_DOMAIN_ID) {
    throw new Error(`p11 joiner domain mismatch ${file.joiner.domainId}`)
  }
  if (file.joiner.sshHost !== P11_JOINER_SSH_HOST) {
    throw new Error(`p11 joiner host mismatch ${file.joiner.sshHost}`)
  }
  return file.joiner
}

export function assertP11JoinerOutsideOfficial(
  inventory: PilotInventoryV1,
  hosts: PilotLabHostsV1,
  joiner: PilotLabHostV1,
): void {
  if (inventory.domains.some((domain) => domain.domainId === joiner.domainId)) {
    throw new Error(`P11 joiner ${joiner.domainId} must not be in official inventory`)
  }
  if (hosts.hosts.some((host) => host.domainId === joiner.domainId || host.sshHost === joiner.sshHost)) {
    throw new Error('P11 joiner must not be in official hosts.json')
  }
  if (hosts.hosts.length !== 7 || inventory.domains.length !== 7) {
    throw new Error('official G1 roster must stay exactly 7')
  }
}

function mergeAgentPeers(
  official: LabPeerSpec[],
  extra: LabPeerSpec[] | undefined,
  selfDomainId: string,
): LabPeerSpec[] {
  const merged: LabPeerSpec[] = []
  const seen = new Set<string>()
  for (const peer of [...official, ...(extra ?? [])]) {
    if (peer.domainId === selfDomainId || seen.has(peer.domainId)) continue
    seen.add(peer.domainId)
    merged.push(peer)
  }
  return merged
}

export function appendExtraPlaneWallet(
  directory: AgentConfigExtras['planeDirectory'],
  groupId: string,
  wallet: { domainId: string; role: string; url: string; labOnly: true },
): NonNullable<AgentConfigExtras['planeDirectory']> {
  const rows = (directory ?? []).map((group) => ({
    ...group,
    wallets: [...group.wallets],
  }))
  const index = rows.findIndex((group) => group.groupId === groupId)
  if (index < 0) {
    rows.push({ groupId, wallets: [wallet] })
    return rows
  }
  if (!rows[index]!.wallets.some((item) => item.domainId === wallet.domainId)) {
    rows[index]!.wallets.push(wallet)
  }
  return rows
}

function applyAgentConfigExtras(config: Record<string, unknown>, extras?: AgentConfigExtras): void {
  if (extras?.autoSeedLabMiners !== undefined) config.autoSeedLabMiners = extras.autoSeedLabMiners
  if (extras?.autoFreeze !== undefined) config.autoFreeze = extras.autoFreeze
  if (extras?.ownGroupId !== undefined) config.ownGroupId = extras.ownGroupId
  if (extras?.enableBft !== undefined) config.enableBft = extras.enableBft
  if (extras?.enableOndemand !== undefined) config.enableOndemand = extras.enableOndemand
  if (extras?.seedFissionMarker !== undefined) config.seedFissionMarker = extras.seedFissionMarker
  if (extras?.planeDirectory !== undefined) config.planeDirectory = extras.planeDirectory
  if (extras?.foreignChains !== undefined) config.foreignChains = extras.foreignChains
}

export function planeDirectoryFromHosts(
  groupId: string,
  hosts: PilotLabHostsV1,
  inventory: PilotInventoryV1,
): AgentConfigExtras['planeDirectory'] {
  return [
    {
      groupId,
      wallets: liveLabHosts(hosts).map((item) => {
        const peerDomain = inventory.domains.find((row) => row.domainId === item.domainId)
        return {
          domainId: item.domainId,
          role: peerDomain?.role ?? 'standby',
          url: `http://${item.sshHost}:${hosts.labPort}`,
          labOnly: true as const,
        }
      }),
    },
  ]
}

export function agentConfigFor(
  inventory: PilotInventoryV1,
  hosts: PilotLabHostsV1,
  domainId: string,
  extras?: AgentConfigExtras,
): Record<string, unknown> {
  const domain = inventory.domains.find((item) => item.domainId === domainId)
  const self = hosts.hosts.find((item) => item.domainId === domainId)
  if (!domain || !self) throw new Error(`unknown domain ${domainId}`)
  if (isRetiredLabHost(self)) throw new Error(`refusing agent config for retired ${domainId}`)
  const officialPeers = liveLabHosts(hosts)
    .filter((item) => item.domainId !== domainId)
    .map((item) => {
      const peerDomain = inventory.domains.find((row) => row.domainId === item.domainId)
      return {
        domainId: item.domainId,
        host: item.sshHost,
        port: hosts.labPort,
        role: peerDomain?.role ?? 'standby',
      }
    })
  const config: Record<string, unknown> = {
    schema: 'DleLabAgentConfigV1',
    agent: 'dle-30d-lab',
    domainId,
    role: domain.role,
    port: hosts.labPort,
    isolatedFromElCl: true,
    doNotStartValidator: true,
    protectedProcessNames: hosts.protectedProcessNames,
    peers: mergeAgentPeers(officialPeers, extras?.extraPeers, domainId),
  }
  applyAgentConfigExtras(config, extras)
  return config
}

export function agentConfigForJoiner(
  inventory: PilotInventoryV1,
  hosts: PilotLabHostsV1,
  joiner: PilotLabHostV1,
  extras?: AgentConfigExtras,
): Record<string, unknown> {
  assertP11JoinerOutsideOfficial(inventory, hosts, joiner)
  const officialPeers = liveLabHosts(hosts).map((item) => {
    const peerDomain = inventory.domains.find((row) => row.domainId === item.domainId)
    return {
      domainId: item.domainId,
      host: item.sshHost,
      port: hosts.labPort,
      role: peerDomain?.role ?? 'standby',
    }
  })
  const config: Record<string, unknown> = {
    schema: 'DleLabAgentConfigV1',
    agent: 'dle-30d-lab',
    domainId: joiner.domainId,
    role: P11_JOINER_ROLE,
    port: hosts.labPort,
    isolatedFromElCl: true,
    doNotStartValidator: true,
    protectedProcessNames: hosts.protectedProcessNames,
    peers: mergeAgentPeers(officialPeers, extras?.extraPeers, joiner.domainId),
  }
  applyAgentConfigExtras(config, extras)
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
    if (isRetiredLabHost(host)) {
      results.push({
        domainId: host.domainId,
        host: host.sshHost,
        ok: true,
        detail: 'retired-skip-no-start',
      })
      continue
    }
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
  'protect_pid() {',
  '  comm=$(ps -p "$1" -o comm= || true)',
  '  args=$(ps -p "$1" -o args= || true)',
  '  case "$comm $args" in',
  '    *geth*|*beacon-chain*|*validator*|*prysm*) echo PROTECTED; exit 3 ;;',
  '  esac',
  '}',
  'for pattern in "[n]ode .*dle-30d-lab/agent.mjs" "[n]ode .*dle-30d-lab/app/archive/lab-cli.js"; do',
  '  PIDS=$(pgrep -f "$pattern" || true)',
  '  for pid in $PIDS; do',
  '    protect_pid "$pid"',
  '    kill -TERM "$pid" || true',
  '    echo STOPPED=$pid',
  '  done',
  'done',
  'for _ in 1 2 3 4 5 6 7 8; do',
  '  leftover=$(pgrep -f "[n]ode .*dle-30d-lab/(agent.mjs|app/archive/lab-cli.js)" || true)',
  '  [ -z "$leftover" ] && break',
  '  sleep 1',
  'done',
  'leftover=$(pgrep -f "[n]ode .*dle-30d-lab/(agent.mjs|app/archive/lab-cli.js)" || true)',
  'for pid in $leftover; do',
  '  protect_pid "$pid"',
  '  kill -KILL "$pid" || true',
  '  echo KILLED=$pid',
  'done',
].join('\n')

const WAIT_ARCHIVE_LIVENESS = [
  'ok=0',
  'for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do',
  `  if curl -fsS --max-time 3 http://127.0.0.1:${LAB_PORT}/liveness 2>/dev/null | grep -q '"ok":true'; then`,
  '    echo LIVE_OK',
  '    ok=1',
  '    break',
  '  fi',
  '  sleep 2',
  'done',
  'test "$ok" = 1',
].join('\n')

const START_ARCHIVE = [
  'set -euo pipefail',
  `rm -rf '${LAB_DIR}/data'`,
  `mkdir -p '${LAB_DIR}/app' '${LAB_DIR}/data' '${LAB_DIR}/daemon' '${LAB_DIR}/wal'`,
  `cd '${LAB_DIR}'`,
  `if [ -x '${LAB_DIR}/runtime/bin/node' ]; then NODE='${LAB_DIR}/runtime/bin/node'; else NODE=$(command -v node); fi`,
  `nohup "$NODE" '${REMOTE_ARCHIVE_ENTRY}' --config '${LAB_DIR}/config.json' --data-dir '${LAB_DIR}/data' >> '${LAB_DIR}/archive.log' 2>&1 &`,
  'echo STARTED=$!',
  WAIT_ARCHIVE_LIVENESS,
].join('\n')

const START_ARCHIVE_WIPE = [
  'set -euo pipefail',
  `rm -rf '${LAB_DIR}/data'`,
  `mkdir -p '${LAB_DIR}/app' '${LAB_DIR}/data' '${LAB_DIR}/daemon' '${LAB_DIR}/wal'`,
  `cd '${LAB_DIR}'`,
  `if [ -x '${LAB_DIR}/runtime/bin/node' ]; then NODE='${LAB_DIR}/runtime/bin/node'; else NODE=$(command -v node); fi`,
  `nohup "$NODE" '${REMOTE_ARCHIVE_ENTRY}' --config '${LAB_DIR}/config.json' --data-dir '${LAB_DIR}/data' >> '${LAB_DIR}/archive.log' 2>&1 &`,
  'echo STARTED=$!',
  WAIT_ARCHIVE_LIVENESS,
].join('\n')

const START_ARCHIVE_KEEP_BFT = [
  'set -euo pipefail',
  `mkdir -p '${LAB_DIR}/app' '${LAB_DIR}/data' '${LAB_DIR}/daemon' '${LAB_DIR}/wal'`,
  `rm -f '${LAB_DIR}/data/ondemand-state.json'`,
  `cd '${LAB_DIR}'`,
  `if [ -x '${LAB_DIR}/runtime/bin/node' ]; then NODE='${LAB_DIR}/runtime/bin/node'; else NODE=$(command -v node); fi`,
  `nohup "$NODE" '${REMOTE_ARCHIVE_ENTRY}' --config '${LAB_DIR}/config.json' --data-dir '${LAB_DIR}/data' >> '${LAB_DIR}/archive.log' 2>&1 &`,
  'echo STARTED=$!',
  WAIT_ARCHIVE_LIVENESS,
].join('\n')

const START_ARCHIVE_KEEP_ALL = [
  'set -euo pipefail',
  `mkdir -p '${LAB_DIR}/app' '${LAB_DIR}/data' '${LAB_DIR}/daemon' '${LAB_DIR}/wal'`,
  `cd '${LAB_DIR}'`,
  `if [ -x '${LAB_DIR}/runtime/bin/node' ]; then NODE='${LAB_DIR}/runtime/bin/node'; else NODE=$(command -v node); fi`,
  `nohup "$NODE" '${REMOTE_ARCHIVE_ENTRY}' --config '${LAB_DIR}/config.json' --data-dir '${LAB_DIR}/data' >> '${LAB_DIR}/archive.log' 2>&1 &`,
  'echo STARTED=$!',
  WAIT_ARCHIVE_LIVENESS,
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

const PROBE_P11_JOINER = [
  'set +e',
  'echo HOST=$(hostname)',
  'echo USER=$(whoami)',
  'echo MEM=$(free -h | awk \'/Mem:/{print $2,$3,$7}\')',
  'echo DISK=$(df -h / | awk \'NR==2{print $2,$3,$4}\')',
  `echo LAB_DIR_EXISTS=$([ -d '${LAB_DIR}' ] && echo yes || echo no)`,
  `echo LAB_DATA=$([ -d '${LAB_DIR}/data' ] && echo yes || echo no)`,
  `echo ARCHIVE_PIDS=$(pgrep -f '[n]ode .*dle-30d-lab/app/archive/lab-cli.js' | tr '\\n' ' ')`,
  `echo AGENT_PIDS=$(pgrep -f '[n]ode .*dle-30d-lab/agent.mjs' | tr '\\n' ' ')`,
  "echo GETH=$(pgrep -x geth | tr '\\n' ' ')",
  "echo BEACON=$(pgrep -x beacon-chain | tr '\\n' ' ')",
  "echo VALIDATOR=$(pgrep -x validator | tr '\\n' ' ')",
  'echo NODE=$(command -v node || true)',
  `curl -fsS --max-time 3 http://127.0.0.1:${LAB_PORT}/health 2>/dev/null || echo HEALTH=down`,
].join('\n')

const SYNC_STATUS_ONLY = [
  'set +e',
  `curl -fsS --max-time 8 http://127.0.0.1:${LAB_PORT}/sync/status 2>/dev/null || echo SYNC=down`,
].join('\n')

const HEALTH_SEATING_ONLY = [
  'set +e',
  `curl -fsS --max-time 8 http://127.0.0.1:${LAB_PORT}/health 2>/dev/null || echo HEALTH=down`,
].join('\n')

export async function deployArchiveRuntime(options?: {
  inventoryPath?: string
  hostsPath?: string
  archiveDistDir?: string
  daemonProbePath?: string
  keepData?: boolean
  extras?: AgentConfigExtras
  onlyDomainIds?: readonly string[]
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
  for (const host of selectLabKeepHosts(hosts, options?.onlyDomainIds)) {
    if (isRetiredLabHost(host)) {
      results.push({
        domainId: host.domainId,
        host: host.sshHost,
        ok: true,
        detail: 'retired-skip-no-start',
      })
      continue
    }
    const ensure = await runSshRetry(host.sshHost, ENSURE_NODE)
    if (ensure.code !== 0) {
      results.push({
        domainId: host.domainId,
        host: host.sshHost,
        ok: false,
        detail: ensure.stderr || ensure.stdout || `ssh exit ${ensure.code}`,
      })
      continue
    }
    const config = agentConfigFor(inventory, hosts, host.domainId, options?.extras)
    const tmpConfig = `/tmp/dle-lab-${host.domainId}.json`
    await writeFile(tmpConfig, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    try {
      await runSshRetry(
        host.sshHost,
        `mkdir -p '${LAB_DIR}/app' '${LAB_DIR}/data' '${LAB_DIR}/daemon' '${LAB_DIR}/wal'`,
      )
      await runScpRetry(bundlePath, host.sshHost, '/tmp/dle-archive-runtime.tgz')
      await runScpRetry(tmpConfig, host.sshHost, `${LAB_DIR}/config.json`)
      await runScpRetry(daemonProbePath, host.sshHost, REMOTE_DAEMON_PROBE)
    } catch (error) {
      results.push({
        domainId: host.domainId,
        host: host.sshHost,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      })
      continue
    }
    const unpacked = await runSshRetry(
      host.sshHost,
      `rm -rf '${LAB_DIR}/app' && mkdir -p '${LAB_DIR}/app' && tar -xzf /tmp/dle-archive-runtime.tgz -C '${LAB_DIR}/app'`,
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
    const stopped = await runSshRetry(host.sshHost, STOP_LAB_ONLY)
    if (stopped.code !== 0) {
      results.push({
        domainId: host.domainId,
        host: host.sshHost,
        ok: false,
        detail: stopped.stderr || stopped.stdout || 'refused to stop protected process',
      })
      continue
    }
    const started = await runSshRetry(host.sshHost, options?.keepData === true ? START_ARCHIVE_KEEP_ALL : START_ARCHIVE)
    const healthOk = started.stdout.includes('LIVE_OK') || started.stdout.includes('"command":"archive"')
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
  const live = liveLabHosts(hosts)
  const expectedPeers = live.length
  const peerCurl = live
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
  for (const host of live) {
    const result = await runSsh(host.sshHost, acceptScript)
    const stdout = result.stdout
    const health = extractArchiveHealthJson(stdout)
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
  for (const host of liveLabHosts(hosts)) {
    const result = await runSsh(host.sshHost, acceptScript)
    const stdout = result.stdout
    const health = extractArchiveHealthJson(stdout)
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
  for (const host of liveLabHosts(hosts)) {
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
  return liveLabHosts(hosts).map((host) => `http://${host.sshHost}:${hosts.labPort}`)
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
    if (isRetiredLabHost(host)) {
      results.push({
        domainId: host.domainId,
        host: host.sshHost,
        ok: true,
        detail: 'retired-skip-no-start',
      })
      continue
    }
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
      `rm -rf '${LAB_DIR}/app' && mkdir -p '${LAB_DIR}/app' && tar -xzf /tmp/dle-archive-runtime.tgz -C '${LAB_DIR}/app'`,
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

const STOP_NEWCHAIN_USER = [
  'set -euo pipefail',
  `PIDS=$(pgrep -f '[n]ode .*dle-newchain-user/' || true)`,
  'for pid in $PIDS; do',
  '  comm=$(ps -p "$pid" -o comm= || true)',
  '  args=$(ps -p "$pid" -o args= || true)',
  '  case "$comm $args" in',
  '    *geth*|*beacon-chain*|*validator*|*prysm*) echo PROTECTED; exit 3 ;;',
  '    *dle-30d-lab*) echo PROTECTED_LAB; exit 3 ;;',
  '    *dle-ondemand-clients*) echo PROTECTED_ONDEMAND; exit 3 ;;',
  '  esac',
  '  kill -TERM "$pid" || true',
  '  echo STOPPED=$pid',
  'done',
  'sleep 1',
].join('\n')

const START_NEWCHAIN_USER = [
  'set -euo pipefail',
  `mkdir -p '${NEWCHAIN_USER_DIR}/data'`,
  `cd '${NEWCHAIN_USER_DIR}'`,
  'NODE=$(command -v node)',
  `PIDS=$(pgrep -f '[n]ode .*dle-newchain-user/' || true)`,
  'if [ -n "$PIDS" ]; then echo ALREADY=$PIDS; exit 0; fi',
  `nohup "$NODE" '${REMOTE_NEWCHAIN_USER_ENTRY}' --archives-file '${NEWCHAIN_USER_DIR}/archives.json' --data-dir '${NEWCHAIN_USER_DIR}/data' >> '${NEWCHAIN_USER_DIR}/user.log' 2>&1 &`,
  'echo STARTED=$!',
  'sleep 2',
  `echo USER_PIDS=$(pgrep -f '[n]ode .*dle-newchain-user/' | tr '\\n' ' ')`,
].join('\n')

function classCounts(chains: unknown): { asset: number; storage: number; trade: number } {
  const counts = { asset: 0, storage: 0, trade: 0 }
  if (!Array.isArray(chains)) return counts
  for (const row of chains) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) continue
    const name = (row as { className?: unknown }).className
    if (name === 'asset' || name === 'storage' || name === 'trade') counts[name] += 1
  }
  return counts
}

export async function deployNewChainUser(options?: {
  hostsPath?: string
  userDistDir?: string
  waitMs?: number
}): Promise<{
  ok: boolean
  clientHost: string
  genesis: { asset: boolean; storage: boolean; trade: boolean }
  archiveAgree: boolean
  nft42Alive: boolean
  ondemandUntouched: boolean
  results: unknown
}> {
  const hosts = await loadLabHosts(options?.hostsPath)
  const userDistDir = options?.userDistDir ?? DEFAULT_NEWCHAIN_USER_DIST_DIR
  const bundlePath = '/tmp/dle-newchain-user.tgz'
  await runLocal('tar', ['-czf', bundlePath, '--exclude', '._*', '-C', userDistDir, '.'], {
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  })
  const archives = httpArchiveUrls(hosts)
  const archivesFile = {
    schema: 'DleLabNewChainArchivesV1',
    groupId: HTTP_QUEUE_GROUP_ID,
    archives,
  }
  const tmpArchives = '/tmp/dle-newchain-archives.json'
  await writeFile(tmpArchives, `${JSON.stringify(archivesFile, null, 2)}\n`, 'utf8')
  const ensure = await runSsh(
    NEWCHAIN_USER_HOST,
    `mkdir -p '${NEWCHAIN_USER_DIR}/app' '${NEWCHAIN_USER_DIR}/data'`,
  )
  if (ensure.code !== 0) {
    return {
      ok: false,
      clientHost: NEWCHAIN_USER_HOST,
      genesis: { asset: false, storage: false, trade: false },
      archiveAgree: false,
      nft42Alive: false,
      ondemandUntouched: true,
      results: ensure.stderr || ensure.stdout,
    }
  }
  const ondemandBefore = await runSsh(
    NEWCHAIN_USER_HOST,
    `pgrep -f '[n]ode .*dle-ondemand-clients/' | tr '\\n' ' ' || true`,
  )
  const stopped = await runSsh(NEWCHAIN_USER_HOST, STOP_NEWCHAIN_USER)
  if (stopped.code !== 0) {
    return {
      ok: false,
      clientHost: NEWCHAIN_USER_HOST,
      genesis: { asset: false, storage: false, trade: false },
      archiveAgree: false,
      nft42Alive: false,
      ondemandUntouched: true,
      results: stopped.stderr || stopped.stdout || 'refused to stop protected process',
    }
  }
  await runScp(bundlePath, NEWCHAIN_USER_HOST, '/tmp/dle-newchain-user.tgz')
  await runScp(tmpArchives, NEWCHAIN_USER_HOST, `${NEWCHAIN_USER_DIR}/archives.json`)
  const unpacked = await runSsh(
    NEWCHAIN_USER_HOST,
    `rm -rf '${NEWCHAIN_USER_DIR}/app' && mkdir -p '${NEWCHAIN_USER_DIR}/app' && tar -xzf /tmp/dle-newchain-user.tgz -C '${NEWCHAIN_USER_DIR}/app' && printf '%s\\n' '{"type":"module","private":true,"name":"@conet/dle-newchain-user"}' > '${NEWCHAIN_USER_DIR}/app/package.json'`,
  )
  if (unpacked.code !== 0) {
    return {
      ok: false,
      clientHost: NEWCHAIN_USER_HOST,
      genesis: { asset: false, storage: false, trade: false },
      archiveAgree: false,
      nft42Alive: false,
      ondemandUntouched: true,
      results: unpacked.stderr || unpacked.stdout,
    }
  }
  const started = await runSsh(NEWCHAIN_USER_HOST, START_NEWCHAIN_USER)
  const ondemandAfter = await runSsh(
    NEWCHAIN_USER_HOST,
    `pgrep -f '[n]ode .*dle-ondemand-clients/' | tr '\\n' ' ' || true`,
  )
  const ondemandUntouched = ondemandBefore.stdout.trim() === ondemandAfter.stdout.trim()
  const deadline = Date.now() + (options?.waitMs ?? 120_000)
  let genesis = { asset: false, storage: false, trade: false }
  let archiveAgree = false
  let nft42Alive = false
  let hashHit = false
  let lastLists: unknown = null
  let sampleNft: string | null = null
  let sampleHash: string | null = null
  while (Date.now() < deadline) {
    const lists = []
    for (const url of archives) {
      try {
        const list = await fetchArchiveJson(`${url}/newchain/chains`)
        const health = await fetchArchiveJson(`${url}/health`)
        const route42 = await fetchArchiveJson(`${url}/api/v2/dle/route/${LAB_BFT_CHAIN_NFT_ID}`)
        const counts = classCounts(list.chains)
        lists.push({
          url,
          count: list.count,
          counts,
          newchainCount: health.newchainCount,
          certificateAvailable: health.bftCertificateAvailable,
          route42: route42.groupId,
        })
        if (Array.isArray(list.chains) && list.chains[0] !== undefined && isRecordish(list.chains[0])) {
          const first = list.chains[0] as { chainNftId?: unknown; valueHash?: unknown }
          if (typeof first.chainNftId === 'string') sampleNft = first.chainNftId
          if (typeof first.valueHash === 'string') sampleHash = first.valueHash
        }
      } catch (error) {
        lists.push({ url, error: error instanceof Error ? error.message : String(error) })
      }
    }
    lastLists = lists
    genesis = {
      asset: lists.every((row) => 'counts' in row && row.counts?.asset >= 1),
      storage: lists.every((row) => 'counts' in row && row.counts?.storage >= 1),
      trade: lists.every((row) => 'counts' in row && row.counts?.trade >= 1),
    }
    const requestSets = lists
      .map((row) => ('counts' in row ? JSON.stringify(row.counts) : ''))
      .filter((item) => item !== '')
    archiveAgree = requestSets.length === archives.length && requestSets.every((item) => item === requestSets[0])
    nft42Alive = lists.every(
      (row) =>
        'certificateAvailable' in row &&
        row.certificateAvailable === true &&
        sameGroupId(String(row.route42 ?? ''), HTTP_QUEUE_GROUP_ID),
    )
    if (sampleNft !== null && sampleHash !== null) {
      try {
        const route = await fetchArchiveJson(`${archives[0]}/api/v2/dle/route/${sampleNft}`)
        const hashed = await fetchArchiveJson(`${archives[0]}/api/v2/dle/hash/${sampleHash}`)
        hashHit = sameGroupId(String(route.groupId ?? ''), HTTP_QUEUE_GROUP_ID) && hashed.status === 'hit'
      } catch {
        hashHit = false
      }
    }
    if (genesis.asset && genesis.storage && genesis.trade && archiveAgree && nft42Alive && hashHit) break
    await delay(5_000)
  }
  const evidence = {
    schema: 'DleLabNewChainUserDeployV1',
    pilotId: PILOT_LAB_ID,
    acceptedAt: new Date().toISOString(),
    clientHost: NEWCHAIN_USER_HOST,
    clientDir: NEWCHAIN_USER_DIR,
    labOnly: true,
    notL1Nft: true,
    note: 'Lab Mode A genesis replay user. Not an L1 birth certificate, Treasury burn, Settlement escrow, or 30-day qualification.',
    genesis,
    archiveAgree,
    nft42Alive,
    hashHit,
    ondemandUntouched,
    start: started.stdout.trim() || started.stderr.trim(),
    lastLists,
  }
  await mkdir(DEFAULT_EVIDENCE_DIR, { recursive: true })
  await writeFile(
    join(DEFAULT_EVIDENCE_DIR, 'newchain-user-deploy.json'),
    `${JSON.stringify(evidence, null, 2)}\n`,
    'utf8',
  )
  return {
    ok:
      started.code === 0 &&
      genesis.asset &&
      genesis.storage &&
      genesis.trade &&
      archiveAgree &&
      nft42Alive &&
      hashHit &&
      ondemandUntouched,
    clientHost: NEWCHAIN_USER_HOST,
    genesis,
    archiveAgree,
    nft42Alive,
    ondemandUntouched,
    results: { start: started.stdout.trim(), lastLists, hashHit },
  }
}

function isRecordish(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export async function injectIsolatedProcessCrash(domainId: string): Promise<{ ok: boolean; detail: string }> {
  const hosts = await loadLabHosts()
  const host = hosts.hosts.find((item) => item.domainId === domainId)
  if (!host) throw new Error(`unknown domain ${domainId}`)
  if (isRetiredLabHost(host)) throw new Error(`refusing crash inject on retired ${domainId}`)
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

type SyncJoinRow = {
  domainId: string
  phase: string | null
  seatingQualified: boolean
  leafCount: number | null
  rejectReason: string | null
  inventoryFrozen: boolean | null
  hostedChainSetRoot: string | null
  lastACRef: string | null
  membershipRoot: string | null
  hashIndexRoot: string | null
}

function rootField(status: Record<string, unknown>, key: string): string | null {
  return typeof status[key] === 'string' && status[key] ? String(status[key]) : null
}

function keepersFourRootsAligned(rows: SyncJoinRow[]): boolean {
  const qualified = rows.filter((row) => row.seatingQualified)
  if (qualified.length < 4) return false
  const fingerprint = (row: SyncJoinRow): string | null => {
    if (!row.hostedChainSetRoot || !row.lastACRef || !row.membershipRoot || !row.hashIndexRoot) {
      return null
    }
    return `${row.hostedChainSetRoot}|${row.lastACRef}|${row.membershipRoot}|${row.hashIndexRoot}`
  }
  const first = fingerprint(qualified[0]!)
  if (first === null) return false
  return qualified.every((row) => fingerprint(row) === first)
}

async function readSyncStatus(host: PilotLabHostV1): Promise<SyncJoinRow> {
  if (isRetiredLabHost(host)) {
    return {
      domainId: host.domainId,
      phase: 'RETIRED',
      seatingQualified: false,
      leafCount: null,
      rejectReason: 'retired-skip-no-start',
      inventoryFrozen: null,
      hostedChainSetRoot: null,
      lastACRef: null,
      membershipRoot: null,
      hashIndexRoot: null,
    }
  }
  const result = await runSshRetry(host.sshHost, HEALTH_SEATING_ONLY)
  const health = extractArchiveHealthJson(result.stdout)
  const status =
    health.syncQualification && typeof health.syncQualification === 'object'
      ? (health.syncQualification as Record<string, unknown>)
      : extractSyncStatusJson(result.stdout)
  return {
    domainId: host.domainId,
    phase: typeof status.phase === 'string' ? status.phase : null,
    seatingQualified: status.seatingQualified === true,
    leafCount: typeof status.leafCount === 'number' ? status.leafCount : null,
    rejectReason: typeof status.rejectReason === 'string' ? status.rejectReason : null,
    inventoryFrozen: typeof health.inventoryFrozen === 'boolean' ? health.inventoryFrozen : null,
    hostedChainSetRoot: rootField(status, 'hostedChainSetRoot'),
    lastACRef: rootField(status, 'lastACRef'),
    membershipRoot: rootField(status, 'membershipRoot'),
    hashIndexRoot: rootField(status, 'hashIndexRoot'),
  }
}

function keeperLeafSnapshot(rows: SyncJoinRow[]): number | null {
  const leaves = rows
    .filter((row) => row.seatingQualified && typeof row.leafCount === 'number')
    .map((row) => row.leafCount as number)
  if (leaves.length < 4) return null
  const first = leaves[0]!
  return leaves.every((leaf) => leaf === first) ? first : null
}

export async function waitOfficialKeepersQualified(options?: {
  timeoutMs?: number
  pollMs?: number
}): Promise<{ ok: boolean; rows: SyncJoinRow[]; waitedMs: number }> {
  const hosts = await loadLabHosts()
  const keepers = hosts.hosts.filter((host) =>
    (G1_SYNC_JOIN_KEEPER_DOMAIN_IDS as readonly string[]).includes(host.domainId),
  )
  if (keepers.length !== G1_SYNC_JOIN_KEEPER_DOMAIN_IDS.length) {
    throw new Error('G1 keeper roster is incomplete')
  }
  const timeoutMs = options?.timeoutMs ?? 15 * 60_000
  const pollMs = options?.pollMs ?? 10_000
  const started = Date.now()
  let rows: SyncJoinRow[] = []
  while (Date.now() - started <= timeoutMs) {
    rows = []
    for (const host of keepers) {
      rows.push(await readSyncStatus(host))
    }
    if (rows.filter((row) => row.seatingQualified).length >= 4 && keepersFourRootsAligned(rows)) {
      return { ok: true, rows, waitedMs: Date.now() - started }
    }
    await sleep(pollMs)
  }
  return { ok: false, rows, waitedMs: Date.now() - started }
}

export async function wipeG1ArchiveDataAndRestart(): Promise<{
  ok: boolean
  wiped: string[]
  keepers: SyncJoinRow[]
  results: Array<{ domainId: string; ok: boolean; detail: string }>
}> {
  const hosts = await loadLabHosts()
  const wipeDomainIds = resolveWipeJoinDomainIds()
  const keepers = await waitOfficialKeepersQualified()
  const wipeHosts = hosts.hosts.filter((host) => wipeDomainIds.includes(host.domainId))
  if (wipeHosts.length !== wipeDomainIds.length) {
    throw new Error('G1 wipe roster is incomplete; refusing wipe')
  }
  if (!keepers.ok) {
    return {
      ok: false,
      wiped: [],
      keepers: keepers.rows,
      results: [
        {
          domainId: 'keepers',
          ok: false,
          detail: 'need 4 QUALIFIED G1 keepers (fd-01..04) with the same four inventory roots before wiping joiners',
        },
      ],
    }
  }
  const results: Array<{ domainId: string; ok: boolean; detail: string }> = []
  for (const host of wipeHosts) {
    const stopped = await runSshRetry(host.sshHost, STOP_LAB_ONLY)
    if (stopped.code !== 0) {
      results.push({
        domainId: host.domainId,
        ok: false,
        detail: stopped.stderr || stopped.stdout || 'refused to stop protected process',
      })
      continue
    }
    const started = await runSshRetry(host.sshHost, START_ARCHIVE_WIPE)
    const healthOk = started.stdout.includes('LIVE_OK') || started.stdout.includes('"command":"archive"')
    results.push({
      domainId: host.domainId,
      ok: started.code === 0 && healthOk,
      detail: `${stopped.stdout.trim()}\n${started.stdout.trim() || started.stderr.trim()}`.trim(),
    })
  }
  const ok = results.every((row) => row.ok)
  await mkdir(DEFAULT_SYNC_JOIN_EVIDENCE_DIR, { recursive: true })
  await writeFile(
    join(DEFAULT_SYNC_JOIN_EVIDENCE_DIR, 'wipe.json'),
    `${JSON.stringify(
      {
        schema: 'DleLabSyncJoinWipeV1',
        labOnly: true,
        notThirtyDayQualification: true,
        wipedDomainIds: wipeDomainIds,
        wipeSelection: {
          mode: process.env.LAB_SYNC_JOIN_WIPE_DOMAIN_IDS?.trim() ? 'env' : 'random',
          requiredActive: G1_SYNC_JOIN_REQUIRED_ACTIVE_WIPE,
          wipeSafe: G1_SYNC_JOIN_WIPE_SAFE_DOMAIN_IDS,
          neverKeepers: G1_SYNC_JOIN_KEEPER_DOMAIN_IDS,
        },
        keeperLeafCount: keeperLeafSnapshot(keepers.rows),
        keeperDomainIds: G1_SYNC_JOIN_KEEPER_DOMAIN_IDS,
        dataDir: `${LAB_DIR}/data`,
        neverGethBeacon: true,
        keepers: keepers.rows,
        results: results.map((row) => ({ domainId: row.domainId, ok: row.ok })),
        at: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  )
  return {
    ok,
    wiped: results.filter((row) => row.ok).map((row) => row.domainId),
    keepers: keepers.rows,
    results,
  }
}

const G1_SMOKE_DOMAIN_IDS = [
  ...G1_SYNC_JOIN_KEEPER_DOMAIN_IDS,
  ...G1_SYNC_JOIN_WIPE_SAFE_DOMAIN_IDS,
] as const

async function fetchArchiveJsonTimed(url: string, timeoutMs: number): Promise<Record<string, unknown>> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`)
  const body: unknown = await response.json()
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error(`invalid JSON ${url}`)
  return body as Record<string, unknown>
}

export async function smokeLabCgOpening(): Promise<{
  ok: boolean
  hostedChainCount: number | null
  openedChainCount: number | null
  rows: Array<{
    domainId: string
    host: string
    ok: boolean
    hostedChainCount: number | null
    openedChainCount: number | null
    openedAllHostedChains: boolean | null
    policy: string | null
    sampleCount: number | null
    detail: string
  }>
}> {
  const hosts = await loadLabHosts()
  const g1 = hosts.hosts.filter((host) => (G1_SMOKE_DOMAIN_IDS as readonly string[]).includes(host.domainId))
  const rows: Array<{
    domainId: string
    host: string
    ok: boolean
    hostedChainCount: number | null
    openedChainCount: number | null
    openedAllHostedChains: boolean | null
    policy: string | null
    sampleCount: number | null
    detail: string
  }> = []
  for (const host of g1) {
    if (isRetiredLabHost(host)) {
      rows.push({
        domainId: host.domainId,
        host: host.sshHost,
        ok: true,
        hostedChainCount: null,
        openedChainCount: null,
        openedAllHostedChains: null,
        policy: null,
        sampleCount: null,
        detail: 'retired-skip-no-start',
      })
      continue
    }
    const url = `http://${host.sshHost}:${LAB_PORT}/sync/opening`
    try {
      const opening = await fetchArchiveJsonTimed(url, 30_000)
      const hosted = typeof opening.hostedChainCount === 'number' ? opening.hostedChainCount : null
      const opened = typeof opening.openedChainCount === 'number' ? opening.openedChainCount : null
      const openedAll = opening.openedAllHostedChains === true
      const policy = typeof opening.policy === 'string' ? opening.policy : null
      const sampleCount = typeof opening.sampleCount === 'number' ? opening.sampleCount : null
      const ok =
        opening.schema === 'DleLabCgOpeningV1' &&
        opening.notProductionCg === true &&
        policy === 'all-hosted' &&
        hosted !== null &&
        opened !== null &&
        hosted > 8 &&
        opened === hosted &&
        openedAll
      rows.push({
        domainId: host.domainId,
        host: host.sshHost,
        ok,
        hostedChainCount: hosted,
        openedChainCount: opened,
        openedAllHostedChains: openedAll,
        policy,
        sampleCount,
        detail: ok ? 'opened===hosted all-hosted' : `opening mismatch ${JSON.stringify(opening)}`,
      })
    } catch (error) {
      rows.push({
        domainId: host.domainId,
        host: host.sshHost,
        ok: false,
        hostedChainCount: null,
        openedChainCount: null,
        openedAllHostedChains: null,
        policy: null,
        sampleCount: null,
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }
  const hostedChainCount = rows.find((row) => row.hostedChainCount !== null)?.hostedChainCount ?? null
  const openedChainCount = rows.find((row) => row.openedChainCount !== null)?.openedChainCount ?? null
  const ok =
    rows.length === G1_SMOKE_DOMAIN_IDS.length &&
    rows.every((row) => row.ok) &&
    hostedChainCount !== null &&
    hostedChainCount > 8
  await mkdir(DEFAULT_SYNC_JOIN_EVIDENCE_DIR, { recursive: true })
  await writeFile(
    join(DEFAULT_SYNC_JOIN_EVIDENCE_DIR, 'p9-opening.json'),
    `${JSON.stringify(
      {
        schema: 'DleLabCgOpeningSmokeV1',
        labOnly: true,
        hmacForgeable: true,
        notProductionCg: true,
        notThirtyDayQualification: true,
        policy: 'all-hosted',
        hostedChainCount,
        openedChainCount,
        rows,
        ok,
        at: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  )
  return { ok, hostedChainCount, openedChainCount, rows }
}

const G1_ACTIVE_SMOKE_DOMAIN_IDS = [
  ...G1_SYNC_JOIN_KEEPER_DOMAIN_IDS,
  G1_SYNC_JOIN_REQUIRED_ACTIVE_WIPE,
] as const

export async function smokeLabRejectedSafety(): Promise<{
  ok: boolean
  rows: Array<{
    domainId: string
    host: string
    role: string | null
    phase: string | null
    seatingQualified: boolean | null
    ok: boolean
    detail: string
  }>
}> {
  const hosts = await loadLabHosts()
  const g1 = hosts.hosts.filter((host) => (G1_SMOKE_DOMAIN_IDS as readonly string[]).includes(host.domainId))
  const keeperSet = new Set<string>(G1_SYNC_JOIN_KEEPER_DOMAIN_IDS)
  const activeSet = new Set<string>(G1_ACTIVE_SMOKE_DOMAIN_IDS)
  const rows: Array<{
    domainId: string
    host: string
    role: string | null
    phase: string | null
    seatingQualified: boolean | null
    ok: boolean
    detail: string
  }> = []
  for (const host of g1) {
    if (isRetiredLabHost(host)) {
      rows.push({
        domainId: host.domainId,
        host: host.sshHost,
        role: null,
        phase: 'RETIRED',
        seatingQualified: false,
        ok: true,
        detail: 'retired-skip-no-start',
      })
      continue
    }
    const url = `http://${host.sshHost}:${LAB_PORT}/health`
    try {
      const health = await fetchArchiveJsonTimed(url, 30_000)
      const sync = isRecordish(health.syncQualification) ? health.syncQualification : null
      const role =
        typeof health.role === 'string' ? health.role : typeof sync?.role === 'string' ? sync.role : null
      const phase = typeof sync?.phase === 'string' ? sync.phase : null
      const seatingQualified = sync?.seatingQualified === true
      const isKeeper = keeperSet.has(host.domainId)
      const isActive = activeSet.has(host.domainId) || role === 'active'
      const rejected = phase === 'REJECTED'
      const keeperOk = !isKeeper || (phase === 'QUALIFIED' && seatingQualified)
      const activeOk = !isActive || !rejected
      const ok = keeperOk && activeOk
      rows.push({
        domainId: host.domainId,
        host: host.sshHost,
        role,
        phase,
        seatingQualified,
        ok,
        detail: ok
          ? `${role ?? 'unknown'} ${phase ?? 'no-phase'}`
          : isKeeper && !keeperOk
            ? `keeper not QUALIFIED (${phase ?? 'no-phase'})`
            : `active REJECTED`,
      })
    } catch (error) {
      rows.push({
        domainId: host.domainId,
        host: host.sshHost,
        role: null,
        phase: null,
        seatingQualified: null,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }
  const ok =
    rows.length === G1_SMOKE_DOMAIN_IDS.length &&
    rows.every((row) => row.ok) &&
    G1_SYNC_JOIN_KEEPER_DOMAIN_IDS.filter((id) => !isRetiredLabDomain(id)).every((id) =>
      rows.some((row) => row.domainId === id && row.phase === 'QUALIFIED' && row.seatingQualified === true),
    )
  await mkdir(DEFAULT_SYNC_JOIN_EVIDENCE_DIR, { recursive: true })
  await writeFile(
    join(DEFAULT_SYNC_JOIN_EVIDENCE_DIR, 'p10-rejected-safety.json'),
    `${JSON.stringify(
      {
        schema: 'DleLabRejectedSafetySmokeV1',
        labOnly: true,
        hmacForgeable: true,
        notProductionCg: true,
        notThirtyDayQualification: true,
        neverWipe: true,
        neverInjectMissingObject: true,
        keeperDomainIds: G1_SYNC_JOIN_KEEPER_DOMAIN_IDS,
        activeDomainIds: G1_ACTIVE_SMOKE_DOMAIN_IDS,
        rows,
        ok,
        at: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  )
  return { ok, rows }
}

export async function acceptSyncJoin(): Promise<{
  ok: boolean
  joiners: SyncJoinRow[]
  keepers: SyncJoinRow[]
  waitedMs: number
}> {
  const hosts = await loadLabHosts()
  const wipePath = join(DEFAULT_SYNC_JOIN_EVIDENCE_DIR, 'wipe.json')
  const wipeRecord = JSON.parse(await readFile(wipePath, 'utf8')) as {
    wipedDomainIds?: string[]
    keeperLeafCount?: number | null
  }
  const wipeDomainIds = Array.isArray(wipeRecord.wipedDomainIds)
    ? wipeRecord.wipedDomainIds
    : resolveWipeJoinDomainIds()
  const wipeLeaf =
    typeof wipeRecord.keeperLeafCount === 'number' ? wipeRecord.keeperLeafCount : null
  const joinerHosts = hosts.hosts.filter((host) => wipeDomainIds.includes(host.domainId))
  const keeperHosts = hosts.hosts.filter((host) =>
    (G1_SYNC_JOIN_KEEPER_DOMAIN_IDS as readonly string[]).includes(host.domainId),
  )
  const timeoutMs = 25 * 60_000
  const pollMs = 15_000
  const started = Date.now()
  let joiners: SyncJoinRow[] = []
  let keepers: SyncJoinRow[] = []
  let maxKeeperLeaf = wipeLeaf
  const keeperLeafSamples: number[] = []
  while (Date.now() - started <= timeoutMs) {
    joiners = []
    for (const host of joinerHosts) {
      joiners.push(await readSyncStatus(host))
    }
    keepers = []
    for (const host of keeperHosts) {
      keepers.push(await readSyncStatus(host))
    }
    for (const row of keepers) {
      if (typeof row.leafCount === 'number') {
        keeperLeafSamples.push(row.leafCount)
        if (maxKeeperLeaf === null || row.leafCount > maxKeeperLeaf) maxKeeperLeaf = row.leafCount
      }
    }
    if (joiners.length === wipeDomainIds.length && joiners.every((row) => row.seatingQualified)) {
      break
    }
    if (joiners.some((row) => row.phase === 'REJECTED')) {
      break
    }
    await sleep(pollMs)
  }
  const leafGrew = wipeLeaf !== null && maxKeeperLeaf !== null && maxKeeperLeaf > wipeLeaf
  const stale = [...joiners, ...keepers].some(
    (row) => typeof row.rejectReason === 'string' && row.rejectReason.includes('ERR_SYNC_CHALLENGE_STALE'),
  )
  const ok =
    joiners.length === wipeDomainIds.length &&
    joiners.every((row) => row.seatingQualified) &&
    keepers.filter((row) => row.seatingQualified).length >= 4 &&
    !leafGrew &&
    !stale
  await mkdir(DEFAULT_SYNC_JOIN_EVIDENCE_DIR, { recursive: true })
  await writeFile(
    join(DEFAULT_SYNC_JOIN_EVIDENCE_DIR, 'accept.json'),
    `${JSON.stringify(
      {
        schema: 'DleLabSyncJoinAcceptV1',
        labOnly: true,
        hmacForgeable: true,
        notClRandao: true,
        notThirtyDayQualification: true,
        lastQuorumOkIsNotSeating: true,
        p8dZeroLeafGrowth: !leafGrew,
        quorum: 4,
        wipedDomainIds: wipeDomainIds,
        keeperDomainIds: G1_SYNC_JOIN_KEEPER_DOMAIN_IDS,
        wipeLeafCount: wipeLeaf,
        maxKeeperLeafDuringJoin: maxKeeperLeaf,
        leafGrew,
        stale,
        joiners,
        keepers,
        waitedMs: Date.now() - started,
        ok,
        at: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  )
  return { ok, joiners, keepers, waitedMs: Date.now() - started }
}

function probeField(stdout: string, key: string): string {
  const match = stdout.match(new RegExp(`^${key}=(.*)$`, 'm'))
  return match?.[1]?.trim() ?? ''
}

export async function probeP11Joiner(): Promise<{
  ok: boolean
  joiner: PilotLabHostV1
  hostname: string
  leftoverElCl: boolean
  detail: string
}> {
  const inventory = await loadOfficialLabInventory()
  const hosts = await loadLabHosts()
  const joiner = await loadP11JoinerHost()
  assertP11JoinerOutsideOfficial(inventory, hosts, joiner)
  const result = await runSshRetry(joiner.sshHost, PROBE_P11_JOINER)
  const geth = probeField(result.stdout, 'GETH')
  const beacon = probeField(result.stdout, 'BEACON')
  const validator = probeField(result.stdout, 'VALIDATOR')
  const leftoverElCl = Boolean(geth || beacon || validator)
  const ok = result.code === 0 && leftoverElCl === false
  await mkdir(DEFAULT_SYNC_JOIN_EVIDENCE_DIR, { recursive: true })
  await writeFile(
    join(DEFAULT_SYNC_JOIN_EVIDENCE_DIR, 'p11-probe.json'),
    `${JSON.stringify(
      {
        schema: 'DleLabP11JoinerProbeV1',
        labOnly: true,
        notOfficialFivePlusTwo: true,
        neverWipeOfficialSeven: true,
        domainId: joiner.domainId,
        sshHost: joiner.sshHost,
        role: P11_JOINER_ROLE,
        leftoverElCl,
        hostname: probeField(result.stdout, 'HOST'),
        ok,
        stdout: result.stdout.trim(),
        at: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  )
  return {
    ok,
    joiner,
    hostname: probeField(result.stdout, 'HOST'),
    leftoverElCl,
    detail: result.stdout.trim() || result.stderr.trim(),
  }
}

export async function deployP11FullOpenJoiner(options?: {
  extras?: AgentConfigExtras
  archiveDistDir?: string
  daemonProbePath?: string
  keepData?: boolean
}): Promise<{
  ok: boolean
  joiner: PilotLabHostV1
  reachableFromKeeper: boolean
  results: Array<{ domainId: string; host: string; ok: boolean; detail: string }>
}> {
  const inventory = await loadOfficialLabInventory()
  const hosts = await loadLabHosts()
  const joiner = await loadP11JoinerHost()
  assertP11JoinerOutsideOfficial(inventory, hosts, joiner)
  const archiveDistDir = options?.archiveDistDir ?? DEFAULT_ARCHIVE_DIST_DIR
  const daemonProbePath = options?.daemonProbePath ?? DEFAULT_DAEMON_PROBE_PATH
  const bundlePath = '/tmp/dle-archive-runtime.tgz'
  await runLocal('tar', ['-czf', bundlePath, '--exclude', '._*', '-C', archiveDistDir, '.'], {
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  })
  const results: Array<{ domainId: string; host: string; ok: boolean; detail: string }> = []
  const ensure = await runSshRetry(joiner.sshHost, ENSURE_NODE)
  if (ensure.code !== 0) {
    results.push({
      domainId: joiner.domainId,
      host: joiner.sshHost,
      ok: false,
      detail: ensure.stderr || ensure.stdout || `ssh exit ${ensure.code}`,
    })
  } else {
    const config = agentConfigForJoiner(inventory, hosts, joiner, options?.extras)
    const tmpConfig = `/tmp/dle-lab-${joiner.domainId}.json`
    await writeFile(tmpConfig, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    try {
      await runSshRetry(
        joiner.sshHost,
        `mkdir -p '${LAB_DIR}/app' '${LAB_DIR}/data' '${LAB_DIR}/daemon' '${LAB_DIR}/wal'`,
      )
      await runScpRetry(bundlePath, joiner.sshHost, '/tmp/dle-archive-runtime.tgz')
      await runScpRetry(tmpConfig, joiner.sshHost, `${LAB_DIR}/config.json`)
      await runScpRetry(daemonProbePath, joiner.sshHost, REMOTE_DAEMON_PROBE)
      const unpacked = await runSshRetry(
        joiner.sshHost,
        `rm -rf '${LAB_DIR}/app' && mkdir -p '${LAB_DIR}/app' && tar -xzf /tmp/dle-archive-runtime.tgz -C '${LAB_DIR}/app'`,
      )
      if (unpacked.code !== 0) {
        results.push({
          domainId: joiner.domainId,
          host: joiner.sshHost,
          ok: false,
          detail: unpacked.stderr || unpacked.stdout,
        })
      } else {
        const stopped = await runSshRetry(joiner.sshHost, STOP_LAB_ONLY)
        if (stopped.code !== 0) {
          results.push({
            domainId: joiner.domainId,
            host: joiner.sshHost,
            ok: false,
            detail: stopped.stderr || stopped.stdout || 'refused to stop protected process',
          })
        } else {
          const started = await runSshRetry(
            joiner.sshHost,
            options?.keepData === true ? START_ARCHIVE_KEEP_ALL : START_ARCHIVE,
          )
          const healthOk = started.stdout.includes('LIVE_OK') || started.stdout.includes('"command":"archive"')
          results.push({
            domainId: joiner.domainId,
            host: joiner.sshHost,
            ok: started.code === 0 && healthOk,
            detail: `${stopped.stdout.trim()}\n${started.stdout.trim() || started.stderr.trim()}`.trim(),
          })
        }
      }
    } catch (error) {
      results.push({
        domainId: joiner.domainId,
        host: joiner.sshHost,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }
  const keeper = liveLabHosts(hosts).find((host) =>
    (G1_SYNC_JOIN_KEEPER_DOMAIN_IDS as readonly string[]).includes(host.domainId),
  )
  let reachableFromKeeper = false
  if (keeper && results.every((row) => row.ok)) {
    const reach = await runSshRetry(
      keeper.sshHost,
      `curl -fsS --max-time 8 http://${joiner.sshHost}:${LAB_PORT}/liveness 2>/dev/null || echo REACH=down`,
    )
    reachableFromKeeper = reach.code === 0 && reach.stdout.includes('"ok":true')
  }
  const ok = results.every((row) => row.ok) && reachableFromKeeper
  await mkdir(DEFAULT_SYNC_JOIN_EVIDENCE_DIR, { recursive: true })
  await writeFile(
    join(DEFAULT_SYNC_JOIN_EVIDENCE_DIR, 'p11-deploy.json'),
    `${JSON.stringify(
      {
        schema: 'DleLabP11JoinerDeployV1',
        labOnly: true,
        notOfficialFivePlusTwo: true,
        neverWipeOfficialSeven: true,
        keepData: options?.keepData === true,
        wipedOnly: options?.keepData === true ? [] : [joiner.domainId],
        dataDir: `${LAB_DIR}/data`,
        neverGethBeacon: true,
        reachableFromKeeper,
        joiner,
        results: results.map((row) => ({ domainId: row.domainId, ok: row.ok })),
        ok,
        at: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  )
  return { ok, joiner, reachableFromKeeper, results }
}

export async function acceptP11FullOpenJoin(): Promise<{
  ok: boolean
  joiner: SyncJoinRow | null
  keepers: SyncJoinRow[]
  official: SyncJoinRow[]
  opening: {
    ok: boolean
    hostedChainCount: number | null
    openedChainCount: number | null
    policy: string | null
    sampleCount: number | null
    detail: string
  }
  waitedMs: number
}> {
  const inventory = await loadOfficialLabInventory()
  const hosts = await loadLabHosts()
  const joinerHost = await loadP11JoinerHost()
  assertP11JoinerOutsideOfficial(inventory, hosts, joinerHost)
  const keeperHosts = hosts.hosts.filter((host) =>
    (G1_SYNC_JOIN_KEEPER_DOMAIN_IDS as readonly string[]).includes(host.domainId),
  )
  const fd05 = hosts.hosts.find((host) => host.domainId === G1_SYNC_JOIN_REQUIRED_ACTIVE_WIPE)
  if (!fd05) throw new Error('official fd-05 missing; refusing P11 accept')
  const timeoutMs = 60 * 60_000
  const pollMs = 20_000
  const started = Date.now()
  let joiner: SyncJoinRow | null = null
  let keepers: SyncJoinRow[] = []
  let official: SyncJoinRow[] = []
  while (Date.now() - started <= timeoutMs) {
    joiner = await readSyncStatus(joinerHost)
    keepers = []
    for (const host of keeperHosts) {
      keepers.push(await readSyncStatus(host))
    }
    official = []
    for (const host of hosts.hosts) {
      official.push(await readSyncStatus(host))
    }
    if (joiner.phase === 'REJECTED') break
    const fd05Row = official.find((row) => row.domainId === G1_SYNC_JOIN_REQUIRED_ACTIVE_WIPE)
    if (
      joiner.seatingQualified &&
      keepers.filter((row) => row.seatingQualified).length >= 4 &&
      fd05Row?.seatingQualified === true
    ) {
      break
    }
    await sleep(pollMs)
  }
  const fd05Row = official.find((row) => row.domainId === G1_SYNC_JOIN_REQUIRED_ACTIVE_WIPE)
  let opening: {
    ok: boolean
    hostedChainCount: number | null
    openedChainCount: number | null
    policy: string | null
    sampleCount: number | null
    detail: string
  } = {
    ok: false,
    hostedChainCount: null,
    openedChainCount: null,
    policy: null,
    sampleCount: null,
    detail: 'not fetched',
  }
  if (joiner?.seatingQualified === true) {
    try {
      const body = await fetchArchiveJsonTimed(`http://${joinerHost.sshHost}:${LAB_PORT}/sync/opening`, 180_000)
      const hosted = typeof body.hostedChainCount === 'number' ? body.hostedChainCount : null
      const opened = typeof body.openedChainCount === 'number' ? body.openedChainCount : null
      const policy = typeof body.policy === 'string' ? body.policy : null
      const sampleCount = typeof body.sampleCount === 'number' ? body.sampleCount : null
      const ok =
        body.schema === 'DleLabCgOpeningV1' &&
        body.notProductionCg === true &&
        policy === 'all-hosted' &&
        hosted !== null &&
        opened !== null &&
        hosted > 8 &&
        opened === hosted &&
        body.openedAllHostedChains === true
      opening = {
        ok,
        hostedChainCount: hosted,
        openedChainCount: opened,
        policy,
        sampleCount,
        detail: ok ? 'opened===hosted all-hosted' : `opening mismatch ${JSON.stringify(body)}`,
      }
    } catch (error) {
      opening = {
        ok: false,
        hostedChainCount: null,
        openedChainCount: null,
        policy: null,
        sampleCount: null,
        detail: error instanceof Error ? error.message : String(error),
      }
    }
  }
  const ok =
    joiner?.seatingQualified === true &&
    keepers.filter((row) => row.seatingQualified).length >= 4 &&
    fd05Row?.seatingQualified === true &&
    official.length === 7 &&
    official.every((row) => row.phase !== 'REJECTED' || row.domainId !== G1_SYNC_JOIN_REQUIRED_ACTIVE_WIPE) &&
    opening.ok
  await mkdir(DEFAULT_SYNC_JOIN_EVIDENCE_DIR, { recursive: true })
  await writeFile(
    join(DEFAULT_SYNC_JOIN_EVIDENCE_DIR, 'p11-opening.json'),
    `${JSON.stringify(
      {
        schema: 'DleLabP11JoinerOpeningV1',
        labOnly: true,
        hmacForgeable: true,
        notProductionCg: true,
        notOfficialFivePlusTwo: true,
        domainId: joinerHost.domainId,
        ...opening,
        at: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(
    join(DEFAULT_SYNC_JOIN_EVIDENCE_DIR, 'p11-accept.json'),
    `${JSON.stringify(
      {
        schema: 'DleLabP11FullOpenJoinAcceptV1',
        labOnly: true,
        hmacForgeable: true,
        notClRandao: true,
        notThirtyDayQualification: true,
        notOfficialFivePlusTwo: true,
        neverWipeOfficialSeven: true,
        neverWipeFd05: true,
        lastQuorumOkIsNotSeating: true,
        quorum: 4,
        joinerDomainId: joinerHost.domainId,
        joinerRole: P11_JOINER_ROLE,
        keeperDomainIds: G1_SYNC_JOIN_KEEPER_DOMAIN_IDS,
        joiner,
        keepers,
        official,
        opening,
        waitedMs: Date.now() - started,
        ok,
        at: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  )
  return { ok, joiner, keepers, official, opening, waitedMs: Date.now() - started }
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
