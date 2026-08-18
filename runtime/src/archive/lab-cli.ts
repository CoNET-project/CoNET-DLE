#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { hashIndexCommittedInAc, hashIndexRootView } from '../shared/hashIndexTree.js'
import { DLE_LAB_CHAIN_NFT_ID } from '../shared/hashLookup.js'
import { labRouteTableFromPeers, liveGroupCount, liveGroupIds, planeWallets } from '../shared/labRoute.js'
import { seedLabFissionMarker } from './hashPipe.js'
import {
  inventoryCatalogFrozen,
  inventoryCatalogFreezeReason,
  loadOperatorInventoryFreeze,
  operatorInventoryFrozen,
  parseOperatorInventoryFreezePost,
  persistOperatorInventoryFreeze,
  resolveInventoryFreezeState,
  setInventoryCatalogFrozen,
  setOperatorInventoryFreeze,
} from './inventoryFreeze.js'
import {
  OPERATOR_PILOT_CLOCK_SCHEMA,
  commitOperatorPilotClock,
  loadOperatorPilotClock,
  operatorPilotClockFromPost,
  operatorPilotClockHealth,
  parseOperatorPilotClockPost,
} from './pilotClock.js'
import { createArchiveBftEngine } from './bft/engine.js'
import { listenArchiveHttp } from './http.js'
import { createNewChainEngine } from './newchain/engine.js'
import { fetchLabObject } from './hop1.js'
import { createOnDemandEngine } from './ondemand/engine.js'
import { openArchiveStore } from './store.js'
import { createSyncQualificationEngine } from './syncQualification/index.js'
import { LAB_HOLD_BFT_AFTER_BOOT_MS, SYNC_ACTIVE_COUNT } from './syncQualification/types.js'

const HEARTBEAT_MS = 6_000
const REQUEST_TIMEOUT_MS = 2_500
const LAB_AGENT_COMPAT = 'dle-30d-lab'

interface LabPeer {
  domainId: string
  host: string
  port: number
  role: string
}

interface LabPlaneWallet {
  domainId: string
  role: string
  url?: string
}

interface LabConfig {
  domainId: string
  role: string
  port: number
  peers?: LabPeer[]
  ownGroupId?: string
  enableBft?: boolean
  enableOndemand?: boolean
  seedFissionMarker?: boolean
  autoSeedLabMiners?: boolean
  autoFreeze?: boolean
  planeDirectory?: Array<{ groupId: string; wallets: LabPlaneWallet[] }>
  foreignChains?: Array<{ chainNftId: string; groupId: string }>
}

function parseArgs(argv: string[]): { configPath: string; dataDir: string } {
  let configPath = ''
  let dataDir = ''
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === '--config' && next !== undefined) {
      configPath = resolve(next)
      i += 1
      continue
    }
    if (arg === '--data-dir' && next !== undefined) {
      dataDir = resolve(next)
      i += 1
    }
  }
  if (configPath === '') throw new Error('usage: lab-cli.js --config FILE [--data-dir DIR]')
  return { configPath, dataDir }
}

function isPeerHealthy(body: unknown, domainId: string): boolean {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return false
  const row = body as Record<string, unknown>
  if (row.ok !== true || row.domainId !== domainId) return false
  return row.command === 'archive' || row.agent === LAB_AGENT_COMPAT
}

async function probePeer(peer: LabPeer): Promise<{ domainId: string; ok: boolean }> {
  try {
    const response = await fetch(`http://${peer.host}:${peer.port}/liveness`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) return { domainId: peer.domainId, ok: false }
    return { domainId: peer.domainId, ok: isPeerHealthy(await response.json(), peer.domainId) }
  } catch {
    return { domainId: peer.domainId, ok: false }
  }
}

const options = parseArgs(process.argv.slice(2))
const config = JSON.parse(readFileSync(options.configPath, 'utf8')) as LabConfig
if (typeof config.domainId !== 'string' || typeof config.role !== 'string') {
  throw new Error('config must include domainId and role')
}
const port = Number(config.port)
if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('invalid config.port')
const labDir = dirname(fileURLToPath(import.meta.url))
const dataDir = options.dataDir !== '' ? options.dataDir : resolve(labDir, '../../data')
const statePath = resolve(dataDir, 'state.json')
const store = openArchiveStore(dataDir)
const startedAt = Date.now()
const state = {
  schema: 'DleArchiveLabStateV1',
  command: 'archive',
  runtime: 'nodejs',
  agent: LAB_AGENT_COMPAT,
  domainId: config.domainId,
  role: config.role,
  port,
  startedAt: new Date().toISOString(),
  heartbeats: 0,
  lastQuorumOk: false,
  lastPeerOk: 0,
  lastError: null as string | null,
}

