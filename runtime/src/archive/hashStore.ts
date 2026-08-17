import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  canonicalGroupId,
  isHashLocatorV1,
  normalizeChainNftId,
  normalizeHash32,
  normalizeHeightHex,
  sameGroupId,
  type HashLocatorV1,
  type HashObjectKind,
} from '../shared/hashLookup.js'

export const FREEZER_SLOT_SCHEMA = 'DleLabFreezerSlotV1' as const

export interface DleLabFreezerSlotV1 {
  schema: typeof FREEZER_SLOT_SCHEMA
  objects: Partial<Record<HashObjectKind, unknown>>
}

export interface HashStore {
  putLocator(locator: HashLocatorV1): { ok: true } | { ok: false; error: string }
  getLocator(hash: string): HashLocatorV1 | null
  locatorCount(): number
  listLocators(): HashLocatorV1[]
  putBody(
    chainNftId: string,
    height: string,
    body: unknown,
    kind?: HashObjectKind,
  ): { ok: true } | { ok: false; error: string }
  getBody(chainNftId: string, height: string, kind?: HashObjectKind): unknown | null
  beginBatch(): void
  endBatch(): void
  isBatching(): boolean
}

interface HashIndexFile {
  schema: 'DleLabHashIndexV1'
  locators: Record<string, HashLocatorV1>
}

interface HashFreezerFile {
  schema: 'DleLabHashFreezerV1'
  bodies: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function freezerKey(chainNftId: string, height: string): string {
  return `${chainNftId}:${height}`
}

export function isFreezerSlot(value: unknown): value is DleLabFreezerSlotV1 {
  return isRecord(value) && value.schema === FREEZER_SLOT_SCHEMA && isRecord(value.objects)
}

export function projectHashObject(raw: unknown, kind: HashObjectKind): unknown | undefined {
  if (raw === null || raw === undefined) return undefined
  if (isFreezerSlot(raw)) {
    return Object.prototype.hasOwnProperty.call(raw.objects, kind) ? raw.objects[kind] : undefined
  }
  // Legacy unmigrated freezer body is the AC object only. Other kinds must not alias it.
  return kind === 'ac' ? raw : undefined
}

function mergeKindIntoSlot(
  existing: unknown | undefined,
  kind: HashObjectKind,
  body: unknown,
): { ok: true; slot: DleLabFreezerSlotV1 } | { ok: false; error: string } {
  if (existing === undefined) {
    return { ok: true, slot: { schema: FREEZER_SLOT_SCHEMA, objects: { [kind]: body } } }
  }
  if (isFreezerSlot(existing)) {
    if (Object.prototype.hasOwnProperty.call(existing.objects, kind)) {
      if (JSON.stringify(existing.objects[kind]) !== JSON.stringify(body)) {
        return { ok: false, error: 'ERR_FREEZER_APPEND_ONLY' }
      }
      return { ok: true, slot: existing }
    }
    return {
      ok: true,
      slot: { schema: FREEZER_SLOT_SCHEMA, objects: { ...existing.objects, [kind]: body } },
    }
  }
  if (kind === 'ac') {
    if (JSON.stringify(existing) !== JSON.stringify(body)) {
      return { ok: false, error: 'ERR_FREEZER_APPEND_ONLY' }
    }
    return { ok: true, slot: { schema: FREEZER_SLOT_SCHEMA, objects: { ac: body } } }
  }
  return {
    ok: true,
    slot: { schema: FREEZER_SLOT_SCHEMA, objects: { ac: existing, [kind]: body } },
  }
}

function locatorsEqual(left: HashLocatorV1, right: HashLocatorV1): boolean {
  return (
    left.hash === right.hash &&
    left.chainNftId === right.chainNftId &&
    left.kind === right.kind &&
    left.height === right.height &&
    ((left.groupId === undefined && right.groupId === undefined) ||
      (left.groupId !== undefined &&
        right.groupId !== undefined &&
        sameGroupId(left.groupId, right.groupId))) &&
    (left.acRef ?? '') === (right.acRef ?? '')
  )
}

function readJson(path: string): unknown | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    return null
  }
}

function loadIndex(path: string): Record<string, HashLocatorV1> {
  const parsed = readJson(path)
  if (!isRecord(parsed) || parsed.schema !== 'DleLabHashIndexV1' || !isRecord(parsed.locators)) {
    return {}
  }
  const out: Record<string, HashLocatorV1> = {}
  for (const [key, value] of Object.entries(parsed.locators)) {
    if (!isHashLocatorV1(value)) continue
    const hash = normalizeHash32(value.hash) ?? normalizeHash32(key)
    const chainNftId = normalizeChainNftId(value.chainNftId)
    const height = normalizeHeightHex(value.height)
    if (hash === null || chainNftId === null || height === null) continue
    out[hash] = {
      schema: 'HashLocatorV1',
      hash,
      chainNftId,
      kind: value.kind,
      height,
      ...(value.groupId !== undefined ? { groupId: canonicalGroupId(value.groupId) } : {}),
      ...(value.acRef !== undefined ? { acRef: value.acRef } : {}),
    }
  }
  return out
}

