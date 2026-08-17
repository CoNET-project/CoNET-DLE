import type { HashLocatorV1 } from '../../shared/hashLookup.js'
import { fromHex, type Hex } from '../../shared/bytes.js'
import { labCgOpeningView, uniqueHostedChainNftIds } from './challenge.js'
import { isForbiddenElRpcAsCl } from './clBeacon.js'
import { hostedChainSetRootOf } from './inventory.js'

/** Whitepaper §5.2.0f: C_G also includes these group objects. */
export const PRODUCTION_CG_REQUIRED_OBJECTS = ['lastAC', 'membershipRoot', 'hashIndexRoot'] as const

export function isForbiddenElRpcAsProductionCg(urlOrHost: string): boolean {
  return isForbiddenElRpcAsCl(urlOrHost)
}

export type ProductionCgUnavailableReason =
  | 'no_l1_archive_group_id_view'
  | 'forbidden_el_rpc_as_production_cg'
  | 'lab_hosted_set_is_not_production_cg'
  | 'invalid_injected_production_cg'

export type ProductionCgSource = 'injected-l1-archiveGroupId'

export interface ProductionCgObjectsV1 {
  lastAC: Hex
  membershipRoot: Hex
  hashIndexRoot: Hex
}

export type ProductionCgProbeResult =
  | {
      available: false
      reason: ProductionCgUnavailableReason
      labHostedSetNotProductionCg: true
      notProductionCg: true
      publicrpcNotProductionCg: true
      notLiveL1Scan: true
    }
  | {
      available: true
      source: ProductionCgSource
      l1GroupStorageKey: string
      notUserVisibleGroupId: true
      chainNftIds: string[]
      objects: ProductionCgObjectsV1
      hostedSetSize: number
      hostedChainSetRoot: Hex
      requiredObjects: typeof PRODUCTION_CG_REQUIRED_OBJECTS
      notLabHostedSet: true
      labHostedSetNotProductionCg: true
      notProductionCg: true
      notLiveL1Scan: true
      publicrpcNotProductionCg: true
    }

function unavailable(reason: ProductionCgUnavailableReason): ProductionCgProbeResult {
  return {
    available: false,
    reason,
    labHostedSetNotProductionCg: true,
    notProductionCg: true,
    publicrpcNotProductionCg: true,
    notLiveL1Scan: true,
  }
}

function sameSortedIds(left: readonly string[], right: readonly string[]): boolean {
  const a = uniqueHostedChainNftIds(left)
  const b = uniqueHostedChainNftIds(right)
  return a.length === b.length && a.every((id, index) => id === b[index])
}

function normalizeRoot(raw: unknown): Hex | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed === '' || isForbiddenElRpcAsProductionCg(trimmed)) return null
  try {
    fromHex(trimmed, 32)
    const hex = trimmed.startsWith('0x') || trimmed.startsWith('0X') ? trimmed.slice(2) : trimmed
    return `0x${hex.toLowerCase()}` as Hex
  } catch {
    return null
  }
}

function looksLikeForbiddenElRpc(raw: string): boolean {
  const trimmed = raw.trim()
  return trimmed.startsWith('http://') || trimmed.startsWith('https://')
    ? isForbiddenElRpcAsProductionCg(trimmed)
    : isForbiddenElRpcAsProductionCg(trimmed)
}

function parseInjectedRecord(value: unknown): {
  groupStorageKey: string
  chainNftIds: string[]
  objects: ProductionCgObjectsV1
} | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const rec = value as Record<string, unknown>
  const keyRaw = rec.groupStorageKey ?? rec.l1GroupStorageKey
  if (typeof keyRaw !== 'string' || keyRaw.trim() === '') return null
  if (isForbiddenElRpcAsProductionCg(keyRaw)) return null
  const idsRaw = rec.chainNftIds
  if (!Array.isArray(idsRaw) || idsRaw.some((id) => typeof id !== 'string')) return null
  const lastAC = normalizeRoot(rec.lastAC)
  const membershipRoot = normalizeRoot(rec.membershipRoot)
  const hashIndexRoot = normalizeRoot(rec.hashIndexRoot)
  if (lastAC === null || membershipRoot === null || hashIndexRoot === null) return null
  return {
    groupStorageKey: keyRaw.trim(),
    chainNftIds: uniqueHostedChainNftIds(idsRaw),
    objects: { lastAC, membershipRoot, hashIndexRoot },
  }
}

function parseInjectedJson(raw: string): ReturnType<typeof parseInjectedRecord> | 'forbidden' | 'invalid' {
  if (looksLikeForbiddenElRpc(raw)) return 'forbidden'
  try {
    const parsed = parseInjectedRecord(JSON.parse(raw) as unknown)
    return parsed ?? 'invalid'
  } catch {
    return 'invalid'
  }
}

/**
 * Read-only probe for production \(C_G\).
 * Does **not** HTTP-scan `publicrpc` / `rpc1` / `rpc.conet.network`.
 * Does **not** treat freezer `chainNftIds` as production \(C_G\).
 * Default: unavailable (honest wait). Optional injected L1 `archiveGroupId`
 * small-set is still `notLiveL1Scan` / `notProductionCg`.
 */
