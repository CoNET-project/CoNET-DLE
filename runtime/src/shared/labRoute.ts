/** Laboratory route table. Not L1 Global Archive Routing Registry. Not production DePIN. */

import {
  DLE_LAB_CHAIN_NFT_ID,
  DLE_LAB_GROUP_ID,
  canonicalGroupId,
  normalizeChainNftId,
  sameGroupId,
} from './hashLookup.js'

export interface LabHistoryWallet {
  domainId: string
  role: string
  url?: string
  labOnly: true
}

export interface LabRouteGroup {
  groupId: string
  wallets: LabHistoryWallet[]
}

export interface LabRouteTable {
  schema: 'DleLabRouteTableV1'
  labOnly: true
  notProductionDepin: true
  l1RouteUnproven: true
  ownGroupId: string
  selfDomainId: string
  groups: Record<string, LabRouteGroup>
}

export interface LabPeerInput {
  domainId: string
  host: string
  port: number
  role: string
}

export interface DleLabRouteV1 {
  schema: 'DleLabRouteV1'
  labOnly: true
  notProductionDepin: true
  l1RouteUnproven: true
  chainNftId: string
  groupId: string | null
  ownGroup: boolean
  reason?: string
}

export interface DleLabProvidersV1 {
  schema: 'DleLabProvidersV1'
  labOnly: true
  notProductionDepin: true
  l1RouteUnproven: true
  chainNftId: string
  groupId: string | null
  providers: LabHistoryWallet[]
}

export interface DleLabChainsV1 {
  schema: 'DleLabChainsV1'
  labOnly: true
  notProductionDepin: true
  l1RouteUnproven: true
  groupId: string
  chainNftIds: string[]
}

export function defaultLabRouteTable(self: { domainId: string; role: string; url?: string }): LabRouteTable {
  return labRouteTableFromPeers(self, [])
}

export function labRouteTableFromPeers(
  self: { domainId: string; role: string; url?: string },
  peers: LabPeerInput[],
): LabRouteTable {
  const wallets: LabHistoryWallet[] = [
    {
      domainId: self.domainId,
      role: self.role,
      labOnly: true,
      ...(self.url !== undefined && self.url !== '' ? { url: self.url } : {}),
    },
    ...peers.map((peer) => ({
      domainId: peer.domainId,
      role: peer.role,
      url: `http://${peer.host}:${peer.port}`,
      labOnly: true as const,
    })),
  ]
  return {
    schema: 'DleLabRouteTableV1',
    labOnly: true,
    notProductionDepin: true,
    l1RouteUnproven: true,
    ownGroupId: DLE_LAB_GROUP_ID,
    selfDomainId: self.domainId,
    groups: {
      [DLE_LAB_CHAIN_NFT_ID]: {
        groupId: DLE_LAB_GROUP_ID,
        wallets,
      },
    },
  }
}

export function routeGroupId(table: LabRouteTable, chainNftId: string): string | null {
  const nft = normalizeChainNftId(chainNftId)
  if (nft === null) return null
  return table.groups[nft]?.groupId ?? null
}

export function isOwnGroup(table: LabRouteTable, chainNftId: string): boolean {
  const groupId = routeGroupId(table, chainNftId)
  return groupId !== null && sameGroupId(groupId, table.ownGroupId)
}

export function historyProviders(table: LabRouteTable, chainNftId: string): LabHistoryWallet[] {
  const nft = normalizeChainNftId(chainNftId)
  if (nft === null) return []
  return table.groups[nft]?.wallets ?? []
}

export function archivesOf(table: LabRouteTable, chainNftId: string): LabHistoryWallet[] {
  return historyProviders(table, chainNftId)
}

export function registerLabChainNft(table: LabRouteTable, chainNftId: string): boolean {
  const nft = normalizeChainNftId(chainNftId)
  if (nft === null) return false
  if (table.groups[nft] !== undefined) return true
  const template = table.groups[DLE_LAB_CHAIN_NFT_ID]
  if (template === undefined) return false
  table.groups[nft] = {
    groupId: table.ownGroupId,
    wallets: template.wallets.map((wallet) => ({ ...wallet })),
  }
  return true
}

export function chainsOf(table: LabRouteTable, groupId: string): string[] {
  if (groupId === '') return []
  return Object.entries(table.groups)
    .filter(([, group]) => sameGroupId(group.groupId, groupId))
    .map(([nft]) => nft)
}

/** Live archive groups G_e. Genesis is 1; each fission adds a distinct groupId. */
export function liveGroupIds(table: LabRouteTable): string[] {
  const ids = new Set<string>()
  if (table.ownGroupId !== '') ids.add(canonicalGroupId(table.ownGroupId))
  for (const group of Object.values(table.groups)) {
    if (group.groupId !== '') ids.add(canonicalGroupId(group.groupId))
  }
  return [...ids].sort()
}

export function liveGroupCount(table: LabRouteTable): number {
  return Math.max(1, liveGroupIds(table).length)
}

export function hopTargets(table: LabRouteTable, chainNftId: string): LabHistoryWallet[] {
  const others = historyProviders(table, chainNftId).filter(
    (wallet) =>
      wallet.domainId !== table.selfDomainId && typeof wallet.url === 'string' && wallet.url !== '',
  )
  const active = others.filter((wallet) => wallet.role === 'active')
  const rest = others.filter((wallet) => wallet.role !== 'active')
  return [...active, ...rest]
}

export function routeView(table: LabRouteTable, chainNftId: string): DleLabRouteV1 {
  const nft = normalizeChainNftId(chainNftId)
  if (nft === null) {
    return {
      schema: 'DleLabRouteV1',
      labOnly: true,
      notProductionDepin: true,
      l1RouteUnproven: true,
      chainNftId: '',
      groupId: null,
      ownGroup: false,
      reason: 'chainNftId is invalid.',
    }
  }
  const groupId = routeGroupId(table, nft)
  if (groupId === null) {
    return {
      schema: 'DleLabRouteV1',
      labOnly: true,
      notProductionDepin: true,
      l1RouteUnproven: true,
      chainNftId: nft,
      groupId: null,
      ownGroup: false,
      reason: 'No lab route for this chainNftId; L1 registry is unproven.',
    }
  }
  return {
    schema: 'DleLabRouteV1',
    labOnly: true,
    notProductionDepin: true,
    l1RouteUnproven: true,
    chainNftId: nft,
    groupId,
    ownGroup: sameGroupId(groupId, table.ownGroupId),
  }
}

export function providersView(table: LabRouteTable, chainNftId: string): DleLabProvidersV1 {
  const routed = routeView(table, chainNftId)
  return {
    schema: 'DleLabProvidersV1',
    labOnly: true,
    notProductionDepin: true,
    l1RouteUnproven: true,
    chainNftId: routed.chainNftId,
    groupId: routed.groupId,
    providers: routed.chainNftId === '' ? [] : historyProviders(table, routed.chainNftId),
  }
}

export function chainsView(table: LabRouteTable, groupId: string): DleLabChainsV1 {
  const canonical = canonicalGroupId(groupId)
  return {
    schema: 'DleLabChainsV1',
    labOnly: true,
    notProductionDepin: true,
    l1RouteUnproven: true,
    groupId: canonical,
    chainNftIds: chainsOf(table, canonical),
  }
}
