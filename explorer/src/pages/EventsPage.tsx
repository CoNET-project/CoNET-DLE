import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { EventTable } from '../components/EventTable'
import { StatusPill } from '../components/StatusPill'
import { MainPageShell } from '../components/TitleCapsule'
import { filterEvents, sortEventsNewestFirst } from '../lib/events'
import { useExplorer } from '../providers/ExplorerProvider'

export function EventsPage() {
  const { snapshot } = useExplorer()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryFromUrl = searchParams.get('q') ?? ''
  const [draft, setDraft] = useState(queryFromUrl)
  const live = snapshot.events.some((row) => row.source === 'live')
  const rows = useMemo(
    () => filterEvents(sortEventsNewestFirst(snapshot.events), queryFromUrl),
    [snapshot.events, queryFromUrl],
  )

  return (
    <MainPageShell title="Events">
      <div className="mb-4 flex flex-wrap gap-2">
        <StatusPill label={live ? 'Live WAL / RPC' : 'Demo fixture'} tone={live ? 'ok' : 'neutral'} />
        <StatusPill label={`${rows.length} events`} tone="blue" />
        <StatusPill label="Newest first" tone="ok" />
      </div>
      <p className="mb-4 text-sm leading-6 text-slate-400">
        Archive WAL, heartbeat, RPC, and lab-start events in reverse chronological order. Failed fetches keep the last
        trusted list.
      </p>
      <form
        className="dle-glass mb-4 flex flex-col gap-2 rounded-2xl p-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault()
          const next = draft.trim()
          setSearchParams(next === '' ? {} : { q: next })
        }}
      >
        <label htmlFor="events-filter" className="sr-only">
          Filter events
        </label>
        <input
          id="events-filter"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Filter by type, method, or domain"
          autoComplete="off"
          enterKeyHint="search"
          tabIndex={1}
          className="min-w-0 flex-1 rounded-xl bg-transparent px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500"
        />
        <button
          type="submit"
          tabIndex={2}
          className="rounded-xl bg-[#00b4ff] px-4 py-2 text-sm font-semibold text-[#041018]"
        >
          Apply
        </button>
      </form>
      <div className="dle-glass overflow-hidden rounded-2xl">
        <EventTable events={rows} />
      </div>
    </MainPageShell>
  )
}
