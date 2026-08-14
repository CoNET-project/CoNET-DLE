import { DEFAULT_ARCHIVE_URL } from '../protocol'
import type { TrustedExplorerSnapshot } from '../types'
import { DEMO_EVENT_FIXTURES } from '../fixtures/demoEvents'
import { LAB_ARCHIVE_FIXTURES } from '../fixtures/labArchives'
import { EMPTY_CERTIFICATE, EMPTY_INFO, EMPTY_TIP, emptyRpcRows } from './archiveClient'
import { sortEventsNewestFirst } from './events'
import { isRecord } from './jsonrpc'

const SNAPSHOT_KEY = 'dle-explorer:trusted-snapshot:v1'
const URL_KEY = 'dle-explorer:archive-url:v1'

export function defaultSnapshot(archiveUrl: string): TrustedExplorerSnapshot {
  return {
    fetchedAt: new Date(0).toISOString(),
    archiveUrl,
    live: false,
    health: null,
    info: EMPTY_INFO,
    tip: EMPTY_TIP,
    certificate: EMPTY_CERTIFICATE,
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
      events: sortEventsNewestFirst(parsed.events as TrustedExplorerSnapshot['events']),
      archives: parsed.archives as TrustedExplorerSnapshot['archives'],
      rpc: parsed.rpc as TrustedExplorerSnapshot['rpc'],
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
