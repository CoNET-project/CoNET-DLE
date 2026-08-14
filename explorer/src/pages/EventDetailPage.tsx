import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { DetailPageShell } from '../components/DetailPageShell'
import { JsonBlock } from '../components/JsonBlock'
import { StatusPill } from '../components/StatusPill'
import { useExplorer } from '../providers/ExplorerProvider'
import { useExplorerChrome } from '../providers/ExplorerChrome'

export function EventDetailPage() {
  const { eventId } = useParams()
  const navigate = useNavigate()
  const { setShowFooter } = useExplorerChrome()
  const { snapshot } = useExplorer()
  const event = snapshot.events.find((row) => row.id === decodeURIComponent(eventId ?? ''))

  useEffect(() => {
    setShowFooter(false)
    return () => setShowFooter(true)
  }, [setShowFooter])

  return (
    <DetailPageShell
      eyebrow="Archive event"
      title={event?.type ?? 'Event'}
      onBack={() => navigate('/events')}
      pills={
        <>
          <StatusPill label={event?.source === 'live' ? 'Live' : 'Fixture'} tone={event?.source === 'live' ? 'ok' : 'neutral'} />
          {event?.ok === false ? <StatusPill label="Rejected" tone="bad" /> : null}
        </>
      }
    >
      {event ? <JsonBlock value={event} /> : <p className="text-sm text-slate-400">Event is not in the last trusted list.</p>}
    </DetailPageShell>
  )
}
