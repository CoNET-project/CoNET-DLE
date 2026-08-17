/** Hash-only locate types. Copied by explorer — do not import archive-a/b. */

import { keccak256Utf8 } from './bytes.js'

export const DLE_LAB_CHAIN_NFT_ID = '42'

/**
 * L1 tx that registered bootstrap group storage key 1 on GlobalArchiveRoutingRegistry.
 * User-visible Group ID is this hash — not the uint 1 and not the EIP-155 chain id.
 */
export const DLE_BOOTSTRAP_GROUP_REGISTER_TX_HASH =
  '0x3076a806de71ab75b2d48063cc3f1e7d8f8e3d54cb1d45a7469c75c9276f2ad0'

export const DLE_LAB_GROUP_ID = DLE_BOOTSTRAP_GROUP_REGISTER_TX_HASH
export const DLE_LAB_GROUP_ID_LEGACY = 'dle.lab.group.v1'

/**
 * Laboratory keccak used before G2’s L1 register. Alias only after the host
 * `ownGroupId` cutover; do not open the keccak as Blockscout `/tx/…`.
 */
export const DLE_LAB_M6_GROUP_ID_LEGACY =
  '0x7b3b8eb959dcc0f75a309fcc16e7f840efe76dc27f2ef0d4eca8b8617f9b1a07'

/** User-visible G2 Group ID = L1 `registerLiveGroup` tx. Not uint 2. */
export const DLE_G2_GROUP_REGISTER_TX_HASH =
  '0xf781f2c23fe3b3dac09dc3e1929016b0af200ee93978e916df64d750876d5153'

export const DLE_LAB_M6_GROUP_ID = DLE_G2_GROUP_REGISTER_TX_HASH

/** Lab-only fission marker chain. Not NFT 42 and not a newchain class id. */
export const DLE_LAB_M6_MARKER_NFT_ID = '6000000006'

/** keccak256(utf8("dle.lab.fission.marker.v1|" + laboratory keccak)). Seeded before L1 register. */
export const DLE_LAB_M6_MARKER_HASH =
  '0x7ca21e5aa612caa12bbd137aa374d30a113d42c1f60ea411fdb6998a63e2345c'

export function labFissionMarkerHash(groupId: string): string {
  const canonical = canonicalGroupId(groupId)
  const seededId =
    canonical.toLowerCase() === DLE_G2_GROUP_REGISTER_TX_HASH.toLowerCase()
      ? DLE_LAB_M6_GROUP_ID_LEGACY
      : canonical
  return keccak256Utf8(`dle.lab.fission.marker.v1|${seededId}`)
}

export const HASH32_RE = /^0x[0-9a-fA-F]{64}$/

export const HASH_OBJECT_KINDS = [
  'ac',
  'prevoteQc',
  'tipStateRoot',
  'membershipRoot',
  'block',
  'tx',
  'daRootProof',
] as const

export type HashObjectKind = (typeof HASH_OBJECT_KINDS)[number]

/** Optional locator debug names. Do not catalogue tip/membership hashes via boundField. */
export const HASH_BOUND_FIELDS = [
  'valueHash',
  'tipStateRoot',
  'prevoteQCRef',
  'membershipRoot',
  'daRoot',
  'bodyCommitment',
  'blockHash',
  'txHash',
] as const

export type HashBoundField = (typeof HASH_BOUND_FIELDS)[number]

export interface HashLocatorV1 {
  schema: 'HashLocatorV1'
  hash: string
  chainNftId: string
  kind: HashObjectKind
  height: string
  groupId?: string
  acRef?: string
  boundField?: HashBoundField
}

export interface DleHop1ReceiptV1 {
  schema: 'DleHop1ReceiptV1'
  labOnly: true
  notProductionDepin: true
  transport: 'lab-http-27101'
  groupId: string
  chainNftId: string
  targetDomainId: string | null
  targetUrl: string | null
  usedLocalFallback: boolean
  attempted: number
}

export interface HashLookupHit {
  schema: 'DleHashLookupV1'
  status: 'hit'
  locator: HashLocatorV1
  object?: unknown
  hop?: DleHop1ReceiptV1
}

export interface HashLookupUnavailable {
  schema: 'DleHashLookupV1'
  status: 'unavailable'
  planeWideNull: false
  reason: string
  hash?: string
  hop?: DleHop1ReceiptV1
}

