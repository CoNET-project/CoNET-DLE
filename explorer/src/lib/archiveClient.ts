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
  DleTipView,
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

export async function fetchExplorerCertificate(archiveUrl: string): Promise<DleCertificateView | null> {
  try {
    const body = await getJson(`${endpoint(archiveUrl)}/api/v2/dle/certificate`)
    if (!isRecord(body)) return null
    if (typeof body.available !== 'boolean' || typeof body.reason !== 'string') return null
    return {
      available: body.available,
      reason: body.reason,
      height: typeof body.height === 'string' ? body.height : undefined,
      hash: typeof body.hash === 'string' ? body.hash : undefined,
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

export function parseCertificate(value: unknown): DleCertificateView | null {
  if (!isRecord(value)) return null
  if (typeof value.available !== 'boolean') return null
  return {
    available: value.available,
    reason: typeof value.reason === 'string' ? value.reason : 'Archive Certificate is not available.',
    height: typeof value.height === 'string' ? value.height : undefined,
    hash: typeof value.hash === 'string' ? value.hash : undefined,
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
  chainId: DLE_LAB_CHAIN_ID,
  chainIdHex: DLE_LAB_CHAIN_ID_HEX,
  port: 27101,
}
