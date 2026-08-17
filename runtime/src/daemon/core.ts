import { canonicalGroupId } from '../shared/hashLookup.js'
import { parseJsonRpcBatchResponse, parseJsonRpcResponse } from '../shared/jsonrpc.js'
import {
  drawCommittee,
  LAB_DAEMON_PROBE_MINER,
  LAB_GROUP_ID,
  LAB_HOOK_FANOUT_INCOMPLETE_NOTE,
  LAB_HOOK_FANOUT_QUEUED_NOTE,
  LAB_HOOK_SINGLE_ARCHIVE_NOTE,
  sameHexList,
  type SelectionView,
  type WaitingPoolView,
} from '../shared/ondemand/index.js'
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
  status: 'queued' | 'frozen' | 'rejected'
  slot: number | null
  miner: string
  groupId: string
  poolRoot: string | null
  committee: string[]
  standbys: string[]
  recomputed: boolean
  endorsed: boolean
  note: string
  hookNotGossip: true
  mustFanoutToEveryActiveArchive: true
  notProductionDepinGossip: true
  singleArchiveAcceptNotGroupPool: true
  fanoutComplete: boolean
}

export function createWaitSession(): OnDemandWaitSession {
  return {
    schema: 'DleOnDemandWaitV1',
    status: 'queued',
    slot: null,
    miner: LAB_DAEMON_PROBE_MINER,
    groupId: LAB_GROUP_ID,
    poolRoot: null,
    committee: [],
    standbys: [],
    recomputed: false,
    endorsed: false,
    note: 'Local queued placeholder. Call submitWaitHookToArchives to post the same wait-to-mine hook to every live archive. Hooks are not intra-group gossip.',
    hookNotGossip: true,
    mustFanoutToEveryActiveArchive: true,
    notProductionDepinGossip: true,
    singleArchiveAcceptNotGroupPool: true,
    fanoutComplete: false,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function postJson(archiveUrl: string, pathname: string, body: unknown): Promise<unknown> {
  const endpoint = archiveUrl.replace(/\/$/, '')
  const response = await fetch(`${endpoint}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return response.json()
}

async function getJson(archiveUrl: string, pathname: string): Promise<unknown> {
  const endpoint = archiveUrl.replace(/\/$/, '')
  const response = await fetch(`${endpoint}${pathname}`)
  if (!response.ok) throw new Error(`archive HTTP ${response.status}`)
  return response.json()
}

function recomputeFromPool(pool: WaitingPoolView, selection: SelectionView): boolean {
  if (selection.available !== true || pool.miners.length === 0) return false
  const drawn = drawCommittee({
    miners: pool.miners,
    epoch: pool.epoch,
    shardId: pool.shardId,
    beacon: selection.beacon,
  })
  return (
    drawn.poolRoot === selection.poolRoot &&
    drawn.roulette === selection.roulette &&
    sameHexList(drawn.committee, selection.committee) &&
    sameHexList(drawn.standbys, selection.standbys)
  )
}

export async function submitWaitHook(
  archiveUrl: string,
  miner: string = LAB_DAEMON_PROBE_MINER,
  groupId: string = LAB_GROUP_ID,
): Promise<OnDemandWaitSession> {
  const canonical = canonicalGroupId(groupId)
  const hook = await postJson(archiveUrl, '/ondemand/hook', {
    schema: 'DleOnDemandHookV1',
    miner,
    groupId: canonical,
  })
  const poolRaw = await getJson(archiveUrl, '/ondemand/pool')
  const selectionRaw = await getJson(archiveUrl, '/ondemand/selection')
  const pool = isRecord(poolRaw) ? (poolRaw as unknown as WaitingPoolView) : null
  const selection = isRecord(selectionRaw) ? (selectionRaw as unknown as SelectionView) : null
  const recomputed = pool !== null && selection !== null ? recomputeFromPool(pool, selection) : false
  const hookRow = isRecord(hook) ? hook : {}
  const status =
    hookRow.status === 'frozen' || hookRow.error === 'ERR_POOL_FROZEN'
      ? 'frozen'
      : hookRow.status === 'rejected' || hookRow.error === 'ERR_DUPLICATE_HOOK'
        ? 'rejected'
        : 'queued'
  const selected = selection !== null && selection.available === true ? selection : null
  return {
    schema: 'DleOnDemandWaitV1',
    status,
    slot: typeof hookRow.slot === 'number' ? hookRow.slot : null,
    miner,
    groupId: canonical,
    poolRoot: selected?.poolRoot ?? pool?.poolRoot ?? null,
    committee: selected?.committee ?? [],
    standbys: selected?.standbys ?? [],
    recomputed,
    endorsed: selected?.endorsed === true,
    note:
      status === 'frozen'
        ? 'Pool already frozen on this archive. One archive accept is not a group waiting pool. Hooks are not intra-group gossip.'
        : status === 'rejected'
          ? 'Duplicate wait hook rejected (one in-flight hook per miner and group). Hooks are not intra-group gossip.'
          : LAB_HOOK_SINGLE_ARCHIVE_NOTE,
    hookNotGossip: true,
    mustFanoutToEveryActiveArchive: true,
    notProductionDepinGossip: true,
    singleArchiveAcceptNotGroupPool: true,
    fanoutComplete: false,
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

function asWaitingPool(value: unknown): WaitingPoolView | null {
  if (!isRecord(value) || value.schema !== 'DleWaitingPoolV1') return null
  if (!Array.isArray(value.miners) || !value.miners.every((item) => typeof item === 'string')) return null
  if (typeof value.minerCount !== 'number' || typeof value.frozen !== 'boolean') return null
  return value as unknown as WaitingPoolView
}

export async function fetchWaitingPool(archiveUrl: string): Promise<WaitingPoolView> {
  const pool = asWaitingPool(await getJson(archiveUrl, '/ondemand/pool'))
  if (pool === null) throw new Error('invalid waiting pool')
  return pool
}

export async function fetchSelectionLog(archiveUrl: string): Promise<SelectionView> {
  const raw = await getJson(archiveUrl, '/ondemand/selection')
  if (!isRecord(raw) || raw.schema !== 'DleLabSelectionLogV1') throw new Error('invalid selection')
  return raw as unknown as SelectionView
}

export async function freezeWaitingPool(archiveUrl: string): Promise<unknown> {
  return postJson(archiveUrl, '/ondemand/freeze', { schema: 'DleOnDemandFreezeV1' })
}

export interface ArchiveHookResult {
  archiveUrl: string
  status: OnDemandWaitSession['status']
  minerInPool: boolean
}

export async function submitWaitHookToArchives(
  archiveUrls: readonly string[],
  miner: string,
  groupId: string = LAB_GROUP_ID,
): Promise<OnDemandWaitSession & { archives: ArchiveHookResult[] }> {
  const canonical = canonicalGroupId(groupId)
  if (archiveUrls.length === 0) throw new Error('submitWaitHookToArchives requires at least one archive URL')
  const archives: ArchiveHookResult[] = []
  for (const archiveUrl of archiveUrls) {
    let minerInPool = false
    try {
      const pool = await fetchWaitingPool(archiveUrl)
      minerInPool = pool.miners.some((row) => row.toLowerCase() === miner.toLowerCase())
    } catch {
      minerInPool = false
    }
    if (minerInPool) {
      archives.push({ archiveUrl, status: 'queued', minerInPool: true })
      continue
    }
    const session = await submitWaitHook(archiveUrl, miner, canonical)
    archives.push({
      archiveUrl,
      status: session.status,
      minerInPool: session.status === 'queued',
    })
  }
  const firstUrl = archiveUrls[0]!
  const pool = asWaitingPool(await getJson(firstUrl, '/ondemand/pool'))
  const selectionRaw = await getJson(firstUrl, '/ondemand/selection')
  const selection = isRecord(selectionRaw) ? (selectionRaw as unknown as SelectionView) : null
  const recomputed = pool !== null && selection !== null ? recomputeFromPool(pool, selection) : false
  const selected = selection !== null && selection.available === true ? selection : null
  const allQueued = archives.every((row) => row.status === 'queued')
  const anyFrozen = archives.some((row) => row.status === 'frozen')
  const status: OnDemandWaitSession['status'] = allQueued ? 'queued' : anyFrozen ? 'frozen' : 'rejected'
  return {
    schema: 'DleOnDemandWaitV1',
    status,
    slot: (() => {
      if (pool === null) return null
      const index = pool.miners.findIndex((row) => row.toLowerCase() === miner.toLowerCase())
      return index >= 0 ? index : null
    })(),
    miner,
    groupId: canonical,
    poolRoot: selected?.poolRoot ?? pool?.poolRoot ?? null,
    committee: selected?.committee ?? [],
    standbys: selected?.standbys ?? [],
    recomputed,
    endorsed: selected?.endorsed === true,
    archives,
    hookNotGossip: true,
    mustFanoutToEveryActiveArchive: true,
    notProductionDepinGossip: true,
    singleArchiveAcceptNotGroupPool: true,
    fanoutComplete: allQueued,
    note:
      status === 'frozen'
        ? 'One or more archives already froze the waiting pool. Hooks are not intra-group gossip.'
        : status === 'rejected'
          ? LAB_HOOK_FANOUT_INCOMPLETE_NOTE
          : LAB_HOOK_FANOUT_QUEUED_NOTE,
  }
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
    wait: await submitWaitHook(archiveUrl),
  }
}
