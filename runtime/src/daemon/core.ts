import { parseJsonRpcBatchResponse, parseJsonRpcResponse } from '../shared/jsonrpc.js'
import {
  DLE_COMMAND,
  DLE_JSONRPC_VERSION,
  DLE_RUNTIME,
  type DleDaemonInfo,
  type DleRuntime,
  type JsonRpcResponse,
} from '../shared/protocol.js'

export function detectDaemonRuntime(): DleRuntime {
  return typeof globalThis === 'object' &&
    'document' in globalThis &&
    globalThis.document !== undefined
    ? DLE_RUNTIME.browser
    : DLE_RUNTIME.nodejs
}

export function daemonInfo(archiveUrl: string): DleDaemonInfo {
  return {
    command: DLE_COMMAND.daemon,
    runtime: detectDaemonRuntime(),
    archiveUrl,
  }
}

export interface OnDemandWaitSession {
  schema: 'DleOnDemandWaitV1'
  status: 'queued'
  slot: null
  note: string
}

export function createWaitSession(): OnDemandWaitSession {
  return {
    schema: 'DleOnDemandWaitV1',
    status: 'queued',
    slot: null,
    note: 'Wait hook is local-only in this scaffold; freeze poolRoot before drawing 7+2.',
  }
}

let rpcId = 1

export async function callArchive(
  archiveUrl: string,
  method: string,
  params: unknown = [],
): Promise<JsonRpcResponse> {
  const endpoint = archiveUrl.replace(/\/$/, '')
  const response = await fetch(`${endpoint}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: DLE_JSONRPC_VERSION,
      id: rpcId,
      method,
      params,
    }),
  })
  rpcId += 1
  if (!response.ok) throw new Error(`archive HTTP ${response.status}`)
  return parseJsonRpcResponse(await response.json())
}

export async function callArchiveBatch(
  archiveUrl: string,
  calls: Array<{ method: string; params?: unknown }>,
): Promise<JsonRpcResponse[]> {
  const endpoint = archiveUrl.replace(/\/$/, '')
  const response = await fetch(`${endpoint}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(
      calls.map((call, index) => ({
        jsonrpc: DLE_JSONRPC_VERSION,
        id: rpcId + index,
        method: call.method,
        params: call.params ?? [],
      })),
    ),
  })
  rpcId += calls.length
  if (!response.ok) throw new Error(`archive HTTP ${response.status}`)
  return parseJsonRpcBatchResponse(await response.json())
}

export async function fetchArchiveHealth(archiveUrl: string): Promise<Record<string, unknown>> {
  const endpoint = archiveUrl.replace(/\/$/, '')
  const response = await fetch(`${endpoint}/health`)
  if (!response.ok) throw new Error(`archive health HTTP ${response.status}`)
  const body: unknown = await response.json()
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('invalid archive health')
  }
  return body as Record<string, unknown>
}

export async function probeArchive(archiveUrl: string): Promise<{
  daemon: DleDaemonInfo
  health: Record<string, unknown>
  info: JsonRpcResponse
  wait: OnDemandWaitSession
}> {
  const health = await fetchArchiveHealth(archiveUrl)
  const info = await callArchive(archiveUrl, 'dle_info')
  return {
    daemon: daemonInfo(archiveUrl),
    health,
    info,
    wait: createWaitSession(),
  }
}
