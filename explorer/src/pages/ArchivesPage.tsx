import { Link } from 'react-router-dom'
import { ParticipantWallet } from '../components/ParticipantWallet'
import { StatusPill } from '../components/StatusPill'
import { MainPageShell } from '../components/TitleCapsule'
import { archiveSeatingPill } from '../lib/archiveSeating'
import { formatInteger } from '../lib/format'
import { useExplorer } from '../providers/ExplorerProvider'
import type { LabArchiveGroup, LabArchiveRow } from '../types'

const GROUP_META: Record<
  LabArchiveGroup,
  { title: string; blurb: string }
> = {
  g1: {
    title: 'Group 1 — official voting roster (5+2)',
    blurb: 'Home Archives KPI counts only this group. Nginx Mode A upstream uses a subset of these IPs.',
  },
  g2: {
    title: 'Group 2 — second lab group (M6)',
    blurb: 'Separate archive plane (`~/dle-m6-g2`). Listed here with public IP; not an 8th–14th Home voting seat.',
  },
  extra: {
    title: 'Extra joiners',
    blurb: 'P11 standby and Seoul catch-up hosts. Outside official 5+2; do not count toward Home Archives.',
  },
}

const GROUP_ORDER: LabArchiveGroup[] = ['g1', 'g2', 'extra']

function ArchiveCard({ row }: { row: LabArchiveRow }) {
  return (
    <Link
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
          {row.officialVoting ? (
            <StatusPill label="voting seat" tone="ok" />
          ) : (
            <StatusPill label="listed only" tone="neutral" />
          )}
          <StatusPill {...archiveSeatingPill(row)} />
        </div>
      </div>
      <p className="dle-mono mt-3 text-sm font-semibold tracking-tight text-cyan-200">
        IP {row.publicIp}
        <span className="ml-2 font-normal text-slate-500">:27101</span>
      </p>
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
        heartbeat {row.lastQuorumOk === null ? '—' : row.lastQuorumOk ? 'ok' : 'no'} · peers{' '}
        {row.lastPeerOk === null ? '—' : formatInteger(row.lastPeerOk)}
        {row.syncPhase ? ` · sync ${row.syncPhase}` : ''}
      </p>
    </Link>
  )
}

function groupRows(archives: LabArchiveRow[]): Array<{ group: LabArchiveGroup; rows: LabArchiveRow[] }> {
  return GROUP_ORDER.map((group) => ({
    group,
    rows: archives.filter((row) => row.labGroup === group),
  })).filter((section) => section.rows.length > 0)
}

export function ArchivesPage() {
  const { snapshot } = useExplorer()
  const sections = groupRows(snapshot.archives)
  const total = snapshot.archives.length
  const voting = snapshot.archives.filter((row) => row.officialVoting).length

  return (
    <MainPageShell title="Archives">
      <p className="mb-2 text-sm leading-6 text-slate-400">
        All lab archive nodes with public IP. Total listed: {formatInteger(total)} · Home voting seats:{' '}
        {formatInteger(voting)} (G1 5+2 only). Live health merges from a trusted archive `/health` when the domain
        appears in that response; G2 and extras may stay fixture until probed. Seating green pill only when{' '}
        <code>seatingQualified === true</code>. Not a 30-day qualification claim.
      </p>
      <p className="mb-6 text-xs leading-5 text-slate-500">
        Why Home showed 7 while Clusters showed 2 groups: Home Archives = official G1 roster only. Group 2 is a
        second plane (7 hosts). This page lists every IP so operators can see the full lab.
      </p>
      <div className="space-y-8">
        {sections.map(({ group, rows }) => (
          <section key={group}>
            <header className="mb-3">
              <h2 className="text-sm font-semibold text-white">{GROUP_META[group].title}</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">{GROUP_META[group].blurb}</p>
              <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-cyan-200/50">
                {formatInteger(rows.length)} node{rows.length === 1 ? '' : 's'}
              </p>
            </header>
            <div className="space-y-3">
              {rows.map((row) => (
                <ArchiveCard key={row.domainId} row={row} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </MainPageShell>
  )
}
