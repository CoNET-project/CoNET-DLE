import { ZERO32 } from '../shared/bytes.js'
import {
  DLE_LAB_CHAIN_NFT_ID,
  DLE_LAB_GROUP_ID,
  DLE_LAB_M6_MARKER_NFT_ID,
  canonicalGroupId,
  hashLookupNotFound,
  hashLookupPlaneNotFound,
  hashLookupUnavailable,
  labFissionMarkerHash,
  normalizeChainNftId,
  normalizeHash32,
  sameGroupId,
  type HashLookupHint,
  type HashLookupResult,
  type HashLocatorV1,
  type HashObjectKind,
} from '../shared/hashLookup.js'
import {
  archivesOf,
  chainsView,
  defaultLabRouteTable,
  liveGroupIds,
  planeWallets,
  providersView,
  registerLabChainNft,
  routeView,
  type DleLabChainsV1,
  type DleLabProvidersV1,
  type DleLabRouteV1,
  type LabRouteTable,
} from '../shared/labRoute.js'
import {
  hashIndexRootView,
  proveHashIndex,
  type HashIndexProofV1,
  type HashIndexRootViewV1,
} from '../shared/hashIndexTree.js'
import { getObjectLocal, hop1GetByLocator, hopMiss, type DleHashObjectResult, type Hop1Fetch } from './hop1.js'
import { projectHashObject, type HashStore } from './hashStore.js'
import { ERR_INVENTORY_FROZEN, inventoryCatalogFrozen } from './inventoryFreeze.js'

const CONFLICT_REASON = 'Hash maps to a conflicting chainNftId; lookup failed closed.'
const PLANE_LOCATE_TIMEOUT_MS = 2_500

export interface HashLookupAdapter {
  locate(hash: string, hint?: HashLookupHint): HashLookupResult
  locatePlane(hash: string, hint?: HashLookupHint): Promise<HashLookupResult>
  get(hash: string, hint?: HashLookupHint): Promise<HashLookupResult>
  getObjectLocal(chainNftId: string, height: string): DleHashObjectResult
  route(chainNftId: string): DleLabRouteV1
  historyProviders(chainNftId: string): DleLabProvidersV1
  archivesOf(chainNftId: string): DleLabProvidersV1
  chainsOf(groupId: string): DleLabChainsV1
  hashIndexRoot(): HashIndexRootViewV1
  proveHash(hash: string): HashIndexProofV1 | { ok: false; error: string }
}

export type PlaneLocateFetch = (url: string, hash: string) => Promise<HashLookupResult | null>