export interface HashLookupNotFound {
  schema: 'DleHashLookupV1'
  status: 'notFound'
  planeWideNull: boolean
  scope: 'thisGroup' | 'allLiveGroups'
  reason: string
  hash: string
  groupsChecked?: string[]
}

export type HashLookupResult = HashLookupHit | HashLookupUnavailable | HashLookupNotFound

export interface HashLookupHint {
  chainNftId?: string
  thisGroupOnly?: boolean
}

/** Map legacy lab strings / L1 uint keys onto the register-tx Group IDs. */
export function canonicalGroupId(raw: string): string {
  const trimmed = raw.trim()
  const lower = trimmed.toLowerCase()
  if (lower === DLE_LAB_GROUP_ID_LEGACY || lower === '1' || lower === '0x1') {
    return DLE_LAB_GROUP_ID
  }
  if (lower === DLE_LAB_M6_GROUP_ID_LEGACY || lower === '2' || lower === '0x2') {
    return DLE_G2_GROUP_REGISTER_TX_HASH
  }
  return normalizeHash32(trimmed) ?? trimmed
}

export function sameGroupId(a: string, b: string): boolean {
  return canonicalGroupId(a) === canonicalGroupId(b)
}

export function normalizeHash32(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!HASH32_RE.test(trimmed)) return null
  return trimmed.toLowerCase()
}

export function normalizeChainNftId(raw: unknown): string | null {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) return String(raw)
  if (typeof raw !== 'string' || raw === '') return null
  if (/^0x[0-9a-fA-F]+$/.test(raw)) {
    try {
      return BigInt(raw).toString(10)
    } catch {
      return null
    }
  }
  if (/^\d+$/.test(raw)) {
    try {
      return BigInt(raw).toString(10)
    } catch {
      return null
    }
  }
  return null
}

export function normalizeHeightHex(raw: unknown): string | null {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) return `0x${raw.toString(16)}`
  if (typeof raw !== 'string' || raw === '') return null
  if (/^0x[0-9a-fA-F]+$/.test(raw)) {
    try {
      return `0x${BigInt(raw).toString(16)}`
    } catch {
      return null
    }
  }
  if (/^\d+$/.test(raw)) {
    try {
      return `0x${BigInt(raw).toString(16)}`
    } catch {
      return null
    }
  }
  return null
}

export function hashLookupUnavailable(
  reason: string,
  hash?: string,
  hop?: DleHop1ReceiptV1,
): HashLookupUnavailable {
  return {
    schema: 'DleHashLookupV1',
    status: 'unavailable',
    planeWideNull: false,
    reason,
    ...(hash !== undefined ? { hash } : {}),
    ...(hop !== undefined ? { hop } : {}),
  }
}

export function hashLookupNotFound(hash: string, reason?: string): HashLookupNotFound {
  return {
    schema: 'DleHashLookupV1',
    status: 'notFound',
    planeWideNull: false,
    scope: 'thisGroup',
    reason: reason ?? 'Hash is not present in this DLE group’s committed corpus.',
    hash,
  }
}

export function hashLookupPlaneNotFound(hash: string, groupsChecked: string[]): HashLookupNotFound {
  return {
    schema: 'DleHashLookupV1',
    status: 'notFound',
    planeWideNull: true,
    scope: 'allLiveGroups',
    reason: 'Every live DLE group returned a trusted this-group notFound.',
    hash,
    groupsChecked,
  }
}

export function isHashBoundField(value: unknown): value is HashBoundField {
  return typeof value === 'string' && (HASH_BOUND_FIELDS as readonly string[]).includes(value)
}

export function isHashObjectKind(value: unknown): value is HashObjectKind {
  return typeof value === 'string' && (HASH_OBJECT_KINDS as readonly string[]).includes(value)
}

export function isHashLocatorV1(value: unknown): value is HashLocatorV1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  if (row.schema !== 'HashLocatorV1') return false
  if (normalizeHash32(row.hash) === null) return false
  if (normalizeChainNftId(row.chainNftId) === null) return false
  if (!isHashObjectKind(row.kind)) return false
  if (row.boundField !== undefined && !isHashBoundField(row.boundField)) return false
  return normalizeHeightHex(row.height) !== null
}
