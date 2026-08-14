import { DLE_JSONRPC_VERSION } from '../protocol'
import type { JsonRpcResponse } from '../types'

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
      id: (record.id as string | number | null) ?? null,
      error: { code: err.code, message: err.message },
    }
  }
  return {
    jsonrpc: DLE_JSONRPC_VERSION,
    id: (record.id as string | number | null) ?? null,
    result: record.result,
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