export interface HashLookupAdapterOptions {
  table?: LabRouteTable
  fetchObject?: Hop1Fetch
  fetchLocate?: PlaneLocateFetch
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parseLocateResult(value: unknown): HashLookupResult | null {
  if (!isRecord(value)) return null
  if ('result' in value) return parseLocateResult(value.result)
  if (value.schema !== 'DleHashLookupV1') return null
  if (value.status === 'hit' && isRecord(value.locator)) return value as unknown as HashLookupResult
  if (value.status === 'notFound' || value.status === 'unavailable') {
    return value as unknown as HashLookupResult
  }
  return null
}

export async function fetchLabLocate(url: string, hash: string): Promise<HashLookupResult | null> {
  const response = await fetch(`${url.replace(/\/$/, '')}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'dle_locateHash',
      params: [hash, { thisGroupOnly: true }],
    }),
    signal: AbortSignal.timeout(PLANE_LOCATE_TIMEOUT_MS),
  })
  if (!response.ok) return null
  return parseLocateResult((await response.json()) as unknown)
}

export function locateHash(store: HashStore, hash: string, hint?: HashLookupHint): HashLookupResult {
  const normalized = normalizeHash32(hash)
  if (normalized === null) return hashLookupUnavailable('Hash must be 0x + 64 hex.')
  const locator = store.getLocator(normalized)
  if (locator === null) return hashLookupNotFound(normalized)
  const hinted = hint?.chainNftId !== undefined ? normalizeChainNftId(hint.chainNftId) : null
  if (hint?.chainNftId !== undefined && (hinted === null || hinted !== locator.chainNftId)) {
    return hashLookupUnavailable(CONFLICT_REASON, normalized)
  }
  if (locator.chainNftId === '') return hashLookupUnavailable('Locator is missing chainNftId.', normalized)
  return { schema: 'DleHashLookupV1', status: 'hit', locator }
}

export async function locatePlane(
  store: HashStore,
  table: LabRouteTable,
  hash: string,
  hint?: HashLookupHint,
  fetchLocate: PlaneLocateFetch = fetchLabLocate,
): Promise<HashLookupResult> {
  const local = locateHash(store, hash, hint)
  if (local.status === 'hit' || local.status === 'unavailable') return local
  if (hint?.thisGroupOnly === true) return local
  const groups = liveGroupIds(table)
  if (groups.length <= 1) return local
  const own = canonicalGroupId(table.ownGroupId)
  const checked = [own]
  for (const groupId of groups) {
    if (sameGroupId(groupId, own)) continue
    const wallets = planeWallets(table, groupId).filter(
      (wallet) => typeof wallet.url === 'string' && wallet.url !== '',
    )
    if (wallets.length === 0) {
      return hashLookupUnavailable(
        `No plane directory wallets for group ${groupId}; plane-wide not-found is unproven.`,
        local.hash,
      )
    }
    let groupNotFound = false
    let sawReplica = false
    for (const wallet of wallets) {
      if (wallet.url === undefined) continue
      try {
        const remote = await fetchLocate(wallet.url, local.hash)
        if (remote === null) continue
        sawReplica = true
        if (remote.status === 'hit') return remote
        if (remote.status === 'notFound') {
          groupNotFound = true
          break
        }
      } catch {
        /* serial failover inside this group only */
      }
    }
    if (!groupNotFound) {
      return hashLookupUnavailable(
        sawReplica
          ? `Foreign group ${groupId} did not complete a trusted this-group notFound.`
          : `Foreign group ${groupId} timed out; plane-wide not-found is unproven.`,
        local.hash,
      )
    }
    checked.push(groupId)
  }
  return hashLookupPlaneNotFound(local.hash, checked)
}

export async function getByHash(
  store: HashStore,
  table: LabRouteTable,
  hash: string,
  hint?: HashLookupHint,
  fetchObject?: Hop1Fetch,
  fetchLocate?: PlaneLocateFetch,
): Promise<HashLookupResult> {
  const located = await locatePlane(store, table, hash, hint, fetchLocate)
  if (located.status !== 'hit') return located
  const hopped = await hop1GetByLocator(store, table, located.locator, fetchObject)
  if (!hopped.ok) return hopMiss(located.locator, hopped.hop, located.locator.hash)
  const projected =
    hopped.object !== undefined ? projectHashObject(hopped.object, located.locator.kind) : undefined
  if (projected === undefined) {
    return hopMiss(located.locator, hopped.hop, located.locator.hash)
  }
  return {
    schema: 'DleHashLookupV1',
    status: 'hit',
    locator: located.locator,
    hop: hopped.hop,
    object: projected,
  }
}

export function createHashLookupAdapter(
  store: HashStore,
  options: HashLookupAdapterOptions = {},
): HashLookupAdapter {
  const table = options.table ?? defaultLabRouteTable({ domainId: 'local', role: 'active' })
  const fetchLocate = options.fetchLocate ?? fetchLabLocate
  return {
    locate: (hash, hint) => locateHash(store, hash, hint),
    locatePlane: (hash, hint) => locatePlane(store, table, hash, hint, fetchLocate),
    get: (hash, hint) => getByHash(store, table, hash, hint, options.fetchObject, fetchLocate),
    getObjectLocal: (chainNftId, height) => getObjectLocal(store, chainNftId, height),
    route: (chainNftId) => routeView(table, chainNftId),
    historyProviders: (chainNftId) => providersView(table, chainNftId),
    archivesOf: (chainNftId) => {
      const view = providersView(table, chainNftId)
      return { ...view, providers: archivesOf(table, view.chainNftId) }
    },
    chainsOf: (groupId) => chainsView(table, groupId),
    hashIndexRoot: () => hashIndexRootView(store.listLocators(), table.ownGroupId),
    proveHash: (hash) => proveHashIndex(store.listLocators(), hash, table.ownGroupId),
  }
}

export function indexLabHashObject(
  store: HashStore,
  locator: HashLocatorV1,
  body: unknown,
): { ok: true } | { ok: false; error: string } {
  if (inventoryCatalogFrozen() && store.getLocator(locator.hash) === null) {
    return { ok: false, error: ERR_INVENTORY_FROZEN }
  }
  const put = store.putLocator(locator)
  if (!put.ok) return put
  return store.putBody(locator.chainNftId, locator.height, body, locator.kind)
}

export function seedLabFissionMarker(
  store: HashStore,
  table: LabRouteTable,
): { ok: true; hash: string } | { ok: false; error: string } {
  const groupId = canonicalGroupId(table.ownGroupId)
  const hash = labFissionMarkerHash(groupId)
  if (!registerLabChainNft(table, DLE_LAB_M6_MARKER_NFT_ID)) {
    return { ok: false, error: 'ERR_ROUTE_REGISTER' }
  }
  const existing = store.getLocator(hash)
  if (existing !== null && existing.chainNftId === DLE_LAB_M6_MARKER_NFT_ID) {
    // Hash is derived from the lab keccak seed, not the user-visible Group ID.
    // Keep-deploy after G2 register-tx cutover must not rewrite the freezer body.
    return { ok: true, hash }
  }
  const put = indexLabHashObject(
    store,
    {
      schema: 'HashLocatorV1',
      hash,
      chainNftId: DLE_LAB_M6_MARKER_NFT_ID,
      kind: 'ac',
      height: '0x1',
      groupId,
      acRef: hash,
    },
    {
      schema: 'DleLabFissionMarkerV1',
      labOnly: true,
      notL1BirthCertificate: true,
      notProductionDepin: true,
      groupId,
      note: 'M6 lab fission marker. Not a 30-day qualification or L1 NFT.',
    },
  )
  if (!put.ok) return put
  return { ok: true, hash }
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

export function labPrevoteLocator(hash: string, height: string, acRef: string): HashLocatorV1 {
  return {
    schema: 'HashLocatorV1',
    hash,
    chainNftId: DLE_LAB_CHAIN_NFT_ID,
    kind: 'prevoteQc',
    height,
    groupId: DLE_LAB_GROUP_ID,
    acRef,
  }
}

/** Per-chain locator. Do not use labAcLocator (NFT 42) for new-chain objects. */
export function labChainObjectLocator(
  kind: HashObjectKind,
  hash: string,
  chainNftId: string,
  height: string,
  acRef: string,
  groupId?: string,
): HashLocatorV1 {
  return {
    schema: 'HashLocatorV1',
    hash,
    chainNftId,
    kind,
    height,
    ...(groupId !== undefined ? { groupId } : {}),
    acRef,
  }
}

export type LabTypedRootKind = 'tipStateRoot' | 'membershipRoot'

export interface DleLabTipStateRootV1 {
  schema: 'DleLabTipStateRootV1'
  kind: 'tipStateRoot'
  tipStateRoot: string
  chainNftId: string
  height: string
  acRef: string
  labOnly: true
  notAcFieldAlias: true
  note: string
}

export interface DleLabMembershipRootV1 {
  schema: 'DleLabMembershipRootV1'
  kind: 'membershipRoot'
  membershipRoot: string
  chainNftId: string
  height: string
  acRef: string
  labOnly: true
  notAcFieldAlias: true
  note: string
}

const TYPED_ROOT_NOTE = 'Lab M7 typed hash object. Not an Archive Certificate field alias.'

export function labTypedRootLocator(
  kind: LabTypedRootKind,
  hash: string,
  chainNftId: string,
  height: string,
  acRef: string,
  groupId?: string,
): HashLocatorV1 {
  return {
    schema: 'HashLocatorV1',
    hash,
    chainNftId,
    kind,
    height,
    ...(groupId !== undefined ? { groupId } : {}),
    acRef,
  }
}

function typedRootObject(
  kind: LabTypedRootKind,
  hash: string,
  chainNftId: string,
  height: string,
  acRef: string,
): DleLabTipStateRootV1 | DleLabMembershipRootV1 {
  if (kind === 'tipStateRoot') {
    return {
      schema: 'DleLabTipStateRootV1',
      kind,
      tipStateRoot: hash,
      chainNftId,
      height,
      acRef,
      labOnly: true,
      notAcFieldAlias: true,
      note: TYPED_ROOT_NOTE,
    }
  }
  return {
    schema: 'DleLabMembershipRootV1',
    kind,
    membershipRoot: hash,
    chainNftId,
    height,
    acRef,
    labOnly: true,
    notAcFieldAlias: true,
    note: TYPED_ROOT_NOTE,
  }
}

export function indexLabTypedRoot(
  store: HashStore,
  kind: LabTypedRootKind,
  hash: string,
  chainNftId: string,
  height: string,
  acRef: string,
  groupId?: string,
): { ok: true; skipped?: string } | { ok: false; error: string } {
  const normalized = normalizeHash32(hash)
  if (normalized === null) return { ok: true, skipped: 'invalid' }
  if (normalized === ZERO32) return { ok: true, skipped: 'zero' }
  const nft = normalizeChainNftId(chainNftId)
  if (nft === null) return { ok: true, skipped: 'invalid' }
  const existing = store.getLocator(normalized)
  if (existing !== null) {
    if (existing.kind === kind && existing.chainNftId === nft) {
      return { ok: true, skipped: 'first-write-wins' }
    }
    return { ok: true, skipped: 'conflict' }
  }
  const locator = labTypedRootLocator(kind, normalized, nft, height, acRef, groupId)
  return indexLabHashObject(store, locator, typedRootObject(kind, normalized, nft, locator.height, acRef))
}

export function indexLabCertificateRoots(
  store: HashStore,
  input: {
    tipStateRoot?: string
    membershipRoot?: string
    chainNftId: string
    height: string
    acRef: string
    groupId?: string
  },
): void {
  if (input.tipStateRoot !== undefined) {
    indexLabTypedRoot(
      store,
      'tipStateRoot',
      input.tipStateRoot,
      input.chainNftId,
      input.height,
      input.acRef,
      input.groupId,
    )
  }
  if (input.membershipRoot !== undefined) {
    indexLabTypedRoot(
      store,
      'membershipRoot',
      input.membershipRoot,
      input.chainNftId,
      input.height,
      input.acRef,
      input.groupId,
    )
  }
}
