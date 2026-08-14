import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { DetailPageShell } from '../components/DetailPageShell'
import { JsonBlock } from '../components/JsonBlock'
import { StatusPill } from '../components/StatusPill'
import { formatInteger } from '../lib/format'
import { useExplorer } from '../providers/ExplorerProvider'
import { useExplorerChrome } from '../providers/ExplorerChrome'

export function ArchiveDetailPage() {
  const { domainId } = useParams()
  const navigate = useNavigate()
  const { setShowFooter } = useExplorerChrome()
  const { snapshot } = useExplorer()
  const row = snapshot.archives.find((item) => item.domainId === decodeURIComponent(domainId ?? ''))

  useEffect(() => {
    setShowFooter(false)
    return () => setShowFooter(true)
  }, [setShowFooter])

  return (
    <DetailPageShell
      eyebrow="Archive node"
      title={row?.domainId ?? 'Archive'}
      onBack={() => navigate('/archives')}
      pills={
        row ? (
          <>
            <StatusPill label={row.role} tone={row.role === 'active' ? 'blue' : 'purple'} />
            <StatusPill label={row.health} tone={row.health === 'live' ? 'ok' : 'neutral'} />
          </>
        ) : null
      }
    >
      {row ? (
        <div className="space-y-4">
          <dl className="dle-glass grid gap-3 rounded-2xl p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-cyan-200/60">Last quorum</dt>
              <dd className="mt-1 font-medium text-white">
                {row.lastQuorumOk === null ? 'Unknown' : row.lastQuorumOk ? 'ok' : 'not ok'}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-cyan-200/60">Last peers ok</dt>
              <dd className="mt-1 font-medium text-white">
                {row.lastPeerOk === null ? '—' : formatInteger(row.lastPeerOk)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-cyan-200/60">Heartbeats</dt>
              <dd className="mt-1 font-medium text-white">
                {row.heartbeats === null ? '—' : formatInteger(row.heartbeats)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-cyan-200/60">Region</dt>
              <dd className="mt-1 font-medium text-white">{row.region}</dd>
            </div>
          </dl>
          <JsonBlock value={row} />
        </div>
      ) : (
        <p className="text-sm text-slate-400">This domain is not in the last trusted roster.</p>
      )}
    </DetailPageShell>
  )
}
