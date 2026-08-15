import { isJsonRpcRequest, jsonRpcError, jsonRpcSuccess, requestIdOf } from '../shared/jsonrpc.js'
import {
  CONET_L1_CHAIN_ID,
  CONET_L1_CHAIN_ID_HEX,
  DLE_ARCHIVE_CLIENT_VERSION,
  DLE_COMMAND,
  DLE_JSONRPC_BATCH_MAX,
  DLE_LAB_CHAIN_ID,
  DLE_RUNTIME,
  DLE_ZERO_ADDRESS,
  DLE_ZERO_HASH,
  chainIdHex,
  type DleArchiveInfo,
  type DleCertificateView,
  type DleSelectionLogView,
  type DleTipView,
  type DleWaitingPoolView,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from '../shared/protocol.js'

export interface ArchiveFacadeViews {
  tip: DleTipView
  certificate: DleCertificateView
  waitingPool?: DleWaitingPoolView
  selectionLog?: DleSelectionLogView
}

const EMPTY_LOGS_BLOOM = `0x${'0'.repeat(512)}`
const NO_TIP_VM = 'DLE has no tip VM; this archive node does not execute or proxy L1'
const NO_ACCOUNT_MODEL = 'DLE tip has no EVM account model; this archive does not answer eth_getBalance'
const EMPTY_AC_REASON = 'Networked Archive Certificate is not produced in this scaffold.'

export function emptyTipView(): DleTipView {
  return {
    height: '0x0',
    hash: DLE_ZERO_HASH,
    finalized: false,
    note: 'Archive node does not produce blocks; tip finality is an Archive Certificate.',
  }
}

export function emptyCertificateView(): DleCertificateView {
  return {
    available: false,
    reason: EMPTY_AC_REASON,
  }
}

export function defaultFacadeViews(): ArchiveFacadeViews {
  return { tip: emptyTipView(), certificate: emptyCertificateView() }
}

export function buildArchiveFacadeInfo(
  port: number,
  identity?: { domainId?: string; role?: string },
): DleArchiveInfo & Record<string, unknown> {
  return {
    command: DLE_COMMAND.archive,
    runtime: DLE_RUNTIME.nodejs,
    producesBlocks: false,
    hasTipVm: false,
    l1Isolated: true,
    l1ChainIdForbidden: CONET_L1_CHAIN_ID,
    batchSupported: true,
    chainId: DLE_LAB_CHAIN_ID,
    chainIdHex: chainIdHex(DLE_LAB_CHAIN_ID),
    port,
    ...(identity ?? {}),
  }
}

export function syntheticTipBlock(fullTxObjects: boolean, tip: DleTipView = emptyTipView()): Record<string, unknown> {
  return {
    number: tip.height,
    hash: tip.hash,
    parentHash: DLE_ZERO_HASH,
    nonce: '0x0000000000000000',
    sha3Uncles: DLE_ZERO_HASH,
    logsBloom: EMPTY_LOGS_BLOOM,
    transactionsRoot: DLE_ZERO_HASH,
    stateRoot: DLE_ZERO_HASH,
    receiptsRoot: DLE_ZERO_HASH,
    miner: DLE_ZERO_ADDRESS,
    difficulty: '0x0',
    totalDifficulty: '0x0',
    extraData: '0x',
    size: '0x0',
    gasLimit: '0x0',
    gasUsed: '0x0',
    timestamp: '0x0',
    transactions: fullTxObjects ? [] : [],
    uncles: [],
    mixHash: DLE_ZERO_HASH,
    dleFacade: true,
    dleNote: 'Synthetic DLE tip placeholder. Archives do not produce blocks; this is not an L1 block.',
  }
}

function firstParam(params: unknown): unknown {
  if (!Array.isArray(params) || params.length === 0) return undefined
  return params[0]
}

function wantsFullTx(params: unknown): boolean {
  return Array.isArray(params) && params[1] === true
}

function heightEquals(tag: string | number, tipHeight: string): boolean {
  try {
    return BigInt(tag) === BigInt(tipHeight)
  } catch {
    return String(tag).toLowerCase() === tipHeight.toLowerCase()
  }
}

function isTipBlockTag(tag: unknown, tipHeight: string): boolean {
  if (tag === undefined || tag === null) return true
  if (typeof tag === 'number') return heightEquals(tag, tipHeight)
  if (typeof tag !== 'string') return false
  const normalized = tag.toLowerCase()
  if (
    normalized === 'latest' ||
    normalized === 'pending' ||
    normalized === 'safe' ||
    normalized === 'finalized'
  ) {
    return true
  }
  if (normalized === 'earliest') return heightEquals(0, tipHeight)
  return heightEquals(normalized, tipHeight)
}

function isTipBlockHash(hash: unknown, tipHash: string): boolean {
  if (hash === undefined || hash === null) return true
  if (typeof hash !== 'string') return false
  return hash.toLowerCase() === tipHash.toLowerCase()
}

export function dispatchArchiveJsonRpc(
  request: JsonRpcRequest,
  info: DleArchiveInfo,
  views: ArchiveFacadeViews = defaultFacadeViews(),
): JsonRpcResponse {
  if (info.chainId === CONET_L1_CHAIN_ID || info.chainIdHex === CONET_L1_CHAIN_ID_HEX) {
    return jsonRpcError(request.id, -32603, 'DLE facade refused to advertise CoNET L1 chain id')
  }
  switch (request.method) {
    case 'dle_info':
      return jsonRpcSuccess(request.id, info)
    case 'dle_tip':
      return jsonRpcSuccess(request.id, views.tip)
    case 'dle_getArchiveCertificate':
      return jsonRpcSuccess(request.id, views.certificate)
    case 'dle_getWaitingPool':
      return jsonRpcSuccess(
        request.id,
        views.waitingPool ?? {
          schema: 'DleWaitingPoolV1',
          groupId: 'dle.lab.group.v1',
          epoch: 1,
          shardId: 'dle.lab.shard.v1',
          frozen: false,
          miners: [],
          poolRoot: null,
          minerCount: 0,
        },
      )
    case 'dle_getSelectionLog':
      return jsonRpcSuccess(
        request.id,
        views.selectionLog ?? {
          schema: 'DleLabSelectionLogV1',
          available: false,
          reason: 'Waiting pool is not frozen yet.',
        },
      )
    case 'eth_chainId':
      return jsonRpcSuccess(request.id, info.chainIdHex)
    case 'eth_blockNumber':
      return jsonRpcSuccess(request.id, views.tip.height)
    case 'net_version':
      return jsonRpcSuccess(request.id, String(info.chainId))
    case 'web3_clientVersion':
      return jsonRpcSuccess(request.id, DLE_ARCHIVE_CLIENT_VERSION)
    case 'eth_protocolVersion':
      return jsonRpcSuccess(request.id, '0x0')
    case 'eth_syncing':
      return jsonRpcSuccess(request.id, false)
    case 'eth_accounts':
      return jsonRpcSuccess(request.id, [])
    case 'eth_getBlockByNumber':
      if (!isTipBlockTag(firstParam(request.params), views.tip.height)) return jsonRpcSuccess(request.id, null)
      return jsonRpcSuccess(request.id, syntheticTipBlock(wantsFullTx(request.params), views.tip))
    case 'eth_getBlockByHash':
      if (!isTipBlockHash(firstParam(request.params), views.tip.hash)) return jsonRpcSuccess(request.id, null)
      return jsonRpcSuccess(request.id, syntheticTipBlock(wantsFullTx(request.params), views.tip))
    case 'eth_call':
    case 'eth_estimateGas':
    case 'eth_sendRawTransaction':
    case 'eth_sendTransaction':
      return jsonRpcError(request.id, -32601, NO_TIP_VM)
    case 'eth_getBalance':
    case 'eth_getCode':
    case 'eth_getStorageAt':
    case 'eth_getTransactionCount':
      return jsonRpcError(request.id, -32601, NO_ACCOUNT_MODEL)
    default:
      return jsonRpcError(request.id, -32601, `method not found: ${request.method}`)
  }
}

export function dispatchArchiveJsonRpcEnvelope(
  parsed: unknown,
  info: DleArchiveInfo,
  views: ArchiveFacadeViews = defaultFacadeViews(),
): { ok: true; body: JsonRpcResponse | JsonRpcResponse[] } | { ok: false; status: number; body: JsonRpcResponse } {
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      return { ok: false, status: 400, body: jsonRpcError(null, -32600, 'invalid request') }
    }
    if (parsed.length > DLE_JSONRPC_BATCH_MAX) {
      return { ok: false, status: 400, body: jsonRpcError(null, -32600, 'batch too large') }
    }
    const body = parsed.map((item) => {
      if (!isJsonRpcRequest(item)) {
        return jsonRpcError(requestIdOf(item), -32600, 'invalid request')
      }
      return dispatchArchiveJsonRpc(item, info, views)
    })
    return { ok: true, body }
  }
  if (!isJsonRpcRequest(parsed)) {
    return { ok: false, status: 400, body: jsonRpcError(null, -32600, 'invalid request') }
  }
  return { ok: true, body: dispatchArchiveJsonRpc(parsed, info, views) }
}
