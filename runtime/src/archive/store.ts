import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openHashStore, type HashStore } from './hashStore.js'

function atomicWriteJson(path: string, value: unknown): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, `${JSON.stringify(value)}\n`, 'utf8')
  renameSync(tmp, path)
}

const WAL_RING_MAX = 256

export interface ArchiveStore {
  readonly dataDir: string
  readonly hash: HashStore
  appendWal(record: Record<string, unknown>): void
  recentWal(limit?: number): Array<Record<string, unknown>>
  persistBftState(state: unknown): void
  loadBftState(): unknown | null
  persistOnDemandState(state: unknown): void
  loadOnDemandState(): unknown | null
  persistNewChainState(state: unknown): void
  loadNewChainState(): unknown | null
  persistMockL1State(state: unknown): void
  loadMockL1State(): unknown | null
  persistTradeState(state: unknown): void
  loadTradeState(): unknown | null
  persistSyncQualificationState(state: unknown): void
  loadSyncQualificationState(): unknown | null
}

export function openArchiveStore(dataDir: string): ArchiveStore {
  mkdirSync(dataDir, { recursive: true })
  const walPath = join(dataDir, 'archive.wal.ndjson')
  const identityPath = join(dataDir, 'archive-identity.json')
  const bftPath = join(dataDir, 'bft-state.json')
  const ondemandPath = join(dataDir, 'ondemand-state.json')
  const newchainPath = join(dataDir, 'newchain-state.json')
  const mockL1Path = join(dataDir, 'mockl1-state.json')
  const tradePath = join(dataDir, 'trade-state.json')
  const syncPath = join(dataDir, 'sync-qualification.json')
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
    hash: openHashStore(dataDir),
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
      atomicWriteJson(bftPath, state)
    },
    loadBftState() {
      if (!existsSync(bftPath)) return null
      try {
        return JSON.parse(readFileSync(bftPath, 'utf8')) as unknown
      } catch {
        return null
      }
    },
    persistOnDemandState(state) {
      atomicWriteJson(ondemandPath, state)
    },
    loadOnDemandState() {
      if (!existsSync(ondemandPath)) return null
      try {
        return JSON.parse(readFileSync(ondemandPath, 'utf8')) as unknown
      } catch {
        return null
      }
    },
    persistNewChainState(state) {
      atomicWriteJson(newchainPath, state)
    },
    loadNewChainState() {
      if (!existsSync(newchainPath)) return null
      try {
        return JSON.parse(readFileSync(newchainPath, 'utf8')) as unknown
      } catch {
        return null
      }
    },
    persistMockL1State(state) {
      atomicWriteJson(mockL1Path, state)
    },
    loadMockL1State() {
      if (!existsSync(mockL1Path)) return null
      try {
        return JSON.parse(readFileSync(mockL1Path, 'utf8')) as unknown
      } catch {
        return null
      }
    },
    persistTradeState(state) {
      atomicWriteJson(tradePath, state)
    },
    loadTradeState() {
      if (!existsSync(tradePath)) return null
      try {
        return JSON.parse(readFileSync(tradePath, 'utf8')) as unknown
      } catch {
        return null
      }
    },
    persistSyncQualificationState(state) {
      atomicWriteJson(syncPath, state)
    },
    loadSyncQualificationState() {
      if (!existsSync(syncPath)) return null
      try {
        return JSON.parse(readFileSync(syncPath, 'utf8')) as unknown
      } catch {
        return null
      }
    },
  }
}
