import { concatBytes, fromHex, keccak256, keccak256Bytes, toHex, uintBE, utf8 } from './bytes.js'
import { DLE_LAB_GROUP_ID, normalizeHash32, type HashLocatorV1, type HashObjectKind } from './hashLookup.js'

export const HASH_INDEX_LEAF_DOMAIN = 'dle.hashIndex.leaf.v1'
export const HASH_INDEX_NODE_DOMAIN = 'dle.hashIndex.node.v1'
export const HASH_INDEX_EMPTY_DOMAIN = 'dle.hashIndex.empty.v1'

export interface HashIndexLeafV1 {
  schema: 'HashIndexLeafV1'
  hash: string
  kind: HashObjectKind
  chainNftId: string
  height: string
  acRef?: string
  migratedTo?: string
}

export interface HashIndexMerkleStepV1 {
  sibling: string
  position: 'left' | 'right'
}

export interface HashIndexOpenV1 {
  index: number
  leaf: HashIndexLeafV1
  leafHash: string
  path: HashIndexMerkleStepV1[]
}

export interface HashIndexRootViewV1 {
  schema: 'DleHashIndexRootV1'
  labOnly: true
  notProductionDepin: true
  notHotGet: true
  committedInAc: false
  groupId: string
  hashIndexRoot: string
  leafCount: number
}

export interface HashIndexInclusionProofV1 {
  schema: 'HashIndexProofV1'
  kind: 'inclusion'
  labOnly: true
  notProductionDepin: true
  notHotGet: true
  planeWideNull: false
  committedInAc: false
  groupId: string
  hashIndexRoot: string
  leafCount: number
  hash: string
  open: HashIndexOpenV1
}

export interface HashIndexNonInclusionProofV1 {
  schema: 'HashIndexProofV1'
  kind: 'non-inclusion'
  labOnly: true
  notProductionDepin: true
  notHotGet: true
  planeWideNull: false
  committedInAc: false
  groupId: string
  hashIndexRoot: string
  leafCount: number
  hash: string
  empty: boolean
  left?: HashIndexOpenV1
  right?: HashIndexOpenV1
  reason: string
}

export type HashIndexProofV1 = HashIndexInclusionProofV1 | HashIndexNonInclusionProofV1

function lengthPrefixed(data: Uint8Array): Uint8Array {
  return concatBytes(uintBE(data.length, 4), data)
}

function compareHash32(left: string, right: string): number {
  return left.localeCompare(right)
}

export function emptyHashIndexRoot(): string {
  return keccak256(utf8(HASH_INDEX_EMPTY_DOMAIN))
}

export function leafFromLocator(locator: HashLocatorV1): HashIndexLeafV1 {
  return {
    schema: 'HashIndexLeafV1',
    hash: locator.hash,
    kind: locator.kind,
    chainNftId: locator.chainNftId,
    height: locator.height,
    ...(locator.acRef !== undefined && locator.acRef !== '' ? { acRef: locator.acRef } : {}),
  }
}

export function hashIndexLeafHash(leaf: HashIndexLeafV1): string {
  return keccak256(
    concatBytes(
      utf8(HASH_INDEX_LEAF_DOMAIN),
      fromHex(leaf.hash, 32),
      lengthPrefixed(utf8(leaf.kind)),
      lengthPrefixed(utf8(leaf.chainNftId)),
      uintBE(BigInt(leaf.height), 32),
      lengthPrefixed(utf8(leaf.acRef ?? '')),
      lengthPrefixed(utf8(leaf.migratedTo ?? '')),
    ),
  )
}

function hashIndexNode(left: Uint8Array, right: Uint8Array): Uint8Array {
  return keccak256Bytes(concatBytes(utf8(HASH_INDEX_NODE_DOMAIN), left, right))
}

function sortedLeaves(locators: readonly HashLocatorV1[]): HashIndexLeafV1[] {
  return [...locators]
    .map(leafFromLocator)
    .sort((left, right) => compareHash32(left.hash, right.hash))
}

function buildLayers(leafHashes: readonly Uint8Array[]): Uint8Array[][] {
  if (leafHashes.length === 0) return []
  const layers: Uint8Array[][] = [leafHashes.map((row) => row)]
  let current = layers[0]!
  while (current.length > 1) {
    const next: Uint8Array[] = []
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i]!
      const right = current[i + 1]
      next.push(right === undefined ? left : hashIndexNode(left, right))
    }
    layers.push(next)
    current = next
  }
  return layers
}

function proofPath(layers: readonly Uint8Array[][], index: number): HashIndexMerkleStepV1[] {
  const path: HashIndexMerkleStepV1[] = []
  let i = index
  for (let level = 0; level < layers.length - 1; level += 1) {
    const layer = layers[level]!
    const siblingIndex = i % 2 === 0 ? i + 1 : i - 1
    if (siblingIndex < layer.length) {
      path.push({
        sibling: toHex(layer[siblingIndex]!),
        position: siblingIndex < i ? 'left' : 'right',
      })
    }
    i = Math.floor(i / 2)
  }
  return path
}

export function foldHashIndexPath(leafHash: string, path: readonly HashIndexMerkleStepV1[]): string {
  let current = fromHex(leafHash, 32)
  for (const step of path) {
    const sibling = fromHex(step.sibling, 32)
    current = step.position === 'left' ? hashIndexNode(sibling, current) : hashIndexNode(current, sibling)
  }
  return toHex(current)
}

