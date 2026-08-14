import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { isJsonRpcRequest, jsonRpcError, jsonRpcSuccess } from '../shared/jsonrpc.js'
import {
  DLE_COMMAND,
  DLE_LAB_CHAIN_ID,
  DLE_RUNTIME,
  chainIdHex,
  type DleArchiveInfo,
  type DleTipView,
  type JsonRpcRequest,
} from '../shared/protocol.js'
import type { ArchiveStore } from './store.js'

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
} as const

export interface ArchiveHttpOptions {
  port: number
  store: ArchiveStore
  identity?: {
    domainId: string
    role: string
  }
  extraHealth?: () => Record<string, unknown>
  extraGet?: (pathname: string) => Record<string, unknown> | undefined
}

export interface ArchiveHttpServer {
  readonly port: number
  readonly info: DleArchiveInfo & Record<string, unknown>
  close(): Promise<void>
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    ...CORS,
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function archiveInfo(port: number, identity?: ArchiveHttpOptions['identity']): DleArchiveInfo & Record<string, unknown> {
  return {
    command: DLE_COMMAND.archive,
    runtime: DLE_RUNTIME.nodejs,
    producesBlocks: false,
    hasTipVm: false,
    chainId: DLE_LAB_CHAIN_ID,
    chainIdHex: chainIdHex(DLE_LAB_CHAIN_ID),
    port,
    ...(identity ?? {}),
  }
}

function tipView(): DleTipView {
  return {
    height: '0x0',
    hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    finalized: false,
    note: 'Archive node does not produce blocks; tip finality is an Archive Certificate.',
  }
}

function dispatch(request: JsonRpcRequest, info: DleArchiveInfo): ReturnType<typeof jsonRpcSuccess> | ReturnType<typeof jsonRpcError> {
  switch (request.method) {
    case 'dle_info':
      return jsonRpcSuccess(request.id, info)
    case 'dle_tip':
      return jsonRpcSuccess(request.id, tipView())
    case 'dle_getArchiveCertificate':
      return jsonRpcSuccess(request.id, {
        available: false,
        reason: 'Networked Archive Certificate is not produced in this scaffold.',
      })
    case 'eth_chainId':
      return jsonRpcSuccess(request.id, info.chainIdHex)
    case 'eth_blockNumber':
      return jsonRpcSuccess(request.id, tipView().height)
    case 'eth_call':
    case 'eth_estimateGas':
    case 'eth_sendRawTransaction':
      return jsonRpcError(request.id, -32601, 'DLE has no tip VM; this archive node does not execute eth_call')
    default:
      return jsonRpcError(request.id, -32601, `method not found: ${request.method}`)
  }
}

export async function listenArchiveHttp(options: ArchiveHttpOptions): Promise<ArchiveHttpServer> {
  const infoHolder: { port: number } = { port: options.port }
  const server: Server = createServer((req, res) => {
    void handle(req, res)
  })

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const info = archiveInfo(infoHolder.port, options.identity)
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS)
      res.end()
      return
    }
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${infoHolder.port}`)
    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/')) {
      sendJson(res, 200, {
        ok: true,
        ...info,
        ...(options.identity ?? {}),
        ...(options.extraHealth?.() ?? {}),
      })
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/v2/dle') {
      const extra = options.extraHealth?.() ?? {}
      sendJson(res, 200, {
        schema: 'DleExplorerApiV1',
        chainId: info.chainId,
        chainIdHex: info.chainIdHex,
        producesBlocks: false,
        hasTipVm: false,
        tip: tipView(),
        certificate: {
          available: false,
          reason: 'Networked Archive Certificate is not produced in this scaffold.',
        },
        archive: {
          ok: true,
          ...info,
          ...(options.identity ?? {}),
          ...extra,
        },
      })
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/v2/dle/events') {
      sendJson(res, 200, {
        schema: 'DleExplorerEventsV1',
        events: options.store.recentWal(100),
      })
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/v2/dle/certificate') {
      sendJson(res, 200, {
        schema: 'DleExplorerCertificateV1',
        available: false,
        reason: 'Networked Archive Certificate is not produced in this scaffold.',
      })
      return
    }
    if (req.method === 'GET' && options.extraGet !== undefined) {
      const extra = options.extraGet(url.pathname)
      if (extra !== undefined) {
        sendJson(res, 200, extra)
        return
      }
    }
    if (req.method === 'POST' && (url.pathname === '/' || url.pathname === '/rpc')) {
      let parsed: unknown
      try {
        parsed = JSON.parse(await readBody(req)) as unknown
      } catch {
        sendJson(res, 400, jsonRpcError(null, -32700, 'parse error'))
        return
      }
      if (!isJsonRpcRequest(parsed)) {
        sendJson(res, 400, jsonRpcError(null, -32600, 'invalid request'))
        return
      }
      const response = dispatch(parsed, info)
      options.store.appendWal({ type: 'rpc', method: parsed.method, ok: !('error' in response) })
      sendJson(res, 200, response)
      return
    }
    sendJson(res, 404, { ok: false, error: 'not found' })
  }

  await new Promise<void>((resolve, reject) => {
    server.listen(options.port, '0.0.0.0', () => resolve())
    server.on('error', reject)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('archive HTTP bind failed')
  infoHolder.port = address.port
  options.store.appendWal({ type: 'listen', port: infoHolder.port })
  return {
    get port() {
      return infoHolder.port
    },
    get info() {
      return archiveInfo(infoHolder.port, options.identity)
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    },
  }
}
