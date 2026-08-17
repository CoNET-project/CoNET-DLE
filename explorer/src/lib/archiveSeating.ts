import type { ArchiveSyncPhase, LabArchiveRow } from '../types'

const SYNC_PHASES: readonly ArchiveSyncPhase[] = [
  'SYNCING',
  'CLAIMED_SYNC',
  'STATE_CHALLENGE',
  'QUALIFIED',
  'REJECTED',
]

export function parseArchiveSyncPhase(value: unknown): ArchiveSyncPhase | null {
  return typeof value === 'string' && SYNC_PHASES.includes(value as ArchiveSyncPhase)
    ? (value as ArchiveSyncPhase)
    : null
}

export function archiveSeatingPill(row: LabArchiveRow): {
  label: string
  tone: 'ok' | 'warn' | 'bad' | 'neutral'
} {
  if (row.seatingQualified === true) return { label: 'seated', tone: 'ok' }
  if (row.syncPhase === 'REJECTED') return { label: 'REJECTED', tone: 'bad' }
  if (
    row.syncPhase === 'SYNCING' ||
    row.syncPhase === 'CLAIMED_SYNC' ||
    row.syncPhase === 'STATE_CHALLENGE'
  ) {
    return { label: row.syncPhase, tone: 'warn' }
  }
  return { label: 'not seated', tone: 'neutral' }
}