function rootFromLeaves(leaves: readonly HashIndexLeafV1[]): string {
  if (leaves.length === 0) return emptyHashIndexRoot()
  const layers = buildLayers(leaves.map((leaf) => fromHex(hashIndexLeafHash(leaf), 32)))
  return toHex(layers[layers.length - 1]![0]!)
}

export function hashIndexRootOf(locators: readonly HashLocatorV1[]): string {
  return rootFromLeaves(sortedLeaves(locators))
}

export function hashIndexRootView(
  locators: readonly HashLocatorV1[],
  groupId = DLE_LAB_GROUP_ID,
): HashIndexRootViewV1 {
  return {
    schema: 'DleHashIndexRootV1',
    labOnly: true,
    notProductionDepin: true,
    notHotGet: true,
    committedInAc: false,
    groupId,
    hashIndexRoot: hashIndexRootOf(locators),
    leafCount: locators.length,
  }
}

function openAt(
  leaves: readonly HashIndexLeafV1[],
  layers: readonly Uint8Array[][],
  index: number,
): HashIndexOpenV1 {
  const leaf = leaves[index]!
  return {
    index,
    leaf,
    leafHash: hashIndexLeafHash(leaf),
    path: proofPath(layers, index),
  }
}

export function proveHashIndex(
  locators: readonly HashLocatorV1[],
  hash: string,
  groupId = DLE_LAB_GROUP_ID,
): HashIndexProofV1 | { ok: false; error: string } {
  const normalized = normalizeHash32(hash)
  if (normalized === null) return { ok: false, error: 'ERR_INVALID_HASH' }
  const leaves = sortedLeaves(locators)
  const root = rootFromLeaves(leaves)
  const common = {
    schema: 'HashIndexProofV1' as const,
    labOnly: true as const,
    notProductionDepin: true as const,
    notHotGet: true as const,
    planeWideNull: false as const,
    committedInAc: false as const,
    groupId,
    hashIndexRoot: root,
    leafCount: leaves.length,
    hash: normalized,
  }
  if (leaves.length === 0) {
    return {
      ...common,
      kind: 'non-inclusion',
      empty: true,
      reason: 'This group hashIndexTree is empty; plane-wide not-found is unproven.',
    }
  }
  const layers = buildLayers(leaves.map((leaf) => fromHex(hashIndexLeafHash(leaf), 32)))
  const found = leaves.findIndex((leaf) => leaf.hash === normalized)
  if (found >= 0) {
    return {
      ...common,
      kind: 'inclusion',
      open: openAt(leaves, layers, found),
    }
  }
  if (compareHash32(normalized, leaves[0]!.hash) < 0) {
    return {
      ...common,
      kind: 'non-inclusion',
      empty: false,
      right: openAt(leaves, layers, 0),
      reason: 'Hash sorts before the first leaf in this group tree; plane-wide not-found is unproven.',
    }
  }
  if (compareHash32(normalized, leaves[leaves.length - 1]!.hash) > 0) {
    return {
      ...common,
      kind: 'non-inclusion',
      empty: false,
      left: openAt(leaves, layers, leaves.length - 1),
      reason: 'Hash sorts after the last leaf in this group tree; plane-wide not-found is unproven.',
    }
  }
  let right = 1
  while (right < leaves.length && compareHash32(leaves[right]!.hash, normalized) < 0) right += 1
  return {
    ...common,
    kind: 'non-inclusion',
    empty: false,
    left: openAt(leaves, layers, right - 1),
    right: openAt(leaves, layers, right),
    reason: 'Hash sits between adjacent leaves in this group tree; plane-wide not-found is unproven.',
  }
}

export function verifyHashIndexOpen(root: string, open: HashIndexOpenV1): boolean {
  if (hashIndexLeafHash(open.leaf) !== open.leafHash) return false
  return foldHashIndexPath(open.leafHash, open.path) === root
}

export function verifyHashIndexProof(proof: HashIndexProofV1): boolean {
  if (proof.notHotGet !== true || proof.planeWideNull !== false) return false
  if (proof.kind === 'inclusion') {
    return proof.open.leaf.hash === proof.hash && verifyHashIndexOpen(proof.hashIndexRoot, proof.open)
  }
  if (proof.empty) {
    return proof.leafCount === 0 && proof.hashIndexRoot === emptyHashIndexRoot()
  }
  if (proof.left !== undefined && !verifyHashIndexOpen(proof.hashIndexRoot, proof.left)) return false
  if (proof.right !== undefined && !verifyHashIndexOpen(proof.hashIndexRoot, proof.right)) return false
  if (proof.left !== undefined && compareHash32(proof.left.leaf.hash, proof.hash) >= 0) return false
  if (proof.right !== undefined && compareHash32(proof.hash, proof.right.leaf.hash) >= 0) return false
  if (proof.left !== undefined && proof.right !== undefined) {
    return proof.right.index === proof.left.index + 1
  }
  if (proof.left !== undefined) return proof.left.index === proof.leafCount - 1
  if (proof.right !== undefined) return proof.right.index === 0
  return false
}
