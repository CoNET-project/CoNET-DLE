import { DEFAULT_ARCHIVE_URL } from '../protocol'
import type { LabArchiveRow, TrustedExplorerSnapshot } from '../types'
import { DEMO_EVENT_FIXTURES } from '../fixtures/demoEvents'
import { LAB_ARCHIVE_FIXTURES } from '../fixtures/labArchives'
import { LAB_SELECTION_FIXTURE, LAB_WAITING_POOL_FIXTURE } from '../fixtures/labOnDemand'
import {
  EMPTY_CERTIFICATE,
  EMPTY_INFO,
  EMPTY_LIVE_GROUP_IDS,
  EMPTY_TIP,
  GENESIS_CLUSTER_COUNT,
  emptyRpcRows,
  parseClusterCount,
  parseLiveGroupIds,
  parseSelectionLog,
  parseWaitingPool,
} from './archiveClient'
import { sortEventsNewestFirst } from './events'
import { parseArchiveSyncPhase } from './archiveSeating'
import { isRecord } from './jsonrpc'

const SNAPSHOT_KEY = 'dle-explorer:trusted-snapshot:v1'
const URL_KEY = 'dle-explorer:archive-url:v1'

function isParticipantWallet(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
}

function hydrateArchiveWallets(rows: unknown): LabArchiveRow[] {
  const cachedById = new Map<string, Record<string, unknown>>()
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (!isRecord(row) || typeof row.domainId !== 'string') continue
      cachedById.set(row.domainId, row)
    }
  }
  // Always start from the full fixture roster (G1+G2+extras) so a stale localStorage
  // snapshot that only had the old 7 G1 rows cannot hide later groups.
  return LAB_ARCHIVE_FIXTURES.map((fixture) => {
    const cached = cachedById.get(fixture.domainId)
    if (!cached) return { ...fixture }
    const cachedWallet = isParticipantWallet(cached.participantWallet) ? cached.participantWallet : ''
    return {
      ...fixture,
      ...cached,
      domainId: fixture.domainId,
      publicIp: fixture.publicIp,
      labGroup: fixture.labGroup,
      officialVoting: fixture.officialVoting,
      participantWallet: cachedWallet || fixture.participantWallet,
      syncPhase: parseArchiveSyncPhase(cached.syncPhase) ?? fixture.syncPhase,
      seatingQualified: cached.seatingQualified === true,
    } as LabArchiveRow
  })
}

export function defaultSnapshot(archiveUrl: string): TrustedExplorerSnapshot {
  return {
    fetchedAt: new Date(0).toISOString(),
    archiveUrl,
    live: false,
    health: null,
    info: EMPTY_INFO,
    tip: EMPTY_TIP,
    clusterCount: GENESIS_CLUSTER_COUNT,
    liveGroupIds: EMPTY_LIVE_GROUP_IDS,
    certificate: EMPTY_CERTIFICATE,
    waitingPool: LAB_WAITING_POOL_FIXTURE,
    selection: LAB_SELECTION_FIXTURE,
    events: sortEventsNewestFirst(DEMO_EVENT_FIXTURES),
    archives: LAB_ARCHIVE_FIXTURES,
    rpc: emptyRpcRows(),
  }
}

function productionArchiveUrl(): string {
  const fromEnv = import.meta.env.VITE_DLE_ARCHIVE_URL?.replace(/\/$/, '')
  if (fromEnv) return fromEnv
  if (typeof window !== 'undefined' && window.location.hostname === 'dle.conet.network') {
    return window.location.origin
  }
  return DEFAULT_ARCHIVE_URL
}

export function loadArchiveUrl(): string {
  try {
    const stored = localStorage.getItem(URL_KEY)
    if (typeof stored === 'string' && /^https?:\/\//.test(stored)) return stored.replace(/\/$/, '')
  } catch {
    /* ignore */
  }
  return productionArchiveUrl()
}

export function saveArchiveUrl(url: string): void {
  try {
    localStorage.setItem(URL_KEY, url.replace(/\/$/, ''))
  } catch {
    /* ignore */
  }
}

export function loadTrustedSnapshot(archiveUrl: string): TrustedExplorerSnapshot {
  const fallback = defaultSnapshot(archiveUrl)
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY)
    if (raw === null) return fallback
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || parsed.archiveUrl !== archiveUrl) return fallback
    if (!Array.isArray(parsed.events) || !Array.isArray(parsed.archives) || !Array.isArray(parsed.rpc)) {
      return fallback
    }
    return {
      ...fallback,
      ...parsed,
      archiveUrl,
      waitingPool:
        parseWaitingPool(
          parsed.waitingPool,
          isRecord(parsed.waitingPool) && parsed.waitingPool.source === 'live' ? 'live' : 'fixture',
        ) ?? fallback.waitingPool,
      selection:
        parseSelectionLog(
          parsed.selection,
          isRecord(parsed.selection) && parsed.selection.source === 'live' ? 'live' : 'fixture',
        ) ?? fallback.selection,
      events: sortEventsNewestFirst(parsed.events as TrustedExplorerSnapshot['events']),
      archives: hydrateArchiveWallets(parsed.archives),
      rpc: parsed.rpc as TrustedExplorerSnapshot['rpc'],
      clusterCount: parseClusterCount(parsed) ?? fallback.clusterCount,
      liveGroupIds: parseLiveGroupIds(parsed) ?? fallback.liveGroupIds,
    }
  } catch {
    return fallback
  }
}

export function saveTrustedSnapshot(snapshot: TrustedExplorerSnapshot): void {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot))
  } catch {
    /* ignore */
  }
}