function persistState(): void {
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

persistState()
store.appendWal({ type: 'lab-start', domainId: state.domainId, role: state.role })

const enableBft = config.enableBft !== false
const enableOndemand = config.enableOndemand !== false
const peers = Array.isArray(config.peers) ? config.peers : []
const routeTable = labRouteTableFromPeers(
  { domainId: config.domainId, role: config.role },
  peers,
  {
    ...(typeof config.ownGroupId === 'string' ? { ownGroupId: config.ownGroupId } : {}),
    ...(Array.isArray(config.planeDirectory)
      ? {
          planeDirectory: config.planeDirectory
            .filter((row) => typeof row?.groupId === 'string')
            .map((row) => ({
              groupId: row.groupId,
              wallets: (Array.isArray(row.wallets) ? row.wallets : []).map((wallet) => ({
                domainId: wallet.domainId,
                role: wallet.role,
                labOnly: true as const,
                ...(typeof wallet.url === 'string' && wallet.url !== '' ? { url: wallet.url } : {}),
              })),
            })),
        }
      : {}),
    ...(Array.isArray(config.foreignChains) ? { foreignChains: config.foreignChains } : {}),
  },
)
if (config.seedFissionMarker === true) {
  const seeded = seedLabFissionMarker(store.hash, routeTable)
  if (!seeded.ok) throw new Error(`seedFissionMarker failed: ${seeded.error}`)
}
const engine = createArchiveBftEngine({
  domainId: config.domainId,
  role: config.role,
  peers,
  store,
})
const ondemand = createOnDemandEngine({
  domainId: config.domainId,
  role: config.role,
  peers,
  store,
  autoSeedLabMiners: enableOndemand && config.autoSeedLabMiners !== false,
  autoFreeze: enableOndemand && config.autoFreeze !== false,
})
const syncHolder: { current: ReturnType<typeof createSyncQualificationEngine> | null } = {
  current: null,
}
const newchain = createNewChainEngine({
  domainId: config.domainId,
  store,
  routeTable,
  role: config.role,
  peers,
  enableBft,
  officialStandbysReady: () => syncHolder.current?.officialStandbysReady() === true,
})
let bftStarted = false
let ondemandStarted = false
let extraHealthCache: { at: number; value: Record<string, unknown> } | null = null
function seatingComplete(): boolean {
  if (!sync.seatingQualified()) return false
  if (sync.alignedQualifiedCount() < SYNC_ACTIVE_COUNT) return false
  if (sync.hasUnseatedActive()) return false
  if (Date.now() - startedAt < LAB_HOLD_BFT_AFTER_BOOT_MS) return false
  return true
}
function applyInventoryFreeze(): void {
  const autoFrozen = sync.inventoryShouldFreeze()
  const autoReason = !autoFrozen ? undefined : sync.hasUnseatedActive() ? 'unseated-active' : 'challenge-open'
  const next = resolveInventoryFreezeState(autoFrozen, autoReason)
  setInventoryCatalogFrozen(next.frozen, next.reason)
  extraHealthCache = null
  if (!next.frozen) return
  if (bftStarted) {
    engine.stop()
    newchain.stop()
    bftStarted = false
  }
  if (ondemandStarted) {
    ondemand.stop()
    ondemandStarted = false
  }
}
function maybeStartBft(): void {
  applyInventoryFreeze()
  if (!enableBft || bftStarted || !seatingComplete() || inventoryCatalogFrozen()) return
  bftStarted = true
  void engine.start()
  void newchain.start()
}
function maybeStartOndemand(): void {
  applyInventoryFreeze()
  if (!enableOndemand || ondemandStarted || !seatingComplete() || inventoryCatalogFrozen()) return
  ondemandStarted = true
  void ondemand.start()
}
const sync = createSyncQualificationEngine({
  domainId: config.domainId,
  role: config.role,
  peers: peers.map((peer) => ({
    domainId: peer.domainId,
    role: peer.role,
    url: `http://${peer.host}:${peer.port}`,
  })),
  store,
  table: routeTable,
  onQualified() {
    maybeStartBft()
    maybeStartOndemand()
  },
})
syncHolder.current = sync

let hashIndexHealthCache: { leafCount: number; view: ReturnType<typeof hashIndexRootView> } | null = null
function healthHashIndex(): ReturnType<typeof hashIndexRootView> {
  const leafCount = store.hash.locatorCount()
  if (hashIndexHealthCache !== null && hashIndexHealthCache.leafCount === leafCount) {
    return hashIndexHealthCache.view
  }
  const view = hashIndexRootView(store.hash.listLocators(), routeTable.ownGroupId)
  hashIndexHealthCache = { leafCount, view }
  return view
}

function extraHealthNow(): Record<string, unknown> {
  applyInventoryFreeze()
  const bft = engine.status()
  return {
    agent: LAB_AGENT_COMPAT,
    isolatedFromElCl: true,
    producesBlocks: false,
    uptimeMs: Date.now() - startedAt,
    heartbeats: state.heartbeats,
    lastQuorumOk: state.lastQuorumOk,
    lastPeerOk: state.lastPeerOk,
    bftNetworked: bft.networked,
    bftDiskNetworked: bft.networked,
    bftProcessStarted: bftStarted,
    bftModeA: bft.modeAAccepted,
    bftCertificateAvailable: bft.certificateAvailable,
    bftEip712: bft.bftEip712,
    bftHmacForgeable: bft.hmacForgeable,
    bftPrevoteCount: bft.prevoteCount,
    bftPrecommitCount: bft.precommitCount,
    bftVoted: bft.voted,
    ...ondemand.health(),
    ...newchain.health(),
    hop1: {
      labOnly: true,
      notProductionDepin: true,
      l1RouteUnproven: true,
      transport: 'lab-http-27101',
      ownGroupId: routeTable.ownGroupId,
      providerCount: planeWallets(routeTable, routeTable.ownGroupId).length,
      nft42ProviderCount: routeTable.groups[DLE_LAB_CHAIN_NFT_ID]?.wallets.length ?? 0,
    },
    enableBft,
    enableOndemand,
    liveGroupCount: liveGroupCount(routeTable),
    liveGroupIds: liveGroupIds(routeTable),
    hashIndex: healthHashIndex(),
    hashIndexCommittedInAc: hashIndexCommittedInAc(engine.certificate()),
    ...sync.health(),
    inventoryFrozen: inventoryCatalogFrozen(),
    inventoryFreezeReason: inventoryCatalogFreezeReason(),
    inventoryOperatorFrozen: operatorInventoryFrozen(),
    ...operatorPilotClockHealth(),
  }
}

function extraHealthCached(): Record<string, unknown> {
  const now = Date.now()
  if (extraHealthCache !== null && now - extraHealthCache.at < 2_000) return extraHealthCache.value
  const value = extraHealthNow()
  extraHealthCache = { at: now, value }
  return value
}

const server = await listenArchiveHttp({
  port,
  store,
  identity: { domainId: config.domainId, role: config.role },
  routeTable,
  facadeViews() {
    const bft = engine.facadeViews()
    const waiting = ondemand.facadeViews()
    return {
      tip: bft.tip,
      certificate: bft.certificate,
      waitingPool: waiting.waitingPool,
      selectionLog: waiting.selectionLog,
      syncing:
        sync.phase() === 'SYNCING'
          ? {
              startingBlock: '0x0',
              currentBlock: '0x0',
              highestBlock: '0x0',
              dleNote: 'not seating' as const,
            }
          : false,
    }
  },
  extraHealth: extraHealthCached,
  extraGet(pathname) {
    if (pathname === '/state') return { ...state, uptimeMs: Date.now() - startedAt }
    if (pathname === '/bft/status') return { ...engine.status() }
    if (pathname === '/sync/status') return { ...sync.status() }
    if (pathname === '/sync/inventory') return { ...sync.inventory() }
    if (pathname === '/sync/opening') return { ...sync.opening() }
    if (pathname === '/sync/roster') {
      return {
        schema: 'DleLabSyncRosterV1',
        lastQuorumOkIsNotSeating: true,
        rows: sync.roster(),
      }
    }
    return newchain.get(pathname) ?? ondemand.get(pathname)
  },
  onPost(pathname, body) {
    if (pathname === '/bft/message') {
      const result = engine.ingest(body)
      return { status: result.ok ? 200 : 400, body: result }
    }
    if (pathname === '/sync/challenge') {
      const result = sync.handleChallenge(body)
      return { status: result.ok ? 200 : 400, body: result }
    }
    if (pathname === '/sync/vote') {
      const result = sync.handleVote(body)
      return { status: result.ok ? 200 : 400, body: result }
    }
    if (pathname === '/sync/reject') {
      const result = sync.handleReject(body)
      return { status: result.ok ? 200 : 400, body: result }
    }
    if (pathname === '/sync/standby-ready') {
      const result = sync.handleStandbyReady(body)
      return { status: result.ok ? 200 : 400, body: result }
    }
    if (pathname === '/sync/inventory-freeze') {
      const parsed = parseOperatorInventoryFreezePost(body)
      if (!parsed.ok) return { status: 400, body: { ok: false, error: parsed.error } }
      setOperatorInventoryFreeze(true)
      persistOperatorInventoryFreeze(dataDir, true)
      applyInventoryFreeze()
      return {
        status: 200,
        body: {
          ok: true,
          schema: 'DleLabOperatorInventoryFreezeV1',
          inventoryFrozen: true,
          inventoryFreezeReason: 'operator',
          inventoryOperatorFrozen: true,
          labOnly: true,
          notThirtyDayQualification: true,
        },
      }
    }
    if (pathname === '/sync/pilot-clock') {
      const parsed = parseOperatorPilotClockPost(body)
      if (!parsed.ok) return { status: 400, body: { ok: false, error: parsed.error } }
      const committed = commitOperatorPilotClock(dataDir, operatorPilotClockFromPost(parsed.value))
      if (!committed.ok) return { status: 409, body: { ok: false, error: committed.error } }
      return {
        status: 200,
        body: {
          ok: true,
          schema: OPERATOR_PILOT_CLOCK_SCHEMA,
          ...operatorPilotClockHealth(),
        },
      }
    }
    return newchain.post(pathname, body) ?? ondemand.post(pathname, body)
  },
  hopFetch: async (url, chainNftId, height) => {
    if (sync.hopForbidden()) {
      sync.markHopDuringChallenge()
      return null
    }
    return fetchLabObject(url, chainNftId, height)
  },
})

await sync.start()
loadOperatorInventoryFreeze(dataDir)
loadOperatorPilotClock(dataDir)
applyInventoryFreeze()
if (!enableBft && !inventoryCatalogFrozen()) await newchain.start()

function scheduleHeartbeat(): void {
  setTimeout(() => {
    void (async () => {
      try {
        const peers = Array.isArray(config.peers) ? config.peers : []
        const results = await Promise.all(peers.map((peer) => probePeer(peer)))
        const activePeers = peers.filter((peer) => peer.role === 'active')
        const activeOk = results.filter(
          (row) => row.ok && activePeers.some((peer) => peer.domainId === row.domainId),
        ).length
        const selfActive = state.role === 'active' ? 1 : 0
        state.heartbeats += 1
        state.lastQuorumOk = activeOk + selfActive >= 4
        state.lastPeerOk = results.filter((row) => row.ok).length
        state.lastError = null
        maybeStartBft()
        maybeStartOndemand()
        persistState()
        store.appendWal({
          type: 'heartbeat',
          domainId: state.domainId,
          quorumOk: state.lastQuorumOk,
          peerOk: state.lastPeerOk,
        })
      } catch (error) {
        state.lastError = error instanceof Error ? error.message : String(error)
        persistState()
      } finally {
        scheduleHeartbeat()
      }
    })()
  }, HEARTBEAT_MS)
}

scheduleHeartbeat()
process.stdout.write(
  `${JSON.stringify({ ok: true, ...server.info, dataDir, listening: `0.0.0.0:${server.port}` }, null, 2)}\n`,
)

const shutdown = (): void => {
  sync.stop()
  engine.stop()
  ondemand.stop()
  newchain.stop()
  void server.close().then(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
