import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { DetailPageShell } from '../components/DetailPageShell'
import { HashCapsule } from '../components/HashCapsule'
import { JsonBlock } from '../components/JsonBlock'
import { StatusPill } from '../components/StatusPill'
import { fetchHashLookup } from '../lib/archiveClient'
import { HASH32_RE } from '../protocol'
import { useExplorer } from '../providers/ExplorerProvider'
import { useExplorerChrome } from '../providers/ExplorerChrome'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function HashLookupPage() {
  const { hash: rawHash } = useParams()
  const navigate = useNavigate()
  const { setShowFooter } = useExplorerChrome()
  const { archiveUrl } = useExplorer()
  const hash = rawHash?.toLowerCase() ?? ''
  const valid = HASH32_RE.test(hash)
  const [result, setResult] = useState<unknown>(null)
  const [untrusted, setUntrusted] = useState(false)

  useEffect(() => {
    setShowFooter(false)
    return () => setShowFooter(true)
  }, [setShowFooter])

  useEffect(() => {
    if (!valid) return
    let cancelled = false
    void (async () => {
      const next = await fetchHashLookup(archiveUrl, hash)
      if (cancelled) return
      if (next === null) {
        setUntrusted(true)
        return
      }
      setUntrusted(false)
      setResult(next)
    })()
    return () => {
      cancelled = true
    }
  }, [archiveUrl, hash, valid])

  const row = isRecord(result) ? result : null
  const hit = row?.status === 'hit'
  const locator = hit && isRecord(row.locator) ? row.locator : null
  const chainNftId = typeof locator?.chainNftId === 'string' ? locator.chainNftId : ''
  const hop = isRecord(row?.hop) ? row.hop : null
  const hopTarget = typeof hop?.targetDomainId === 'string' ? hop.targetDomainId : ''
  const hopFallback = hop?.usedLocalFallback === true
  const hopLabOnly = hop?.labOnly === true

  return (
    <DetailPageShell
      eyebrow="Hash lookup"
      title={valid ? hash : 'Invalid hash'}
      onBack={() => navigate('/')}
      pills={
        <>
          {hit ? <StatusPill label="Hit" tone="ok" /> : null}
          {row?.status === 'unavailable' ? <StatusPill label="Unavailable" tone="warn" /> : null}
          {untrusted ? <StatusPill label="Request failed" tone="warn" /> : null}
          {chainNftId !== '' ? <StatusPill label={`chainNftId ${chainNftId}`} tone="ok" /> : null}
          {hopTarget !== '' ? <StatusPill label={`hop ${hopTarget}`} tone="ok" /> : null}
          {hopFallback ? <StatusPill label="Local fallback" tone="warn" /> : null}
          {hopLabOnly ? <StatusPill label="Lab HTTP hop" tone="warn" /> : null}
        </>
      }
    >
      {valid ? (
        <div className="mb-4">
          <HashCapsule value={hash} />
        </div>
      ) : (
        <p className="text-sm text-slate-400">Enter a 32-byte hash (0x + 64 hex) from Home search.</p>
      )}
      {untrusted && result === null ? (
        <p className="text-sm text-amber-200">
          Lookup is unavailable because the last request did not complete. This is not a plane-wide not-found.
        </p>
      ) : null}
      {row?.status === 'unavailable' ? (
        <p className="mb-4 text-sm leading-6 text-slate-400">
          This lab group does not have a trusted locator for the hash. That is <span className="text-white">unavailable</span>
          , not a global null. A successful hit must include <span className="dle-mono text-cyan-300">chainNftId</span>.
          After locate, the object is fetched hop-1 from lab <span className="dle-mono text-cyan-300">historyProviders</span>
          {' '}
          (HTTP :27101). That hop is not production DePIN.
        </p>
      ) : null}
      {hit && chainNftId === '' ? (
        <p className="mb-4 text-sm text-amber-200">Protocol error: hit is missing chainNftId.</p>
      ) : null}
      {row ? <JsonBlock value={row} /> : null}
    </DetailPageShell>
  )
}
