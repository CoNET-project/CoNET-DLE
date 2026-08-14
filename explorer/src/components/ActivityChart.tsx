import type { DleEventRow } from '../types'

const BUCKETS = 16

export function ActivityChart({ events }: { events: DleEventRow[] }) {
  const times = events
    .map((event) => Date.parse(event.at))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right)

  const counts = Array.from({ length: BUCKETS }, () => 0)
  if (times.length > 0) {
    const min = times[0] ?? 0
    const max = times[times.length - 1] ?? min
    const span = Math.max(max - min, 1)
    for (const time of times) {
      const index = Math.min(BUCKETS - 1, Math.floor(((time - min) / span) * BUCKETS))
      counts[index] = (counts[index] ?? 0) + 1
    }
  }

  const peak = Math.max(...counts, 1)
  const width = 560
  const height = 168
  const points = counts.map((count, index) => {
    const x = (index / Math.max(BUCKETS - 1, 1)) * width
    const y = height - (count / peak) * (height - 16) - 8
    return `${x},${y}`
  })
  const area = `0,${height} ${points.join(' ')} ${width},${height}`

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full" role="img" aria-label="Event activity over the trusted window">
      <defs>
        <linearGradient id="dle-activity-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#00b4ff" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#00b4ff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#dle-activity-fill)" />
      <polyline points={points.join(' ')} fill="none" stroke="#00b4ff" strokeWidth="2.5" strokeLinejoin="round" />
    </svg>
  )
}
