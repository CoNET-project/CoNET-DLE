import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const WAL_RING_MAX = 256

export interface ArchiveStore {
  readonly dataDir: string
  appendWal(record: Record<string, unknown>): void
  recentWal(limit?: number): Array<Record<string, unknown>>
  persistBftState(state: unknown): void
  loadBftState(): unknown | null
}

export function openArchiveStore(dataDir: string): ArchiveStore {
  mkdirSync(dataDir, { recursive: true })
  const walPath = join(dataDir, 'archive.wal.ndjson')
  const identityPath = join(dataDir, 'archive-identity.json')
  const bftPath = join(dataDir, 'bft-state.json')
  const ring: Array<Record<string, unknown>> = []
  writeFileSync(
    identityPath,
    `${JSON.stringify(
      {
        command: 'archive',
        runtime: 'nodejs',
        producesBlocks: false,
        openedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  return {
    dataDir,
    appendWal(record) {
      const row = { at: new Date().toISOString(), ...record }
      appendFileSync(walPath, `${JSON.stringify(row)}\n`, 'utf8')
      ring.push(row)
      if (ring.length > WAL_RING_MAX) ring.shift()
    },
    recentWal(limit = 100) {
      const take = Number.isInteger(limit) && limit > 0 ? Math.min(limit, WAL_RING_MAX) : 100
      return ring.slice(-take)
    },
    persistBftState(state) {
      writeFileSync(bftPath, `${JSON.stringify(state)}\n`, 'utf8')
    },
    loadBftState() {
      if (!existsSync(bftPath)) return null
      try {
        return JSON.parse(readFileSync(bftPath, 'utf8')) as unknown
      } catch {
        return null
      }
    },
  }
}
