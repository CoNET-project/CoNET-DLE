export type ArchiveRole = 'active' | 'standby'

export interface DleArchiveInfo {
  command: 'archive'
  runtime: 'nodejs'
  producesBlocks: false
  hasTipVm: false
  l1Isolated?: true
  l1ChainIdForbidden?: number
  batchSupported?: true
  chainId: number
  chainIdHex: string
  chainName?: string
  port: number
  domainId?: string
  role?: string
}

export interface DleTipView {
  height: string
  hash: string
  finalized: boolean
  note: string
}

export interface DleCertificateView {
  available: boolean
  reason: string
  height?: string
  hash?: string
  quorum?: number
  networked?: boolean
  modeA?: boolean
  signers?: string[]
  kind?: number
  round?: number
  prevoteQCRef?: string
  labOnly?: boolean
}

export interface DleWaitingPoolView {
  schema: 'DleWaitingPoolV1'
  groupId: string
  epoch: number
  shardId: string
  frozen: boolean
  miners: string[]
  poolRoot: string | null
  minerCount: number
  source: 'live' | 'fixture'
}

export interface DleSelectionLogAvailable {
  schema: 'DleLabSelectionLogV1'
  available: true
  endorsed: boolean
  epoch: number
  shardId: string
  groupId: string
  poolRoot: string
  beacon: string
  roulette: string
  committee: string[]
  standbys: string[]
  attestors: string[]
  quorum: number
  labBeacon: true
  labOnly: true
  note: string
  acceptedAt?: string
  source: 'live' | 'fixture'
}

export interface DleSelectionLogUnavailable {
  schema: 'DleLabSelectionLogV1'
  available: false
  reason: string
  source: 'live' | 'fixture'
}

export type DleSelectionLogView = DleSelectionLogAvailable | DleSelectionLogUnavailable

export interface JsonRpcError {
  code: number
  message: string
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0'
  id: string | number | null
  result: unknown
}

export interface JsonRpcFailure {
  jsonrpc: '2.0'
  id: string | number | null
  error: JsonRpcError
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure

export interface DleEventRow {
  id: string
  at: string
  type: string
  method?: string
  ok?: boolean
  domainId?: string
  role?: string
  quorumOk?: boolean
  peerOk?: number
  port?: number
  detail?: string
  source: 'live' | 'fixture'
}

export interface LabArchiveRow {
  domainId: string
  operatorDomainId: string
  hostId: string
  provider: string
  region: string
  role: ArchiveRole
  health: 'live' | 'unknown' | 'unreachable'
  lastQuorumOk: boolean | null
  lastPeerOk: number | null
  heartbeats: number | null
  participantWallet: string
  source: 'live' | 'fixture'
}

export interface RpcProbeRow {
  method: string
  status: 'ok' | 'rejected' | 'error' | 'stale'
  result: unknown
}

export interface TrustedExplorerSnapshot {
  fetchedAt: string
  archiveUrl: string
  live: boolean
  health: Record<string, unknown> | null
  info: DleArchiveInfo | null
  tip: DleTipView | null
  certificate: DleCertificateView | null
  waitingPool: DleWaitingPoolView | null
  selection: DleSelectionLogView | null
  /** Live archive groups G_e. Genesis is 1; each fission adds one. */
  clusterCount: number
  liveGroupIds: string[]
  events: DleEventRow[]
  archives: LabArchiveRow[]
  rpc: RpcProbeRow[]
}

export type RefreshStatus = 'idle' | 'loading' | 'success' | 'error'
