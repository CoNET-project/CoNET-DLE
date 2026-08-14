import { Link } from 'react-router-dom'
import type { DleEventRow } from '../types'
import { formatEventTime } from '../lib/format'
import { EventTypePill } from './EventTypePill'

export function EventTable({ events }: { events: DleEventRow[] }) {
  if (events.length === 0) {
    return <p className="px-4 py-8 text-sm text-slate-400">No matching events in the last trusted list.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="text-[11px] uppercase tracking-wide text-cyan-200/60">
          <tr>
            <th className="px-4 py-3 font-semibold">Type</th>
            <th className="px-4 py-3 font-semibold">Method</th>
            <th className="px-4 py-3 font-semibold">Detail</th>
            <th className="px-4 py-3 font-semibold">When</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id} className="border-t border-cyan-400/10 transition hover:bg-cyan-400/5">
              <td className="px-4 py-3">
                <Link to={`/events/${encodeURIComponent(event.id)}`} className="inline-flex">
                  <EventTypePill type={event.type} ok={event.ok} />
                </Link>
              </td>
              <td className="px-4 py-3">
                {event.method ? (
                  <Link
                    to={`/events/${encodeURIComponent(event.id)}`}
                    className="dle-mono text-[#00b4ff] hover:text-cyan-200"
                  >
                    {event.method}
                  </Link>
                ) : (
                  <span className="text-slate-500">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-slate-300">
                {event.domainId ?? event.detail ?? (event.ok === false ? 'rejected' : '—')}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-400">{formatEventTime(event.at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
