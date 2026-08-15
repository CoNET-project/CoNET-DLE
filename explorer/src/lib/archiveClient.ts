import {
  DLE_ARCHIVE_METHODS,
  DLE_JSONRPC_VERSION,
  DLE_LAB_CHAIN_ID,
  DLE_LAB_CHAIN_ID_HEX,
  DLE_REJECTED_METHODS,
} from '../protocol'
import type {
  DleArchiveInfo,
  DleCertificateView,
  DleEventRow,
  DleSelectionLogView,
  DleTipView,
  DleWaitingPoolView,
  JsonRpcResponse,
  LabArchiveRow,
  RpcProbeRow,
} from '../types'
import { LAB_ARCHIVE_FIXTURES } from '../fixtures/labArchives'
import { sortEventsNewestFirst } from './events'
import { isRecord, parseJsonRpcResponse } from './jsonrpc'

const FETCH_MS = 8_000
let rpcId = 1

function endpoint(archiveUrl: string): string {
  return archiveUrl.replace(/\/$/, '')
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_MS) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

export async function fetchArchiveHealth(archiveUrl: string): Promise<Record<string, unknown>> {
  const body = await getJson(`${endpoint(archiveUrl)}/health`)
  if (!isRecord(body) || body.ok !== true) throw new Error('invalid archive health')
  return body
}

