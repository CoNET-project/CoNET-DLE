import { Link } from 'react-router-dom'
import { ParticipantWallet } from '../components/ParticipantWallet'
import { StatusPill } from '../components/StatusPill'
import { MainPageShell } from '../components/TitleCapsule'
import { formatInteger } from '../lib/format'
import { useExplorer } from '../providers/ExplorerProvider'

export function ArchivesPage() {
  const { snapshot } = useExplorer()

  return (
    <MainPageShell title="Archives">
      <p className="mb-4 text-sm leading-6 text-slate-400">
        Seven-domain lab roster (5 active + 2 standby). Each archive has a unique participant wallet on the CoNET L1
        Global Archive Routing Registry. Health fields merge only from a trusted live archive response. This list is
        not a 30-day qualification claim.
      </p>
      <div className="space-y-3">
        {snapshot.archives.map((row) => (
          <Link
            key={row.domainId}
            to={`/archives/${encodeURIComponent(row.domainId)}`}
            className="dle-glass dle-glass-hover block rounded-2xl p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="dle-mono text-sm font-semibold text-white">{row.domainId}</p>
              <div className="flex flex-wrap gap-2">
                <StatusPill label={row.role} tone={row.role === 'active' ? 'blue' : 'purple'} />
                <StatusPill
                  label={row.health}
                  tone={row.health === 'live' ? 'ok' : row.health === 'unreachable' ? 'bad' : 'neutral'}
                />
              </div>
            </div>
            <div className="mt-3">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-200/60">
                Participant wallet
              </p>
              <ParticipantWallet address={row.participantWallet} />
            </div>
            <p className="mt-2 text-xs text-slate-400">
              {row.provider} · {row.region}
            </p>
            <p className="dle-mono mt-1 text-xs text-slate-500">
              quorum {row.lastQuorumOk === null ? '—' : row.lastQuorumOk ? 'ok' : 'no'} · peers{' '}
              {row.lastPeerOk === null ? '—' : formatInteger(row.lastPeerOk)}
            </p>
          </Link>
        ))}
      </div>
    </MainPageShell>
  )
}
