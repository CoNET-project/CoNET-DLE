import {
  DLE_JSONRPC_VERSION,
  type JsonRpcFailure,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcSuccess,
} from './protocol.js'

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.jsonrpc === DLE_JSONRPC_VERSION && typeof record.method === 'string'
}

export function jsonRpcSuccess(id: JsonRpcRequest['id'], result: unknown): JsonRpcSuccess {
  return { jsonrpc: DLE_JSONRPC_VERSION, id, result }
}

export function jsonRpcError(
  id: JsonRpcRequest['id'],
  code: number,
  message: string,
): JsonRpcFailure {
  return { jsonrpc: DLE_JSONRPC_VERSION, id, error: { code, message } }
}

export function parseJsonRpcResponse(value: unknown): JsonRpcResponse {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid JSON-RPC response')
  }
  const record = value as Record<string, unknown>
  if (record.jsonrpc !== DLE_JSONRPC_VERSION) throw new Error('invalid JSON-RPC version')
  if ('error' in record) {
    const error = record.error
    if (error === null || typeof error !== 'object' || Array.isArray(error)) {
      throw new Error('invalid JSON-RPC error')
    }
    const err = error as Record<string, unknown>
    if (typeof err.code !== 'number' || typeof err.message !== 'string') {
      throw new Error('invalid JSON-RPC error')
    }
    return {
      jsonrpc: DLE_JSONRPC_VERSION,
      id: (record.id as JsonRpcRequest['id']) ?? null,
      error: { code: err.code, message: err.message },
    }
  }
  return {
    jsonrpc: DLE_JSONRPC_VERSION,
    id: (record.id as JsonRpcRequest['id']) ?? null,
    result: record.result,
  }
}
