export type ArchiveRole = 'active' | 'standby'

export interface DleArchiveInfo {
  command: 'archive'
  runtime: 'nodejs'
  producesBlocks: false
  hasTipVm: false
  chainId: number
  chainIdHex: string
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
}

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
  events: DleEventRow[]
  archives: LabArchiveRow[]
  rpc: RpcProbeRow[]
}

export type RefreshStatus = 'idle' | 'loading' | 'success' | 'error'
