import { canonicalGroupId, normalizeHash32 } from '../../shared/hashLookup.js'
import { registerLabChainNft, type LabRouteTable } from '../../shared/labRoute.js'
import {
  LAB_NEWCHAIN_NOTE,
  classNameOf,
  labChainNftIdFromRequestId,
  newChainRequestId,
  parseNewChainRequest,
  type DleLabGenesisCertificateV1,
  type DleLabNewChainRecordV1,
  type LabChainClassName,
} from '../../shared/newchain.js'
import { replayLabNewChainRequest } from '../bft/labCandidate.js'
import { indexLabHashObject } from '../hashPipe.js'
import type { ArchiveStore } from '../store.js'

export interface NewChainEngineOptions {
  domainId: string
  store: ArchiveStore
  routeTable: LabRouteTable
}

export interface NewChainEngine {
  accept(body: unknown): { status: number; body: Record<string, unknown> }
  list(): Record<string, unknown>
  health(): Record<string, unknown>
  get(pathname: string): Record<string, unknown> | undefined
  post(pathname: string, body: unknown): { status: number; body: unknown } | undefined
}

interface PersistedState {
  schema: 'DleLabNewChainStateV1'
  labOnly: true
  notL1Nft: true
  records: DleLabNewChainRecordV1[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function loadRecords(raw: unknown): DleLabNewChainRecordV1[] {
  if (!isRecord(raw) || raw.schema !== 'DleLabNewChainStateV1' || !Array.isArray(raw.records)) return []
  const out: DleLabNewChainRecordV1[] = []
  for (const row of raw.records) {
    if (!isRecord(row)) continue
    if (typeof row.requestId !== 'string' || typeof row.chainNftId !== 'string') continue
    if (typeof row.classId !== 'number' || typeof row.className !== 'string') continue
    if (typeof row.user !== 'string' || typeof row.valueHash !== 'string') continue
    if (typeof row.tipStateRoot !== 'string' || typeof row.bodyCommitment !== 'string') continue
    if (typeof row.acceptedAt !== 'string' || !isRecord(row.certificate)) continue
    const className = classNameOf(row.classId)
    if (className === null || className !== row.className) continue
    out.push(row as unknown as DleLabNewChainRecordV1)
  }
  return out
}

export function createNewChainEngine(options: NewChainEngineOptions): NewChainEngine {
  const records = new Map<string, DleLabNewChainRecordV1>()

  function persist(): void {
    const state: PersistedState = {
      schema: 'DleLabNewChainStateV1',
      labOnly: true,
      notL1Nft: true,
      records: [...records.values()],
    }
    options.store.persistNewChainState(state)
  }

  function indexRecord(record: DleLabNewChainRecordV1): { ok: true } | { ok: false; error: string } {
    const hash = normalizeHash32(record.valueHash)
    if (hash === null) return { ok: false, error: 'ERR_INVALID_VALUE_HASH' }
    if (!registerLabChainNft(options.routeTable, record.chainNftId)) {
      return { ok: false, error: 'ERR_ROUTE_REGISTER' }
    }
    return indexLabHashObject(
      options.store.hash,
      {
        schema: 'HashLocatorV1',
        hash,
        chainNftId: record.chainNftId,
        kind: 'ac',
        height: '0x1',
        groupId: canonicalGroupId(options.routeTable.ownGroupId),
        acRef: hash,
      },
      record.certificate,
    )
  }

  for (const record of loadRecords(options.store.loadNewChainState())) {
    records.set(record.requestId.toLowerCase(), record)
    indexRecord(record)
  }

  function listBody(): Record<string, unknown> {
    const chains = [...records.values()].sort((left, right) => left.acceptedAt.localeCompare(right.acceptedAt))
    return {
      schema: 'DleLabNewChainListV1',
      labOnly: true,
      notProductionDepin: true,
      notL1Nft: true,
      count: chains.length,
      chains,
    }
  }

  function health(): Record<string, unknown> {
    const byClass: Record<LabChainClassName, number> = { asset: 0, storage: 0, trade: 0 }
    for (const record of records.values()) byClass[record.className] += 1
    return {
      newchainLabOnly: true,
      newchainNotL1Nft: true,
      newchainCount: records.size,
      newchainByClass: byClass,
    }
  }

  function accept(body: unknown): { status: number; body: Record<string, unknown> } {
    const parsed = parseNewChainRequest(body)
    if (!parsed.ok) return { status: 400, body: { ok: false, error: parsed.reason } }
    const requestId = newChainRequestId(parsed.request)
    const existing = records.get(requestId.toLowerCase())
    if (existing !== undefined) {
      return {
        status: 200,
        body: {
          ok: true,
          duplicate: true,
          labOnly: true,
          notL1Nft: true,
          requestId,
          chainNftId: existing.chainNftId,
          classId: existing.classId,
          className: existing.className,
          valueHash: existing.valueHash,
          tipStateRoot: existing.tipStateRoot,
          certificate: existing.certificate,
        },
      }
    }
    const replay = replayLabNewChainRequest(parsed.request)
    if (!replay.ok) {
      return { status: 400, body: { ok: false, error: replay.reason, code: replay.code } }
    }
    const className = classNameOf(parsed.request.classId)
    if (className === null) {
      return { status: 400, body: { ok: false, error: 'classId is not a lab genesis class' } }
    }
    const chainNftId = labChainNftIdFromRequestId(requestId)
    const acceptedAt = new Date().toISOString()
    const certificate: DleLabGenesisCertificateV1 = {
      schema: 'DleLabGenesisCertificateV1',
      labOnly: true,
      notProductionDepin: true,
      notL1Nft: true,
      notArchiveCertificate: true,
      note: LAB_NEWCHAIN_NOTE,
      requestId,
      chainNftId,
      classId: parsed.request.classId,
      className,
      user: parsed.request.user,
      valueHash: replay.valueHash,
      tipStateRoot: replay.tipStateRoot,
      bodyCommitment: replay.bodyCommitment,
      height: '0x1',
      domainId: options.domainId,
      acceptedAt,
    }
    const record: DleLabNewChainRecordV1 = {
      requestId,
      chainNftId,
      classId: parsed.request.classId,
      className,
      user: parsed.request.user,
      valueHash: replay.valueHash,
      tipStateRoot: replay.tipStateRoot,
      bodyCommitment: replay.bodyCommitment,
      acceptedAt,
      certificate,
    }
    const indexed = indexRecord(record)
    if (!indexed.ok) {
      return { status: 500, body: { ok: false, error: indexed.error } }
    }
    records.set(requestId.toLowerCase(), record)
    persist()
    options.store.appendWal({
      type: 'newchain-accept',
      requestId,
      chainNftId,
      classId: record.classId,
      className,
    })
    return {
      status: 200,
      body: {
        ok: true,
        duplicate: false,
        labOnly: true,
        notL1Nft: true,
        requestId,
        chainNftId,
        classId: record.classId,
        className,
        valueHash: record.valueHash,
        tipStateRoot: record.tipStateRoot,
        certificate,
      },
    }
  }

  return {
    accept,
    list: listBody,
    health,
    get(pathname) {
      if (pathname === '/newchain/chains' || pathname === '/newchain/queue') return listBody()
      return undefined
    },
    post(pathname, body) {
      if (pathname === '/newchain/request') return accept(body)
      return undefined
    },
  }
}
