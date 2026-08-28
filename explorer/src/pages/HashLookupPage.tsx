import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { DetailPageShell } from '../components/DetailPageShell'
import { HashCapsule } from '../components/HashCapsule'
import { JsonBlock } from '../components/JsonBlock'
import { StatusPill } from '../components/StatusPill'
import { fetchHashIndexProof, fetchHashLookup } from '../lib/archiveClient'
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
  const [proof, setProof] = useState<unknown>(null)
  const [untrusted, setUntrusted] = useState(false)
  const [loading, setLoading] = useState(valid)

  useEffect(() => {
    setShowFooter(false)
    return () => setShowFooter(true)
  }, [setShowFooter])

  useEffect(() => {
    if (!valid) {
      setLoading(false)
      setResult(null)
      setProof(null)
      setUntrusted(false)
      return
    }
    let cancelled = false
    setResult(null)
    setProof(null)
    setUntrusted(false)
    setLoading(true)
    void (async () => {
      try {
        const [next, nextProof] = await Promise.all([
          fetchHashLookup(archiveUrl, hash),
          fetchHashIndexProof(archiveUrl, hash),
        ])
        if (cancelled) return
        if (next === null) {
          setUntrusted(true)
          return
        }
        setUntrusted(false)
        setResult(next)
        if (nextProof !== null) setProof(nextProof)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [archiveUrl, hash, valid])

  const row = isRecord(result) ? result : null
  const hit = row?.status === 'hit'
  const notFound = row?.status === 'notFound'
  const locator = hit && isRecord(row.locator) ? row.locator : null
  const kind = typeof locator?.kind === 'string' ? locator.kind : ''
  const chainNftId = typeof locator?.chainNftId === 'string' ? locator.chainNftId : ''
  const hop = isRecord(row?.hop) ? row.hop : null
  const hopTarget = typeof hop?.targetDomainId === 'string' ? hop.targetDomainId : ''
  const hopFallback = hop?.usedLocalFallback === true
  const hopLabOnly = hop?.labOnly === true
  const proofRow = isRecord(proof) ? proof : null
  const proofKind = typeof proofRow?.kind === 'string' ? proofRow.kind : ''
  const proofRoot = typeof proofRow?.hashIndexRoot === 'string' ? proofRow.hashIndexRoot : ''
  const proofNotHot = proofRow?.notHotGet === true

  return (
    <DetailPageShell
      eyebrow="Hash lookup"
      title={valid ? hash : 'Invalid hash'}
      onBack={() => navigate('/')}
      pills={
        <>
          {loading ? <StatusPill label="Loading" tone="neutral" /> : null}
          {!loading && hit ? <StatusPill label="Hit" tone="ok" /> : null}
          {!loading && kind === 'prevoteQc' ? <StatusPill label="Prevote QC" tone="purple" /> : null}
          {!loading && kind === 'tipStateRoot' ? <StatusPill label="Tip state root" tone="ok" /> : null}
          {!loading && kind === 'membershipRoot' ? <StatusPill label="Membership root" tone="purple" /> : null}
          {!loading && kind === 'ac' ? <StatusPill label="Archive Certificate" tone="blue" /> : null}
          {!loading && notFound ? <StatusPill label="Not found" tone="neutral" /> : null}
          {!loading && row?.status === 'unavailable' ? <StatusPill label="Unavailable" tone="warn" /> : null}
          {!loading && untrusted ? <StatusPill label="Request failed" tone="warn" /> : null}
          {!loading && chainNftId !== '' ? <StatusPill label={`chainNftId ${chainNftId}`} tone="ok" /> : null}
          {!loading && hopTarget !== '' ? <StatusPill label={`hop ${hopTarget}`} tone="ok" /> : null}
          {!loading && hopFallback ? <StatusPill label="Local fallback" tone="warn" /> : null}
          {!loading && hopLabOnly ? <StatusPill label="Lab HTTP hop" tone="warn" /> : null}
          {!loading && proofKind === 'inclusion' ? <StatusPill label="Index inclusion" tone="ok" /> : null}
          {!loading && proofKind === 'non-inclusion' ? <StatusPill label="Index non-inclusion" tone="warn" /> : null}
          {!loading && proofNotHot ? <StatusPill label="Tree is not hot Get" tone="warn" /> : null}
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
      {loading ? (
        <div
          className="flex flex-col items-center justify-center gap-3 py-16"
          role="status"
          aria-live="polite"
          aria-busy="true"
          aria-label="Loading hash detail"
        >
          <Loader2 className="h-8 w-8 animate-spin text-cyan-300" aria-hidden />
          <p className="text-sm text-slate-400">Loading hash detail…</p>
        </div>
      ) : null}
      {!loading && untrusted && result === null ? (
        <p className="text-sm text-amber-200">
          Lookup is unavailable because the last request did not complete. This is not a plane-wide not-found.
        </p>
      ) : null}
      {!loading && notFound ? (
        <p className="mb-4 text-sm leading-6 text-slate-400">
          This hash is not present in this group’s committed corpus. That is a this-group{' '}
          <span className="text-white">not-found</span>, not a plane-wide null.{' '}
          <span className="dle-mono text-cyan-300">tipStateRoot</span> and{' '}
          <span className="dle-mono text-cyan-300">membershipRoot</span> are first-class hash kinds; a hit returns their
          typed object, not the Archive Certificate.
        </p>
      ) : null}
      {!loading && row?.status === 'unavailable' ? (
        <p className="mb-4 text-sm leading-6 text-slate-400">
          The fact-check did not complete (request, hop, or adapter). That is{' '}
          <span className="text-white">unavailable</span>, not a not-found and not a global null. A successful hit must
          include <span className="dle-mono text-cyan-300">chainNftId</span>. After locate, the object is fetched hop-1
          from lab <span className="dle-mono text-cyan-300">historyProviders</span> (HTTP :27101). That hop is not
          production DePIN.
        </p>
      ) : null}
      {!loading && hit && chainNftId === '' ? (
        <p className="mb-4 text-sm text-amber-200">Protocol error: hit is missing chainNftId.</p>
      ) : null}
      {!loading && row ? <JsonBlock value={row} /> : null}
      {!loading && proofRow ? (
        <div className="mt-6">
          <p className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-500">HashIndexTreeV1 proof</p>
          {proofRoot !== '' ? (
            <p className="mb-3 text-sm text-slate-400">
              Independent lab checkpoint <span className="dle-mono text-cyan-300">{proofRoot}</span>
              . This is not the hot locate path and not a plane-wide null.
            </p>
          ) : null}
          <JsonBlock value={proofRow} />
        </div>
      ) : null}
    </DetailPageShell>
  )
}
