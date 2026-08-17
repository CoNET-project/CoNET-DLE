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
import type { ArchiveCertificate, ArchivePrevoteQc, ArchiveVote, BftPeer } from '../bft/types.js'
import { indexLabCertificateRoots } from '../hashPipe.js'
import { ERR_INVENTORY_FROZEN, inventoryCatalogFrozen } from '../inventoryFreeze.js'
import type { ArchiveStore } from '../store.js'
import {
  createNewChainGenesisBft,
  parseArchiveCertificate,
  parseArchivePrevoteQc,
  parseArchiveVote,
  type NewChainGenesisBft,
} from './genesisBft.js'
import {
  LAB_VALIDATOR_QUORUM,
  buildLabValidatorQuorum,
  parseLabValidatorQuorum,
  verifyLabValidatorQuorum,
  type DleLabValidatorQuorumV1,
} from './validatorQuorum.js'

export interface NewChainEngineOptions {
  domainId: string
  store: ArchiveStore
  routeTable: LabRouteTable
  role?: string
  peers?: BftPeer[]
  enableBft?: boolean
  fetchImpl?: typeof fetch
}

export interface NewChainEngine {
  accept(body: unknown): { status: number; body: Record<string, unknown> }
  list(): Record<string, unknown>
  health(): Record<string, unknown>
  get(pathname: string): Record<string, unknown> | undefined
  post(pathname: string, body: unknown): { status: number; body: unknown } | undefined
  start(): Promise<void>
  stop(): void
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
    const record: DleLabNewChainRecordV1 = {
      requestId: row.requestId as DleLabNewChainRecordV1['requestId'],
      chainNftId: row.chainNftId,
      classId: row.classId as DleLabNewChainRecordV1['classId'],
      className,
      user: row.user as DleLabNewChainRecordV1['user'],
      valueHash: row.valueHash as DleLabNewChainRecordV1['valueHash'],
      tipStateRoot: row.tipStateRoot as DleLabNewChainRecordV1['tipStateRoot'],
      bodyCommitment: row.bodyCommitment as DleLabNewChainRecordV1['bodyCommitment'],
      acceptedAt: row.acceptedAt,
      certificate: row.certificate as unknown as DleLabGenesisCertificateV1,
    }
    if (row.validatorQuorum !== undefined) {
      record.validatorQuorum = parseLabValidatorQuorum(row.validatorQuorum) ?? row.validatorQuorum
    }
    if (typeof row.archiveCertificatePending === 'boolean') {
      record.archiveCertificatePending = row.archiveCertificatePending
    }
    if (row.archiveCertificate !== undefined) record.archiveCertificate = row.archiveCertificate
    if (row.prevoteQc !== undefined) record.prevoteQc = row.prevoteQc
    if (Array.isArray(row.genesisVotes)) record.genesisVotes = row.genesisVotes
    out.push(record)
  }
  return out
}

