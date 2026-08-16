/**
 * Hop-1 object fetch after locate.
 * MUST call dle_getObject (local freezer on the peer). MUST NOT call dle_getByHash (recursion).
 * Laboratory HTTP :27101 only. Not production DePIN.
 */
import {
  canonicalGroupId,
  hashLookupUnavailable,
  normalizeChainNftId,
  normalizeHeightHex,
  type DleHop1ReceiptV1,
  type HashLookupResult,
  type HashLocatorV1,
} from '../shared/hashLookup.js'
import {
  hopTargets,
  isOwnGroup,
  routeGroupId,
  type LabHistoryWallet,
  type LabRouteTable,
} from '../shared/labRoute.js'
import type { HashStore } from './hashStore.js'

export const HOP1_TIMEOUT_MS = 2_500

export interface DleHashObjectHit {
  schema: 'DleHashObjectV1'
  status: 'hit'
  chainNftId: string
  height: string
  object: unknown
}

export interface DleHashObjectUnavailable {
  schema: 'DleHashObjectV1'
  status: 'unavailable'
  planeWideNull: false
  reason: string
  chainNftId?: string
  height?: string
}

export type DleHashObjectResult = DleHashObjectHit | DleHashObjectUnavailable

export type Hop1Fetch = (
  url: string,
  chainNftId: string,
  height: string,
) => Promise<unknown | null>

function hopReceipt(partial: Omit<DleHop1ReceiptV1, 'schema' | 'labOnly' | 'notProductionDepin' | 'transport'>): DleHop1ReceiptV1 {
  return {
    schema: 'DleHop1ReceiptV1',
    labOnly: true,
    notProductionDepin: true,
    transport: 'lab-http-27101',
    ...partial,
    groupId: partial.groupId === '' ? '' : canonicalGroupId(partial.groupId),
  }
}

export function getObjectLocal(store: HashStore, chainNftId: string, height: string): DleHashObjectResult {
  const nft = normalizeChainNftId(chainNftId)
  const heightHex = normalizeHeightHex(height)
  if (nft === null || heightHex === null) {
    return {
      schema: 'DleHashObjectV1',
      status: 'unavailable',
      planeWideNull: false,
      reason: 'Invalid chainNftId or height.',
    }
  }
  const object = store.getBody(nft, heightHex)
  if (object === null || object === undefined) {
    return {
      schema: 'DleHashObjectV1',
      status: 'unavailable',
      planeWideNull: false,
      reason: 'Object is not in this archive freezer.',
      chainNftId: nft,
      height: heightHex,
    }
  }
  return {
    schema: 'DleHashObjectV1',
    status: 'hit',
    chainNftId: nft,
    height: heightHex,
    object,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parseHopObject(value: unknown, chainNftId: string): unknown | null {
  if (!isRecord(value)) return null
  if (value.status === 'unavailable') return null
  if (value.status === 'hit') {
    const nft = normalizeChainNftId(value.chainNftId)
    if (nft === null || nft !== chainNftId) return null
    if (!('object' in value)) return null
    return value.object
  }
  if ('result' in value) return parseHopObject(value.result, chainNftId)
  return null
}

export async function fetchLabObject(
  url: string,
  chainNftId: string,
  height: string,
): Promise<unknown | null> {
  const response = await fetch(`${url.replace(/\/$/, '')}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'dle_getObject',
      params: [chainNftId, height],
    }),
    signal: AbortSignal.timeout(HOP1_TIMEOUT_MS),
  })
  if (!response.ok) return null
  const parsed = (await response.json()) as unknown
  if (!isRecord(parsed) || !('result' in parsed)) return null
  return parseHopObject(parsed.result, chainNftId)
}

export async function hop1GetByLocator(
  store: HashStore,
  table: LabRouteTable,
  locator: HashLocatorV1,
  fetchObject: Hop1Fetch = fetchLabObject,
): Promise<{ object?: unknown; hop: DleHop1ReceiptV1; ok: boolean }> {
  const groupId = routeGroupId(table, locator.chainNftId)
  const targets = hopTargets(table, locator.chainNftId)
  let attempted = 0
  let lastTarget: LabHistoryWallet | null = null
  if (groupId === null) {
    return {
      ok: false,
      hop: hopReceipt({
        groupId: '',
        chainNftId: locator.chainNftId,
        targetDomainId: null,
        targetUrl: null,
        usedLocalFallback: false,
        attempted: 0,
      }),
    }
  }
  for (const target of targets) {
    if (target.url === undefined) continue
    attempted += 1
    lastTarget = target
    try {
      const object = await fetchObject(target.url, locator.chainNftId, locator.height)
      if (object !== null && object !== undefined) {
        return {
          ok: true,
          object,
          hop: hopReceipt({
            groupId,
            chainNftId: locator.chainNftId,
            targetDomainId: target.domainId,
            targetUrl: target.url,
            usedLocalFallback: false,
            attempted,
          }),
        }
      }
    } catch {
      /* serial failover inside this nft's providers only */
    }
  }
  if (isOwnGroup(table, locator.chainNftId)) {
    const local = store.getBody(locator.chainNftId, locator.height)
    if (local !== null && local !== undefined) {
      return {
        ok: true,
        object: local,
        hop: hopReceipt({
          groupId,
          chainNftId: locator.chainNftId,
          targetDomainId: table.selfDomainId,
          targetUrl: null,
          usedLocalFallback: true,
          attempted,
        }),
      }
    }
  }
  return {
    ok: false,
    hop: hopReceipt({
      groupId,
      chainNftId: locator.chainNftId,
      targetDomainId: lastTarget?.domainId ?? null,
      targetUrl: lastTarget?.url ?? null,
      usedLocalFallback: false,
      attempted,
    }),
  }
}

export function hopMiss(locator: HashLocatorV1, hop: DleHop1ReceiptV1, hash: string): HashLookupResult {
  const own = hop.usedLocalFallback === false && hop.groupId !== '' && hop.attempted >= 0
  const reason = own
    ? 'Hop-1 did not retrieve the object from historyProviders; plane-wide not-found is unproven.'
    : 'No lab historyProviders for this chainNftId; foreign replica is not RPC truth.'
  return hashLookupUnavailable(reason, hash, hop)
}
