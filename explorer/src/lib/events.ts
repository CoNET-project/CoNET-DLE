import type { DleEventRow } from '../types'

export function sortEventsNewestFirst(events: DleEventRow[]): DleEventRow[] {
  return [...events].sort((left, right) => {
    const leftAt = Date.parse(left.at)
    const rightAt = Date.parse(right.at)
    const leftOk = Number.isFinite(leftAt)
    const rightOk = Number.isFinite(rightAt)
    if (leftOk && rightOk && leftAt !== rightAt) return rightAt - leftAt
    if (leftOk !== rightOk) return leftOk ? -1 : 1
    return right.id.localeCompare(left.id)
  })
}

export function filterEvents(events: DleEventRow[], query: string): DleEventRow[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return events
  return events.filter((event) =>
    [event.type, event.method, event.domainId, event.role, event.detail, event.id]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .join(' ')
      .toLowerCase()
      .includes(needle),
  )
}
