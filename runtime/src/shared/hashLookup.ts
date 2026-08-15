/** Hash-only locate types. Copied by explorer — do not import archive-a/b. */

export const DLE_LAB_CHAIN_NFT_ID = '42'
export const DLE_LAB_GROUP_ID = 'dle.lab.group.v1'

export const HASH32_RE = /^0x[0-9a-fA-F]{64}$/

export type HashObjectKind = 'ac' | 'block' | 'tx' | 'daRootProof'

export interface HashLocatorV1 {
  schema: 'HashLocatorV1'
  hash: string
  chainNftId: string
  kind: HashObjectKind
  height: string
  groupId?: string
  acRef?: string
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

export type HashLookupResult = HashLookupHit | HashLookupUnavailable

export interface HashLookupHint {
  chainNftId?: string
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

export function isHashLocatorV1(value: unknown): value is HashLocatorV1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  if (row.schema !== 'HashLocatorV1') return false
  if (normalizeHash32(row.hash) === null) return false
  if (normalizeChainNftId(row.chainNftId) === null) return false
  if (row.kind !== 'ac' && row.kind !== 'block' && row.kind !== 'tx' && row.kind !== 'daRootProof') {
    return false
  }
  return normalizeHeightHex(row.height) !== null
}
