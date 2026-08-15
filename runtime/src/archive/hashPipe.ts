import {
  DLE_LAB_CHAIN_NFT_ID,
  DLE_LAB_GROUP_ID,
  hashLookupUnavailable,
  normalizeChainNftId,
  normalizeHash32,
  type HashLookupHint,
  type HashLookupResult,
  type HashLocatorV1,
} from '../shared/hashLookup.js'
import {
  archivesOf,
  chainsView,
  defaultLabRouteTable,
  providersView,
  routeView,
  type DleLabChainsV1,
  type DleLabProvidersV1,
  type DleLabRouteV1,
  type LabRouteTable,
} from '../shared/labRoute.js'
import { getObjectLocal, hop1GetByLocator, hopMiss, type DleHashObjectResult, type Hop1Fetch } from './hop1.js'
import type { HashStore } from './hashStore.js'

const MISS_REASON =
  'Hash is not in this lab group index; plane-wide not-found is unproven (single-group lab).'
const CONFLICT_REASON = 'Hash maps to a conflicting chainNftId; lookup failed closed.'

export interface HashLookupAdapter {
  locate(hash: string, hint?: HashLookupHint): HashLookupResult
  get(hash: string, hint?: HashLookupHint): Promise<HashLookupResult>
  getObjectLocal(chainNftId: string, height: string): DleHashObjectResult
  route(chainNftId: string): DleLabRouteV1
  historyProviders(chainNftId: string): DleLabProvidersV1
  archivesOf(chainNftId: string): DleLabProvidersV1
  chainsOf(groupId: string): DleLabChainsV1
}

export interface HashLookupAdapterOptions {
  table?: LabRouteTable
  fetchObject?: Hop1Fetch
}

export function locateHash(store: HashStore, hash: string, hint?: HashLookupHint): HashLookupResult {
  const normalized = normalizeHash32(hash)
  if (normalized === null) return hashLookupUnavailable('Hash must be 0x + 64 hex.')
  const locator = store.getLocator(normalized)
  if (locator === null) return hashLookupUnavailable(MISS_REASON, normalized)
  const hinted = hint?.chainNftId !== undefined ? normalizeChainNftId(hint.chainNftId) : null
  if (hint?.chainNftId !== undefined && (hinted === null || hinted !== locator.chainNftId)) {
    return hashLookupUnavailable(CONFLICT_REASON, normalized)
  }
  if (locator.chainNftId === '') return hashLookupUnavailable('Locator is missing chainNftId.', normalized)
  return { schema: 'DleHashLookupV1', status: 'hit', locator }
}

export async function getByHash(
  store: HashStore,
  table: LabRouteTable,
  hash: string,
  hint?: HashLookupHint,
  fetchObject?: Hop1Fetch,
): Promise<HashLookupResult> {
  const located = locateHash(store, hash, hint)
  if (located.status !== 'hit') return located
  const hopped = await hop1GetByLocator(store, table, located.locator, fetchObject)
  if (!hopped.ok) return hopMiss(located.locator, hopped.hop, located.locator.hash)
  return {
    schema: 'DleHashLookupV1',
    status: 'hit',
    locator: located.locator,
    hop: hopped.hop,
    ...(hopped.object !== undefined ? { object: hopped.object } : {}),
  }
}

export function createHashLookupAdapter(
  store: HashStore,
  options: HashLookupAdapterOptions = {},
): HashLookupAdapter {
  const table = options.table ?? defaultLabRouteTable({ domainId: 'local', role: 'active' })
  return {
    locate: (hash, hint) => locateHash(store, hash, hint),
    get: (hash, hint) => getByHash(store, table, hash, hint, options.fetchObject),
    getObjectLocal: (chainNftId, height) => getObjectLocal(store, chainNftId, height),
    route: (chainNftId) => routeView(table, chainNftId),
    historyProviders: (chainNftId) => providersView(table, chainNftId),
    archivesOf: (chainNftId) => {
      const view = providersView(table, chainNftId)
      return { ...view, providers: archivesOf(table, view.chainNftId) }
    },
    chainsOf: (groupId) => chainsView(table, groupId),
  }
}

export function indexLabHashObject(
  store: HashStore,
  locator: HashLocatorV1,
  body: unknown,
): { ok: true } | { ok: false; error: string } {
  const put = store.putLocator(locator)
  if (!put.ok) return put
  return store.putBody(locator.chainNftId, locator.height, body)
}

export function labAcLocator(hash: string, height: string, acRef: string): HashLocatorV1 {
  return {
    schema: 'HashLocatorV1',
    hash,
    chainNftId: DLE_LAB_CHAIN_NFT_ID,
    kind: 'ac',
    height,
    groupId: DLE_LAB_GROUP_ID,
    acRef,
  }
}
