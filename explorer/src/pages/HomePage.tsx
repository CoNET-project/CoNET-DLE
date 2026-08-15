import { Search } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ActivityChart } from '../components/ActivityChart'
import { ClusterGauge } from '../components/ClusterGauge'
import { EventTable } from '../components/EventTable'
import { MetricCard } from '../components/MetricCard'
import { RefreshButton } from '../components/RefreshButton'
import { StatusPill } from '../components/StatusPill'
import { MainPageShell } from '../components/TitleCapsule'
import { sortEventsNewestFirst } from '../lib/events'
import { formatHeight, formatInteger } from '../lib/format'
import { CONET_L1_CHAIN_ID, DLE_LAB_CHAIN_ID_HEX } from '../protocol'
import { useExplorer } from '../providers/ExplorerProvider'

export function HomePage() {
  const navigate = useNavigate()
  const { archiveUrl, setArchiveUrl, snapshot, refreshStatus, refreshNow } = useExplorer()
  const [draftUrl, setDraftUrl] = useState(archiveUrl)
  const [query, setQuery] = useState('')
  const info = snapshot.info
  const tip = snapshot.tip
  const active = snapshot.archives.filter((row) => row.role === 'active').length
  const standby = snapshot.archives.filter((row) => row.role === 'standby').length
  const liveCount = snapshot.archives.filter((row) => row.health === 'live').length
  const newestEvents = sortEventsNewestFirst(snapshot.events).slice(0, 8)
  const quorumOk = snapshot.health && snapshot.health.lastQuorumOk === true
  const archiveShare = snapshot.archives.length > 0 ? (liveCount / snapshot.archives.length) * 100 : 0

  const onSearch = (event: FormEvent) => {
    event.preventDefault()
    const next = query.trim()
    navigate(next === '' ? '/events' : `/events?q=${encodeURIComponent(next)}`)
  }

  return (
    <MainPageShell title="DLE Explorer" trailing={<RefreshButton status={refreshStatus} onClick={() => void refreshNow()} />}>
      <section className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300/70">CoNET-DLE</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Explore the DLE Network</h1>
        <form className="dle-glass mt-5 flex flex-col gap-2 rounded-full p-1.5 sm:flex-row sm:items-center" onSubmit={onSearch}>
          <label htmlFor="dle-event-search" className="sr-only">
            Search events
          </label>
          <div className="flex min-w-0 flex-1 items-center gap-2 px-3">
            <Search className="h-4 w-4 shrink-0 text-cyan-300" aria-hidden />
            <input
              id="dle-event-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search events by type, method, or domain"
              autoComplete="off"
              enterKeyHint="search"
              tabIndex={1}
              className="min-w-0 flex-1 bg-transparent py-2 text-sm text-white outline-none placeholder:text-slate-500"
            />
          </div>
          <button
            type="submit"
            tabIndex={2}
            className="rounded-full bg-[#00b4ff] px-5 py-2 text-sm font-semibold text-[#041018] shadow-[0_0_20px_rgba(0,180,255,0.35)]"
          >
            Search
          </button>
        </form>
      </section>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusPill label={snapshot.live ? 'Archive reachable' : 'Showing last trusted / fixture'} tone={snapshot.live ? 'ok' : 'warn'} />
        <StatusPill label="producesBlocks=false" tone="neutral" />
        <StatusPill label="No tip VM" tone="warn" />
        <StatusPill label={info?.l1Isolated === true ? 'L1 isolated' : 'L1 isolation unknown'} tone={info?.l1Isolated === true ? 'ok' : 'warn'} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Chain ID"
          value={info?.chainIdHex ?? DLE_LAB_CHAIN_ID_HEX}
          hint={`Decimal ${formatInteger(info?.chainId ?? 0x44c45)}. Not CoNET L1 ${CONET_L1_CHAIN_ID}.`}
        />
        <MetricCard
          label="Tip height"
          value={formatHeight(tip?.height ?? '0x0')}
          hint={tip?.finalized ? 'Finalized by Archive Certificate' : 'Not finalized — AC not produced yet'}
          tone={tip?.finalized ? 'default' : 'warn'}
        />
        <MetricCard
          label="Archives"
          value={`${formatInteger(snapshot.archives.length)} · 5+2`}
          hint={`${formatInteger(active)} active / ${formatInteger(standby)} standby · ${formatInteger(liveCount)} live from this endpoint`}
        />
        <MetricCard
          label="Archive Certificate"
          value={snapshot.certificate?.available ? 'Available' : 'Empty'}
          hint={snapshot.certificate?.reason}
          tone={snapshot.certificate?.available ? 'default' : 'warn'}
        />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <section className="dle-glass rounded-2xl p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-white">Network activity</h2>
            <p className="text-xs text-slate-400">Trusted event window</p>
          </div>
          <ActivityChart events={snapshot.events} />
        </section>
        <section className="dle-glass rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-white">DLE cluster status</h2>
          <p className="mt-1 text-xs text-slate-400">
            {formatInteger(liveCount)} live of {formatInteger(snapshot.archives.length)} rostered archives
          </p>
          <div className="mt-5 grid grid-cols-3 gap-2">
            <ClusterGauge
              label="Archives"
              value={archiveShare}
              hint={liveCount > 0 ? 'Reachable overlay' : 'Fixture / stale'}
              healthy={liveCount > 0}
            />
            <ClusterGauge
              label="Quorum"
              value={snapshot.certificate?.available || quorumOk ? 100 : 0}
              hint={snapshot.certificate?.available ? 'BFT 4-of-5' : quorumOk ? 'Heartbeat ok' : 'Not proven'}
              healthy={Boolean(snapshot.certificate?.available || quorumOk)}
            />
            <ClusterGauge
              label="Certificate"
              value={snapshot.certificate?.available ? 100 : 0}
              hint={snapshot.certificate?.available ? 'Available' : 'Empty AC'}
              healthy={Boolean(snapshot.certificate?.available)}
            />
          </div>
        </section>
      </div>

      <section className="dle-glass mt-4 rounded-2xl">
        <div className="flex items-center justify-between gap-2 px-4 pt-4">
          <h2 className="text-sm font-semibold text-white">Latest events</h2>
          <Link to="/events" className="text-xs font-semibold text-[#00b4ff]">
            View all
          </Link>
        </div>
        <EventTable events={newestEvents} />
      </section>

      <section className="dle-glass mt-4 rounded-2xl p-4">
        <h2 className="text-sm font-semibold text-white">
          <label htmlFor="archive-url">Archive endpoint</label>
        </h2>
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault()
            setArchiveUrl(draftUrl)
          }}
        >
          <input
            id="archive-url"
            value={draftUrl}
            onChange={(event) => setDraftUrl(event.target.value)}
            autoComplete="off"
            enterKeyHint="done"
            className="dle-mono min-w-0 flex-1 rounded-xl border border-cyan-400/20 bg-[#050910] px-3 py-2 text-sm text-cyan-50 outline-none focus:border-[#00b4ff]"
          />
          <button type="submit" className="rounded-xl bg-[#00b4ff] px-4 py-2 text-sm font-semibold text-[#041018]">
            Use endpoint
          </button>
        </form>
      </section>

      <section className="dle-glass mt-4 rounded-2xl p-4 text-sm leading-6 text-slate-400">
        <p>
          <span className="font-semibold text-white">Why this is not Blockscout:</span> archive nodes do not produce
          blocks, there is no tip VM, and {CONET_L1_CHAIN_ID} is the CoNET L1 chain id — DLE uses{' '}
          <span className="dle-mono text-cyan-300">{DLE_LAB_CHAIN_ID_HEX}</span>.
        </p>
      </section>
    </MainPageShell>
  )
}