export function createNewChainEngine(options: NewChainEngineOptions): NewChainEngine {
  const records = new Map<string, DleLabNewChainRecordV1>()
  const enableBft = options.enableBft === true
  const peers = options.peers ?? []
  let genesisBft: NewChainGenesisBft | null = null

  let persistTimer: ReturnType<typeof setTimeout> | undefined

  function persist(): void {
    const state: PersistedState = {
      schema: 'DleLabNewChainStateV1',
      labOnly: true,
      notL1Nft: true,
      records: [...records.values()],
    }
    options.store.persistNewChainState(state)
  }

  function persistNow(): void {
    if (persistTimer !== undefined) {
      clearTimeout(persistTimer)
      persistTimer = undefined
    }
    persist()
  }

  function persistSoon(): void {
    if (persistTimer !== undefined) return
    persistTimer = setTimeout(() => {
      persistTimer = undefined
      persist()
    }, 2_000)
  }

  function indexRouteAndTip(record: DleLabNewChainRecordV1): { ok: true } | { ok: false; error: string } {
    const hash = normalizeHash32(record.valueHash)
    if (hash === null) return { ok: false, error: 'ERR_INVALID_VALUE_HASH' }
    if (!registerLabChainNft(options.routeTable, record.chainNftId)) {
      return { ok: false, error: 'ERR_ROUTE_REGISTER' }
    }
    indexLabCertificateRoots(options.store.hash, {
      tipStateRoot: record.tipStateRoot,
      chainNftId: record.chainNftId,
      height: '0x1',
      acRef: hash,
      groupId: canonicalGroupId(options.routeTable.ownGroupId),
    })
    return { ok: true }
  }

  function applyGenesisSnapshot(input: {
    chainNftId: string
    requestId: string
    votes: ArchiveVote[]
    prevoteQc: ArchivePrevoteQc | null
    certificate: ArchiveCertificate | null
  }): void {
    const record = records.get(input.requestId.toLowerCase())
    if (record === undefined) return
    record.genesisVotes = input.votes
    if (input.prevoteQc !== null) record.prevoteQc = input.prevoteQc
    if (input.certificate !== null) {
      record.archiveCertificate = input.certificate
      record.archiveCertificatePending = false
      persistNow()
      return
    }
    persistSoon()
  }

  function attachTopic(record: DleLabNewChainRecordV1): void {
    if (genesisBft === null) return
    const hasAc = record.archiveCertificate !== undefined
    if (!hasAc && record.archiveCertificatePending !== true) return
    const votes = Array.isArray(record.genesisVotes)
      ? record.genesisVotes.map(parseArchiveVote).filter((vote): vote is ArchiveVote => vote !== null)
      : []
    genesisBft.ensureTopic({
      requestId: record.requestId,
      chainNftId: record.chainNftId,
      valueHash: record.valueHash,
      tipStateRoot: record.tipStateRoot,
      votes,
      prevoteQc: parseArchivePrevoteQc(record.prevoteQc),
      certificate: parseArchiveCertificate(record.archiveCertificate),
    })
  }

  if (enableBft) {
    genesisBft = createNewChainGenesisBft({
      domainId: options.domainId,
      role: options.role === 'active' ? 'active' : 'standby',
      peers,
      store: options.store,
      routeTable: options.routeTable,
      ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
      onPersist: applyGenesisSnapshot,
    })
  }

  for (const record of loadRecords(options.store.loadNewChainState())) {
    records.set(record.requestId.toLowerCase(), record)
    registerLabChainNft(options.routeTable, record.chainNftId)
    attachTopic(record)
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
    let pending = 0
    let certified = 0
    for (const record of records.values()) {
      byClass[record.className] += 1
      if (record.archiveCertificate !== undefined) certified += 1
      else if (record.archiveCertificatePending === true) pending += 1
    }
    return {
      newchainLabOnly: true,
      newchainNotL1Nft: true,
      newchainCount: records.size,
      newchainByClass: byClass,
      newchainValidatorQuorum: LAB_VALIDATOR_QUORUM,
      newchainValidatorQuorumEip712: true,
      newchainHmacForgeable: false,
      newchainArchivePending: pending,
      newchainArchiveCertified: certified,
    }
  }

  function acceptBody(record: DleLabNewChainRecordV1, duplicate: boolean): Record<string, unknown> {
    return {
      ok: true,
      duplicate,
      labOnly: true,
      notL1Nft: true,
      requestId: record.requestId,
      chainNftId: record.chainNftId,
      classId: record.classId,
      className: record.className,
      valueHash: record.valueHash,
      tipStateRoot: record.tipStateRoot,
      certificate: record.certificate,
      validatorQuorum: record.validatorQuorum,
      archiveCertificatePending: record.archiveCertificatePending === true,
      archiveCertificate: record.archiveCertificate ?? null,
    }
  }

  function accept(body: unknown): { status: number; body: Record<string, unknown> } {
    const parsed = parseNewChainRequest(body)
    if (!parsed.ok) return { status: 400, body: { ok: false, error: parsed.reason } }
    const requestId = newChainRequestId(parsed.request)
    const existing = records.get(requestId.toLowerCase())
    if (existing !== undefined) {
      return { status: 200, body: acceptBody(existing, true) }
    }
    if (inventoryCatalogFrozen()) {
      return { status: 409, body: { ok: false, error: ERR_INVENTORY_FROZEN, inventoryFrozen: true } }
    }
    const replay = replayLabNewChainRequest(parsed.request)
    if (!replay.ok) {
      return { status: 400, body: { ok: false, error: replay.reason, code: replay.code } }
    }
    const className = classNameOf(parsed.request.classId)
    if (className === null) {
      return { status: 400, body: { ok: false, error: 'classId is not a lab genesis class' } }
    }
    const subject = {
      requestId,
      valueHash: replay.valueHash,
      tipStateRoot: replay.tipStateRoot,
      bodyCommitment: replay.bodyCommitment,
    }
    const validatorQuorum: DleLabValidatorQuorumV1 = buildLabValidatorQuorum(subject)
    const verified = verifyLabValidatorQuorum(validatorQuorum, subject)
    if (!verified.ok) {
      return { status: 400, body: { ok: false, error: verified.reason } }
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
      validatorQuorum,
      archiveCertificatePending: true,
    }
    const indexed = indexRouteAndTip(record)
    if (!indexed.ok) {
      return { status: 500, body: { ok: false, error: indexed.error } }
    }
    records.set(requestId.toLowerCase(), record)
    persistNow()
    attachTopic(record)
    options.store.appendWal({
      type: 'newchain-accept',
      requestId,
      chainNftId,
      classId: record.classId,
      className,
      validatorQuorum: LAB_VALIDATOR_QUORUM,
    })
    return { status: 200, body: acceptBody(record, false) }
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
      if (pathname === '/newchain/bft') {
        if (genesisBft === null) return { status: 404, body: { ok: false, error: 'ERR_NEWCHAIN_BFT_DISABLED' } }
        const result = genesisBft.ingest(body)
        return { status: result.ok ? 200 : 400, body: result }
      }
      return undefined
    },
    async start() {
      if (genesisBft !== null) await genesisBft.start()
    },
    stop() {
      genesisBft?.stop()
      persistNow()
    },
  }
}