export async function callArchive(
  archiveUrl: string,
  method: string,
  params: unknown[] = [],
): Promise<JsonRpcResponse> {
  const response = await fetch(`${endpoint(archiveUrl)}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: DLE_JSONRPC_VERSION,
      id: rpcId,
      method,
      params,
    }),
    signal: AbortSignal.timeout(FETCH_MS),
  })
  rpcId += 1
  if (!response.ok) throw new Error(`archive HTTP ${response.status}`)
  return parseJsonRpcResponse(await response.json())
}

export async function fetchExplorerOverview(archiveUrl: string): Promise<Record<string, unknown> | null> {
  try {
    const body = await getJson(`${endpoint(archiveUrl)}/api/v2/dle`)
    if (!isRecord(body) || body.schema !== 'DleExplorerApiV1') return null
    return body
  } catch {
    return null
  }
}

export async function fetchExplorerEvents(archiveUrl: string): Promise<DleEventRow[] | null> {
  try {
    const body = await getJson(`${endpoint(archiveUrl)}/api/v2/dle/events`)
    if (!isRecord(body) || body.schema !== 'DleExplorerEventsV1' || !Array.isArray(body.events)) {
      return null
    }
    return sortEventsNewestFirst(
      body.events
        .map((row, index) => normalizeEvent(row, index, 'live'))
        .filter((row): row is DleEventRow => row !== null),
    )
  } catch {
    return null
  }
}

export async function fetchOnDemandPool(archiveUrl: string): Promise<DleWaitingPoolView | null> {
  try {
    return parseWaitingPool(await getJson(`${endpoint(archiveUrl)}/ondemand/pool`), 'live')
  } catch {
    return null
  }
}

export async function fetchOnDemandSelection(archiveUrl: string): Promise<DleSelectionLogView | null> {
  try {
    return parseSelectionLog(await getJson(`${endpoint(archiveUrl)}/ondemand/selection`), 'live')
  } catch {
    return null
  }
}

export async function fetchExplorerCertificate(archiveUrl: string): Promise<DleCertificateView | null> {
  try {
    const body = await getJson(`${endpoint(archiveUrl)}/api/v2/dle/certificate`)
    if (!isRecord(body)) return null
    if (typeof body.available !== 'boolean' || typeof body.reason !== 'string') return null
    return parseCertificate(body) ?? {
      available: body.available,
      reason: body.reason,
    }
  } catch {
    return null
  }
}

export function parseArchiveInfo(value: unknown): DleArchiveInfo | null {
  if (!isRecord(value)) return null
  if (value.command !== 'archive' || value.runtime !== 'nodejs') return null
  if (value.producesBlocks !== false || value.hasTipVm !== false) return null
  if (typeof value.chainId !== 'number' || typeof value.chainIdHex !== 'string') return null
  if (value.chainId === 224422 || value.chainIdHex === '0x36ca6') return null
  return {
    command: 'archive',
    runtime: 'nodejs',
    producesBlocks: false,
    hasTipVm: false,
    ...(value.l1Isolated === true ? { l1Isolated: true as const } : {}),
    ...(typeof value.l1ChainIdForbidden === 'number'
      ? { l1ChainIdForbidden: value.l1ChainIdForbidden }
      : {}),
    ...(value.batchSupported === true ? { batchSupported: true as const } : {}),
    chainId: value.chainId,
    chainIdHex: value.chainIdHex,
    port: typeof value.port === 'number' ? value.port : 27101,
    domainId: typeof value.domainId === 'string' ? value.domainId : undefined,
    role: typeof value.role === 'string' ? value.role : undefined,
  }
}

export function parseTip(value: unknown): DleTipView | null {
  if (!isRecord(value)) return null
  if (typeof value.height !== 'string' || typeof value.hash !== 'string') return null
  if (typeof value.finalized !== 'boolean' || typeof value.note !== 'string') return null
  return {
    height: value.height,
    hash: value.hash,
    finalized: value.finalized,
    note: value.note,
  }
}

function isHexAddress(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
}

function isHex32(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)
}

export function parseWaitingPool(
  value: unknown,
  source: 'live' | 'fixture' = 'live',
): DleWaitingPoolView | null {
  if (!isRecord(value) || value.schema !== 'DleWaitingPoolV1') return null
  if (typeof value.groupId !== 'string' || typeof value.shardId !== 'string') return null
  if (typeof value.epoch !== 'number' || typeof value.frozen !== 'boolean') return null
  if (typeof value.minerCount !== 'number' || !Array.isArray(value.miners)) return null
  const miners = value.miners.filter(isHexAddress)
  if (miners.length !== value.miners.length) return null
  const poolRoot = value.poolRoot === null ? null : isHex32(value.poolRoot) ? value.poolRoot : null
  if (value.poolRoot !== null && poolRoot === null) return null
  return {
    schema: 'DleWaitingPoolV1',
    groupId: value.groupId,
    epoch: value.epoch,
    shardId: value.shardId,
    frozen: value.frozen,
    miners,
    poolRoot,
    minerCount: value.minerCount,
    source,
  }
}

export function parseSelectionLog(
  value: unknown,
  source: 'live' | 'fixture' = 'live',
): DleSelectionLogView | null {
  if (!isRecord(value) || value.schema !== 'DleLabSelectionLogV1') return null
  if (value.available === false) {
    return {
      schema: 'DleLabSelectionLogV1',
      available: false,
      reason: typeof value.reason === 'string' ? value.reason : 'Waiting pool is not frozen yet.',
      source,
    }
  }
  if (value.available !== true) return null
  if (!isHex32(value.poolRoot) || !isHex32(value.beacon) || !isHex32(value.roulette)) return null
  if (typeof value.epoch !== 'number' || typeof value.endorsed !== 'boolean') return null
  if (typeof value.shardId !== 'string' || typeof value.groupId !== 'string') return null
  if (!Array.isArray(value.committee) || !Array.isArray(value.standbys) || !Array.isArray(value.attestors)) {
    return null
  }
  const committee = value.committee.filter(isHexAddress)
  const standbys = value.standbys.filter(isHexAddress)
  const attestors = value.attestors.filter((item): item is string => typeof item === 'string')
  if (committee.length !== value.committee.length || standbys.length !== value.standbys.length) return null
  if (attestors.length !== value.attestors.length) return null
  return {
    schema: 'DleLabSelectionLogV1',
    available: true,
    endorsed: value.endorsed,
    epoch: value.epoch,
    shardId: value.shardId,
    groupId: value.groupId,
    poolRoot: value.poolRoot,
    beacon: value.beacon,
    roulette: value.roulette,
    committee,
    standbys,
    attestors,
    quorum: typeof value.quorum === 'number' ? value.quorum : 4,
    labBeacon: true,
    labOnly: true,
    note:
      typeof value.note === 'string'
        ? value.note
        : 'Lab SelectionLog. Beacon is keccak after freeze, not CoNET L1 CL RANDAO. HMAC attests are forgeable. Not an Archive Certificate. Not 30-day qualification.',
    ...(typeof value.acceptedAt === 'string' ? { acceptedAt: value.acceptedAt } : {}),
    source,
  }
}

export function parseCertificate(value: unknown): DleCertificateView | null {
  if (!isRecord(value)) return null
  if (typeof value.available !== 'boolean') return null
  return {
    available: value.available,
    reason: typeof value.reason === 'string' ? value.reason : 'Archive Certificate is not available.',
    height: typeof value.height === 'string' ? value.height : undefined,
    hash: typeof value.hash === 'string' ? value.hash : undefined,
    quorum: typeof value.quorum === 'number' ? value.quorum : undefined,
    networked: value.networked === true ? true : undefined,
    modeA: value.modeA === true ? true : undefined,
    signers: Array.isArray(value.signers)
      ? value.signers.filter((item): item is string => typeof item === 'string')
      : undefined,
    kind: typeof value.kind === 'number' ? value.kind : undefined,
    round: typeof value.round === 'number' ? value.round : undefined,
    prevoteQCRef: typeof value.prevoteQCRef === 'string' ? value.prevoteQCRef : undefined,
    labOnly: value.labOnly === true ? true : undefined,
  }
}

export function normalizeEvent(value: unknown, index: number, source: 'live' | 'fixture'): DleEventRow | null {
  if (!isRecord(value)) return null
  const type = typeof value.type === 'string' ? value.type : 'event'
  const at = typeof value.at === 'string' ? value.at : new Date().toISOString()
  return {
    id: typeof value.id === 'string' ? value.id : `${source}-${type}-${at}-${index}`,
    at,
    type,
    method: typeof value.method === 'string' ? value.method : undefined,
    ok: typeof value.ok === 'boolean' ? value.ok : undefined,
    domainId: typeof value.domainId === 'string' ? value.domainId : undefined,
    role: typeof value.role === 'string' ? value.role : undefined,
    quorumOk: typeof value.quorumOk === 'boolean' ? value.quorumOk : undefined,
    peerOk: typeof value.peerOk === 'number' ? value.peerOk : undefined,
    port: typeof value.port === 'number' ? value.port : undefined,
    detail: typeof value.detail === 'string' ? value.detail : undefined,
    source,
  }
}

export function mergeArchivesWithHealth(
  previous: LabArchiveRow[],
  health: Record<string, unknown> | null,
): LabArchiveRow[] {
  const roster = previous.length > 0 ? previous : LAB_ARCHIVE_FIXTURES
  if (health === null) return roster
  const domainId = typeof health.domainId === 'string' ? health.domainId : ''
  const lastQuorumOk = typeof health.lastQuorumOk === 'boolean' ? health.lastQuorumOk : null
  const lastPeerOk = typeof health.lastPeerOk === 'number' ? health.lastPeerOk : null
  const heartbeats = typeof health.heartbeats === 'number' ? health.heartbeats : null
  if (domainId === '') {
    return roster.map((row) => ({ ...row }))
  }
  return roster.map((row) => {
    if (row.domainId !== domainId) return row
    return {
      ...row,
      health: 'live',
      lastQuorumOk,
      lastPeerOk,
      heartbeats,
      source: 'live',
      role: health.role === 'standby' || health.role === 'active' ? health.role : row.role,
    }
  })
}

export function rpcRowFromResponse(method: string, response: JsonRpcResponse): RpcProbeRow {
  if ('error' in response) {
    const rejected = DLE_REJECTED_METHODS.includes(method as (typeof DLE_REJECTED_METHODS)[number])
    return {
      method,
      status: rejected ? 'rejected' : 'error',
      result: response.error,
    }
  }
  return { method, status: 'ok', result: response.result }
}

export function emptyRpcRows(): RpcProbeRow[] {
  return [...DLE_ARCHIVE_METHODS, ...DLE_REJECTED_METHODS].map((method) => ({
    method,
    status: 'stale',
    result: null,
  }))
}

export const EMPTY_CERTIFICATE: DleCertificateView = {
  available: false,
  reason: 'Networked Archive Certificate is not produced in this scaffold.',
}

export const EMPTY_WAITING_POOL: DleWaitingPoolView = {
  schema: 'DleWaitingPoolV1',
  groupId: 'dle.lab.group.v1',
  epoch: 1,
  shardId: 'dle.lab.shard.v1',
  frozen: false,
  miners: [],
  poolRoot: null,
  minerCount: 0,
  source: 'fixture',
}

export const EMPTY_SELECTION: DleSelectionLogView = {
  schema: 'DleLabSelectionLogV1',
  available: false,
  reason: 'Waiting pool is not frozen yet.',
  source: 'fixture',
}

export const EMPTY_TIP: DleTipView = {
  height: '0x0',
  hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
  finalized: false,
  note: 'Archive node does not produce blocks; tip finality is an Archive Certificate.',
}

export const EMPTY_INFO: DleArchiveInfo = {
  command: 'archive',
  runtime: 'nodejs',
  producesBlocks: false,
  hasTipVm: false,
  l1Isolated: true,
  l1ChainIdForbidden: 224422,
  batchSupported: true,
  chainId: DLE_LAB_CHAIN_ID,
  chainIdHex: DLE_LAB_CHAIN_ID_HEX,
  port: 27101,
}