function loadFreezer(path: string): Record<string, unknown> {
  const parsed = readJson(path)
  if (!isRecord(parsed) || parsed.schema !== 'DleLabHashFreezerV1' || !isRecord(parsed.bodies)) {
    return {}
  }
  return { ...parsed.bodies }
}

function atomicWriteJson(path: string, value: unknown): void {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, `${JSON.stringify(value)}\n`, 'utf8')
  renameSync(tmp, path)
}

function writeIndex(path: string, locators: Record<string, HashLocatorV1>): void {
  const file: HashIndexFile = { schema: 'DleLabHashIndexV1', locators }
  atomicWriteJson(path, file)
}

function writeFreezer(path: string, bodies: Record<string, unknown>): void {
  const file: HashFreezerFile = { schema: 'DleLabHashFreezerV1', bodies }
  atomicWriteJson(path, file)
}

export function openHashStore(dataDir: string): HashStore {
  mkdirSync(dataDir, { recursive: true })
  const indexPath = join(dataDir, 'hash-index.json')
  const freezerPath = join(dataDir, 'hash-freezer.json')
  const locators = loadIndex(indexPath)
  const bodies = loadFreezer(freezerPath)
  let locatorN = Object.keys(locators).length
  let listed: HashLocatorV1[] | null = null
  let batching = false
  let indexDirty = false
  let freezerDirty = false
  function flushIndex(): void {
    if (!indexDirty) return
    writeIndex(indexPath, locators)
    indexDirty = false
  }
  function flushFreezer(): void {
    if (!freezerDirty) return
    writeFreezer(freezerPath, bodies)
    freezerDirty = false
  }
  function markIndex(): void {
    indexDirty = true
    if (!batching) flushIndex()
  }
  function markFreezer(): void {
    freezerDirty = true
    if (!batching) flushFreezer()
  }
  return {
    putLocator(locator) {
      const hash = normalizeHash32(locator.hash)
      const chainNftId = normalizeChainNftId(locator.chainNftId)
      const height = normalizeHeightHex(locator.height)
      if (hash === null || chainNftId === null || height === null) {
        return { ok: false, error: 'ERR_INVALID_LOCATOR' }
      }
      const next: HashLocatorV1 = {
        schema: 'HashLocatorV1',
        hash,
        chainNftId,
        kind: locator.kind,
        height,
        ...(locator.groupId !== undefined ? { groupId: canonicalGroupId(locator.groupId) } : {}),
        ...(locator.acRef !== undefined ? { acRef: locator.acRef } : {}),
      }
      const existing = locators[hash]
      if (existing !== undefined) {
        if (existing.chainNftId !== next.chainNftId) return { ok: false, error: 'ERR_HASH_NFT_CONFLICT' }
        if (!locatorsEqual(existing, next)) return { ok: false, error: 'ERR_HASH_LOCATOR_CONFLICT' }
        if ((existing.groupId ?? '') !== (next.groupId ?? '')) {
          locators[hash] = next
          if (!batching) listed = null
          markIndex()
        }
        return { ok: true }
      }
      locators[hash] = next
      locatorN += 1
      if (!batching) listed = null
      markIndex()
      return { ok: true }
    },
    getLocator(hash) {
      const normalized = normalizeHash32(hash)
      if (normalized === null) return null
      return locators[normalized] ?? null
    },
    locatorCount() {
      return locatorN
    },
    listLocators() {
      if (listed !== null) return listed
      listed = Object.values(locators).sort((left, right) => left.hash.localeCompare(right.hash))
      return listed
    },
    putBody(chainNftId, height, body, kind) {
      const nft = normalizeChainNftId(chainNftId)
      const heightHex = normalizeHeightHex(height)
      if (nft === null || heightHex === null) return { ok: false, error: 'ERR_INVALID_FREEZER_KEY' }
      const key = freezerKey(nft, heightHex)
      if (kind === undefined) {
        if (Object.prototype.hasOwnProperty.call(bodies, key)) {
          if (JSON.stringify(bodies[key]) !== JSON.stringify(body)) {
            return { ok: false, error: 'ERR_FREEZER_APPEND_ONLY' }
          }
          return { ok: true }
        }
        bodies[key] = body
        markFreezer()
        return { ok: true }
      }
      const merged = mergeKindIntoSlot(bodies[key], kind, body)
      if (!merged.ok) return merged
      if (
        Object.prototype.hasOwnProperty.call(bodies, key) &&
        JSON.stringify(bodies[key]) === JSON.stringify(merged.slot)
      ) {
        return { ok: true }
      }
      bodies[key] = merged.slot
      markFreezer()
      return { ok: true }
    },
    beginBatch() {
      batching = true
    },
    endBatch() {
      batching = false
      listed = null
      flushIndex()
      flushFreezer()
    },
    isBatching() {
      return batching
    },
    getBody(chainNftId, height, kind) {
      const nft = normalizeChainNftId(chainNftId)
      const heightHex = normalizeHeightHex(height)
      if (nft === null || heightHex === null) return null
      const key = freezerKey(nft, heightHex)
      if (!Object.prototype.hasOwnProperty.call(bodies, key)) return null
      const raw = bodies[key]
      if (kind === undefined) return raw
      const projected = projectHashObject(raw, kind)
      return projected === undefined ? null : projected
    },
  }
}