export function probeProductionCg(input?: {
  injected?: {
    groupStorageKey?: string
    l1GroupStorageKey?: string
    chainNftIds?: readonly string[]
    lastAC?: string
    membershipRoot?: string
    hashIndexRoot?: string
  }
  injectedJson?: string
  l1ViewUrl?: string
  env?: NodeJS.ProcessEnv
  labHostedChainNftIds?: readonly string[]
}): ProductionCgProbeResult {
  if (input?.l1ViewUrl !== undefined && isForbiddenElRpcAsProductionCg(input.l1ViewUrl)) {
    return unavailable('forbidden_el_rpc_as_production_cg')
  }
  const env = input?.env ?? process.env
  const jsonRaw = input?.injectedJson ?? env.DLE_ARCHIVE_PRODUCTION_CG_JSON
  if (jsonRaw !== undefined && looksLikeForbiddenElRpc(jsonRaw)) {
    return unavailable('forbidden_el_rpc_as_production_cg')
  }

  let parsed = input?.injected !== undefined ? parseInjectedRecord(input.injected) : null
  if (parsed === null && jsonRaw !== undefined) {
    const fromJson = parseInjectedJson(jsonRaw)
    if (fromJson === 'forbidden') return unavailable('forbidden_el_rpc_as_production_cg')
    if (fromJson === 'invalid') return unavailable('invalid_injected_production_cg')
    parsed = fromJson
  }
  if (parsed === null) return unavailable('no_l1_archive_group_id_view')

  const lab = input?.labHostedChainNftIds ?? []
  if (lab.length > 0 && sameSortedIds(parsed.chainNftIds, lab)) {
    return unavailable('lab_hosted_set_is_not_production_cg')
  }

  return {
    available: true,
    source: 'injected-l1-archiveGroupId',
    l1GroupStorageKey: parsed.groupStorageKey,
    notUserVisibleGroupId: true,
    chainNftIds: parsed.chainNftIds,
    objects: parsed.objects,
    hostedSetSize: parsed.chainNftIds.length,
    hostedChainSetRoot: hostedChainSetRootOf(parsed.chainNftIds),
    requiredObjects: PRODUCTION_CG_REQUIRED_OBJECTS,
    notLabHostedSet: true,
    labHostedSetNotProductionCg: true,
    notProductionCg: true,
    notLiveL1Scan: true,
    publicrpcNotProductionCg: true,
  }
}

export function productionCgStatusFields(probe: ProductionCgProbeResult): {
  labHostedSetNotProductionCg: true
  publicrpcNotProductionCg: true
  productionCgAvailable: boolean
  productionCgSource?: ProductionCgSource
} {
  return {
    labHostedSetNotProductionCg: true,
    publicrpcNotProductionCg: true,
    productionCgAvailable: probe.available,
    ...(probe.available ? { productionCgSource: probe.source } : {}),
  }
}

/** Slim health view — no samples (P8c). */
export function productionCgHealthView(probe: ProductionCgProbeResult): Record<string, unknown> {
  if (!probe.available) {
    return {
      schema: 'DleProductionCgProbeV1',
      available: false,
      reason: probe.reason,
      labHostedSetNotProductionCg: true,
      notProductionCg: true,
      publicrpcNotProductionCg: true,
      notLiveL1Scan: true,
    }
  }
  return {
    schema: 'DleProductionCgProbeV1',
    available: true,
    source: probe.source,
    l1GroupStorageKey: probe.l1GroupStorageKey,
    notUserVisibleGroupId: true,
    hostedSetSize: probe.hostedSetSize,
    hostedChainSetRoot: probe.hostedChainSetRoot,
    requiredObjects: probe.requiredObjects,
    notLabHostedSet: true,
    labHostedSetNotProductionCg: true,
    notProductionCg: true,
    notLiveL1Scan: true,
    publicrpcNotProductionCg: true,
  }
}

/**
 * Optional small-set smoke on injected L1 \(C_G\).
 * Never substitutes the lab freezer opening. `health()` must not call this.
 */
export function productionCgOpeningSmoke(input: {
  probe: ProductionCgProbeResult
  seed: Hex
  locators?: readonly HashLocatorV1[]
}): Record<string, unknown> {
  const base = productionCgHealthView(input.probe)
  if (!input.probe.available) return { ...base, schema: 'DleProductionCgOpeningSmokeV1', openingRunnable: false }
  const probe = input.probe
  const locators = (input.locators ?? []).filter((locator) => probe.chainNftIds.includes(locator.chainNftId))
  const openingRunnable = locators.length > 0 || probe.chainNftIds.length === 0
  if (!openingRunnable) {
    return {
      ...base,
      schema: 'DleProductionCgOpeningSmokeV1',
      openingRunnable: false,
      hostedChainCount: probe.hostedSetSize,
      openedChainCount: 0,
      openedAllHostedChains: false,
    }
  }
  const view = labCgOpeningView({ chainNftIds: probe.chainNftIds, locators }, input.seed)
  return {
    ...base,
    schema: 'DleProductionCgOpeningSmokeV1',
    openingRunnable: true,
    hostedChainCount: view.hostedChainCount,
    openedChainCount: view.openedChainCount,
    openedAllHostedChains: view.openedAllHostedChains,
    sampleCount: view.sampleCount,
  }
}
