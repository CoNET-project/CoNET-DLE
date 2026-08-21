/**
 * MockL1ChainRegistrationV1 — parallel to lab `/newchain/request` (notL1Nft).
 * Uses a real local ERC-1155 tokenId; never upgrades lab requests.
 */

import {
  MOCK_L1_NOTE,
  mockL1ClassNameOf,
  mockL1GenesisHashes,
  parseMockL1Registration,
  type MockL1ChainClassName,
  type MockL1ChainRecordV1,
  type MockL1GenesisCertificateV1,
} from '../../shared/mockL1.js'
import { registerLabChainNft, type LabRouteTable } from '../../shared/labRoute.js'
import { normalizeHash32 } from '../../shared/hashLookup.js'
import { indexLabCertificateRoots } from '../hashPipe.js'
import { ERR_INVENTORY_FROZEN, inventoryCatalogFrozen } from '../inventoryFreeze.js'
import type { ArchiveStore } from '../store.js'

export interface MockL1EngineOptions {
  domainId: string
  store: ArchiveStore
  routeTable: LabRouteTable
}

export interface MockL1Engine {
  accept(body: unknown): { status: number; body: Record<string, unknown> }
  list(): Record<string, unknown>
  health(): Record<string, unknown>
  get(pathname: string): Record<string, unknown> | undefined
  post(pathname: string, body: unknown): { status: number; body: unknown } | undefined
}

interface PersistedState {
  schema: 'MockL1ChainStateV1'
  mockL1Only: true
  notLabNotL1Nft: true
  records: MockL1ChainRecordV1[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function loadRecords(raw: unknown): MockL1ChainRecordV1[] {
  if (!isRecord(raw) || raw.schema !== 'MockL1ChainStateV1' || !Array.isArray(raw.records)) return []
  const out: MockL1ChainRecordV1[] = []
  for (const row of raw.records) {
    if (!isRecord(row)) continue
    if (typeof row.requestCommitment !== 'string' || typeof row.chainNftId !== 'string') continue
    if (typeof row.classId !== 'number' || typeof row.className !== 'string') continue
    out.push(row as unknown as MockL1ChainRecordV1)
  }
  return out
}

export function createMockL1Engine(options: MockL1EngineOptions): MockL1Engine {
  const records = new Map<string, MockL1ChainRecordV1>()

  function persist(): void {
    const state: PersistedState = {
      schema: 'MockL1ChainStateV1',
      mockL1Only: true,
      notLabNotL1Nft: true,
      records: [...records.values()],
    }
    options.store.persistMockL1State(state)
  }

  for (const record of loadRecords(options.store.loadMockL1State())) {
    records.set(record.requestCommitment.toLowerCase(), record)
    registerLabChainNft(options.routeTable, record.chainNftId)
  }

  function listBody(): Record<string, unknown> {
    const chains = [...records.values()].sort((a, b) => a.acceptedAt.localeCompare(b.acceptedAt))
    return {
      schema: 'MockL1ChainListV1',
      mockL1Only: true,
      notProductionDepin: true,
      notLabNotL1Nft: true,
      note: MOCK_L1_NOTE,
      count: chains.length,
      chains,
    }
  }

  function health(): Record<string, unknown> {
    const byClass: Record<MockL1ChainClassName, number> = { asset: 0, storage: 0, trade: 0 }
    for (const record of records.values()) {
      byClass[record.className] += 1
    }
    return {
      mockL1Only: true,
      mockL1NotLabNotL1Nft: true,
      mockL1NotProductionDepin: true,
      mockL1Count: records.size,
      mockL1ByClass: byClass,
    }
  }

  function acceptBody(record: MockL1ChainRecordV1, duplicate: boolean): Record<string, unknown> {
    return {
      ok: true,
      duplicate,
      mockL1Only: true,
      notLabNotL1Nft: true,
      requestCommitment: record.requestCommitment,
      chainNftId: record.chainNftId,
      classId: record.classId,
      className: record.className,
      valueHash: record.valueHash,
      tipStateRoot: record.tipStateRoot,
      certificate: record.certificate,
      bound: record.bound,
    }
  }

  function accept(body: unknown): { status: number; body: Record<string, unknown> } {
    const parsed = parseMockL1Registration(body)
    if (!parsed.ok) return { status: 400, body: { ok: false, error: parsed.reason } }
    const key = parsed.request.requestCommitment.toLowerCase()
    const existing = records.get(key)
    if (existing !== undefined) {
      return { status: 200, body: acceptBody(existing, true) }
    }
    if (inventoryCatalogFrozen()) {
      return { status: 409, body: { ok: false, error: ERR_INVENTORY_FROZEN, inventoryFrozen: true } }
    }
    const className = mockL1ClassNameOf(parsed.request.classId)
    if (className === null) {
      return { status: 400, body: { ok: false, error: 'classId is not a mock-L1 genesis class' } }
    }
    const hashes = mockL1GenesisHashes({
      tokenId: parsed.request.tokenId,
      classId: parsed.request.classId,
      user: parsed.request.user,
      requestCommitment: parsed.request.requestCommitment,
    })
    const tipHash = normalizeHash32(hashes.tipStateRoot)
    const valueHash = normalizeHash32(hashes.valueHash)
    if (tipHash === null || valueHash === null) {
      return { status: 500, body: { ok: false, error: 'ERR_MOCK_L1_HASH' } }
    }
    const chainNftId = parsed.request.tokenId
    const acceptedAt = new Date().toISOString()
    const certificate: MockL1GenesisCertificateV1 = {
      schema: 'MockL1GenesisCertificateV1',
      mockL1Only: true,
      notProductionDepin: true,
      notLabNotL1Nft: true,
      note: MOCK_L1_NOTE,
      requestCommitment: parsed.request.requestCommitment,
      chainNftId,
      classId: parsed.request.classId,
      className,
      user: parsed.request.user,
      registry: parsed.request.registry,
      chainId: parsed.request.chainId,
      valueHash: hashes.valueHash,
      tipStateRoot: hashes.tipStateRoot,
      bodyCommitment: hashes.bodyCommitment,
      height: '0x1',
      acceptedAt,
    }
    const record: MockL1ChainRecordV1 = {
      requestCommitment: parsed.request.requestCommitment,
      chainNftId,
      classId: parsed.request.classId,
      className,
      user: parsed.request.user,
      registry: parsed.request.registry,
      chainId: parsed.request.chainId,
      valueHash: hashes.valueHash,
      tipStateRoot: hashes.tipStateRoot,
      bodyCommitment: hashes.bodyCommitment,
      acceptedAt,
      certificate,
      bound: parsed.request.bound,
    }
    if (!registerLabChainNft(options.routeTable, chainNftId)) {
      return { status: 500, body: { ok: false, error: 'ERR_ROUTE_REGISTER' } }
    }
    indexLabCertificateRoots(options.store.hash, {
      tipStateRoot: hashes.tipStateRoot,
      chainNftId,
      height: '0x1',
      acRef: hashes.valueHash,
      groupId: parsed.request.bound.archiveGroupId,
    })
    records.set(key, record)
    persist()
    options.store.appendWal({
      type: 'mockl1-register',
      requestCommitment: record.requestCommitment,
      chainNftId,
      classId: record.classId,
      className,
    })
    return { status: 200, body: acceptBody(record, false) }
  }

  return {
    accept,
    list: listBody,
    health,
    get(pathname) {
      if (pathname === '/mockl1/chains' || pathname === '/mockl1/queue') return listBody()
      return undefined
    },
    post(pathname, body) {
      if (pathname === '/mockl1/register') return accept(body)
      return undefined
    },
  }
}
