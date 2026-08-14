import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DLE_ARCHIVE_METHODS,
  DLE_REJECTED_METHODS,
} from '../protocol'
import type { RefreshStatus, TrustedExplorerSnapshot } from '../types'
import {
  callArchive,
  fetchArchiveHealth,
  fetchExplorerCertificate,
  fetchExplorerEvents,
  fetchExplorerOverview,
  mergeArchivesWithHealth,
  parseArchiveInfo,
  parseCertificate,
  parseTip,
  rpcRowFromResponse,
} from '../lib/archiveClient'
import { sortEventsNewestFirst } from '../lib/events'
import { startTimeoutChain } from '../lib/scheduleRefresh'
import {
  loadArchiveUrl,
  loadTrustedSnapshot,
  saveArchiveUrl,
  saveTrustedSnapshot,
} from '../lib/trustedSnapshot'

const FEED_MS = 6_000
const REFRESH_HOLD_MS = 3_000

export function useArchiveFeed() {
  const [archiveUrl, setArchiveUrlState] = useState(loadArchiveUrl)
  const [snapshot, setSnapshot] = useState(() => loadTrustedSnapshot(loadArchiveUrl()))
  const [refreshStatus, setRefreshStatus] = useState<RefreshStatus>('idle')
  const snapshotRef = useRef(snapshot)
  const urlRef = useRef(archiveUrl)
  const inFlightRef = useRef(false)

  useEffect(() => {
    snapshotRef.current = snapshot
  }, [snapshot])

  const applyUrl = useCallback((next: string) => {
    const trimmed = next.replace(/\/$/, '')
    urlRef.current = trimmed
    saveArchiveUrl(trimmed)
    setArchiveUrlState(trimmed)
    const restored = loadTrustedSnapshot(trimmed)
    snapshotRef.current = restored
    setSnapshot(restored)
  }, [])

  const pull = useCallback(async (): Promise<boolean> => {
    if (inFlightRef.current) return snapshotRef.current.live
    inFlightRef.current = true
    const url = urlRef.current
    const previous = snapshotRef.current
    try {
      const [healthResult, overview, liveEvents, liveCertificate] = await Promise.all([
        fetchArchiveHealth(url).then(
          (value) => ({ ok: true as const, value }),
          () => ({ ok: false as const }),
        ),
        fetchExplorerOverview(url),
        fetchExplorerEvents(url),
        fetchExplorerCertificate(url),
      ])

      const health = healthResult.ok ? healthResult.value : previous.health
      const infoFromHealth = healthResult.ok ? parseArchiveInfo(healthResult.value) : null
      const infoFromOverview = overview ? parseArchiveInfo(overview.archive) : null
      const tipFromOverview = overview ? parseTip(overview.tip) : null
      const certFromOverview = overview ? parseCertificate(overview.certificate) : null

      const methods = [...DLE_ARCHIVE_METHODS, ...DLE_REJECTED_METHODS]
      const rpcSettled = await Promise.all(
        methods.map(async (method) => {
          try {
            return rpcRowFromResponse(method, await callArchive(url, method))
          } catch {
            return previous.rpc.find((row) => row.method === method) ?? {
              method,
              status: 'stale' as const,
              result: null,
            }
          }
        }),
      )

      const tipFromRpc = rpcSettled.find((row) => row.method === 'dle_tip' && row.status === 'ok')
      const infoFromRpc = rpcSettled.find((row) => row.method === 'dle_info' && row.status === 'ok')
      const certFromRpc = rpcSettled.find(
        (row) => row.method === 'dle_getArchiveCertificate' && row.status === 'ok',
      )

      const next: TrustedExplorerSnapshot = {
        fetchedAt: new Date().toISOString(),
        archiveUrl: url,
        live: healthResult.ok,
        health: healthResult.ok ? healthResult.value : previous.health,
        info: infoFromOverview ?? infoFromHealth ?? parseArchiveInfo(infoFromRpc?.result) ?? previous.info,
        tip: tipFromOverview ?? parseTip(tipFromRpc?.result) ?? previous.tip,
        certificate:
          liveCertificate ??
          certFromOverview ??
          parseCertificate(certFromRpc?.result) ??
          previous.certificate,
        events: sortEventsNewestFirst(liveEvents ?? previous.events),
        archives: mergeArchivesWithHealth(previous.archives, health),
        rpc: rpcSettled,
      }
      snapshotRef.current = next
      setSnapshot(next)
      if (healthResult.ok || liveEvents !== null || overview !== null) {
        saveTrustedSnapshot(next)
      }
      return healthResult.ok
    } catch {
      return false
    } finally {
      inFlightRef.current = false
    }
  }, [])

  useEffect(() => {
    return startTimeoutChain(async () => {
      await pull()
    }, FEED_MS)
  }, [archiveUrl, pull])

  const refreshNow = useCallback(async () => {
    if (refreshStatus !== 'idle') return
    setRefreshStatus('loading')
    const ok = await pull()
    setRefreshStatus(ok ? 'success' : 'error')
    window.setTimeout(() => setRefreshStatus('idle'), REFRESH_HOLD_MS)
  }, [pull, refreshStatus])

  return {
    archiveUrl,
    setArchiveUrl: applyUrl,
    snapshot,
    refreshStatus,
    refreshNow,
  }
}
