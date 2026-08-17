import { concatBytes, keccak256, keccak256Utf8, utf8, ZERO32, type Hex } from '../../shared/bytes.js'
import { hashIndexRootView } from '../../shared/hashIndexTree.js'
import { canonicalGroupId, sameGroupId, type HashLocatorV1 } from '../../shared/hashLookup.js'
import { chainsOf, locatorIsOwnGroup, type LabRouteTable } from '../../shared/labRoute.js'
import { membershipRootOf } from '../bft/quorum.js'
import type { HashStore } from '../hashStore.js'
import type { SyncInventoryV1 } from './types.js'

export function ownGroupLocators(store: HashStore, table: LabRouteTable): HashLocatorV1[] {
  return store.listLocators().filter((locator) => locatorIsOwnGroup(table, locator))
}

export function hostedChainNftIds(store: HashStore, table: LabRouteTable): string[] {
  const ids = new Set<string>(chainsOf(table, table.ownGroupId))
  for (const locator of ownGroupLocators(store, table)) ids.add(locator.chainNftId)
  return [...ids].sort()
}

export function hostedChainSetRootOf(chainNftIds: readonly string[]): Hex {
  return keccak256Utf8(`dle.archive.sync.chains.v1|${[...chainNftIds].sort().join(',')}`)
}

export function lastACRefOf(locators: readonly HashLocatorV1[], chainNftIds: readonly string[]): Hex {
  const best = new Map<string, HashLocatorV1>()
  for (const locator of locators) {
    if (locator.kind !== 'ac') continue
    const prev = best.get(locator.chainNftId)
    if (prev === undefined || BigInt(locator.height) > BigInt(prev.height)) {
      best.set(locator.chainNftId, locator)
    }
  }
  const tips = [...chainNftIds].sort().map((nft) => `${nft}:${best.get(nft)?.hash ?? ZERO32}`)
  return keccak256(concatBytes(utf8('dle.archive.sync.lastAC.v1'), utf8(tips.join('|'))))
}

export function snapshotInventory(input: {
  store: HashStore
  table: LabRouteTable
  domainId: string
  activeDomainIds: readonly string[]
}): SyncInventoryV1 {
  const locators = ownGroupLocators(input.store, input.table)
  const chainNftIds = hostedChainNftIds(input.store, input.table)
  const index = hashIndexRootView(locators, input.table.ownGroupId)
  return {
    schema: 'DleLabSyncInventoryV1',
    labOnly: true,
    lastQuorumOkIsNotSeating: true,
    domainId: input.domainId,
    groupId: canonicalGroupId(input.table.ownGroupId),
    hostedChainSetRoot: hostedChainSetRootOf(chainNftIds),
    lastACRef: lastACRefOf(locators, chainNftIds),
    membershipRoot: membershipRootOf(input.activeDomainIds),
    hashIndexRoot: index.hashIndexRoot as Hex,
    leafCount: index.leafCount,
    chainNftIds,
    locators,
  }
}

export function inventoryRootsMatch(left: SyncInventoryV1, right: SyncInventoryV1): boolean {
  return statusRootsMatch(left, right)
}

export function statusRootsMatch(
  left: {
    groupId?: string
    hostedChainSetRoot?: string
    lastACRef?: string
    membershipRoot?: string
    hashIndexRoot?: string
  },
  right: {
    groupId?: string
    hostedChainSetRoot?: string
    lastACRef?: string
    membershipRoot?: string
    hashIndexRoot?: string
  },
): boolean {
  if (
    left.groupId === undefined ||
    left.groupId === '' ||
    right.groupId === undefined ||
    right.groupId === '' ||
    left.hostedChainSetRoot === undefined ||
    left.lastACRef === undefined ||
    left.membershipRoot === undefined ||
    left.hashIndexRoot === undefined ||
    right.hostedChainSetRoot === undefined ||
    right.lastACRef === undefined ||
    right.membershipRoot === undefined ||
    right.hashIndexRoot === undefined
  ) {
    return false
  }
  return (
    sameGroupId(left.groupId, right.groupId) &&
    left.hostedChainSetRoot === right.hostedChainSetRoot &&
    left.lastACRef === right.lastACRef &&
    left.membershipRoot === right.membershipRoot &&
    left.hashIndexRoot === right.hashIndexRoot
  )
}
