import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { jsonRpcError } from '../shared/jsonrpc.js'
import type { DleArchiveInfo, DleCertificateView, DleTipView } from '../shared/protocol.js'
import {
  buildArchiveFacadeInfo,
  defaultFacadeViews,
  dispatchArchiveJsonRpcEnvelope,
} from './jsonrpcFacade.js'
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
  facadeViews?: () => { tip: DleTipView; certificate: DleCertificateView }
  onPost?: (pathname: string, body: unknown) => { status: number; body: unknown } | undefined
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
  return buildArchiveFacadeInfo(port, identity)
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
      const views = options.facadeViews?.() ?? defaultFacadeViews()
      sendJson(res, 200, {
        schema: 'DleExplorerApiV1',
        chainId: info.chainId,
        chainIdHex: info.chainIdHex,
        producesBlocks: false,
        hasTipVm: false,
        l1Isolated: true,
        batchSupported: true,
        tip: views.tip,
        certificate: views.certificate,
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
      const views = options.facadeViews?.() ?? defaultFacadeViews()
      sendJson(res, 200, {
        schema: 'DleExplorerCertificateV1',
        ...views.certificate,
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
    if (req.method === 'POST') {
      let parsed: unknown
      try {
        const raw = await readBody(req)
        parsed = raw === '' ? {} : (JSON.parse(raw) as unknown)
      } catch {
        sendJson(res, 400, jsonRpcError(null, -32700, 'parse error'))
        return
      }
      if (options.onPost !== undefined) {
        const handled = options.onPost(url.pathname, parsed)
        if (handled !== undefined) {
          sendJson(res, handled.status, handled.body)
          return
        }
      }
      if (url.pathname === '/' || url.pathname === '/rpc') {
        const views = options.facadeViews?.() ?? defaultFacadeViews()
        const dispatched = dispatchArchiveJsonRpcEnvelope(parsed, info, views)
        if (!dispatched.ok) {
          sendJson(res, dispatched.status, dispatched.body)
          return
        }
        const method = Array.isArray(parsed)
          ? 'batch'
          : typeof parsed === 'object' && parsed !== null && 'method' in parsed
            ? String((parsed as { method: unknown }).method)
            : 'rpc'
        const ok = Array.isArray(dispatched.body)
          ? dispatched.body.every((row) => !('error' in row))
          : !('error' in dispatched.body)
        options.store.appendWal({ type: 'rpc', method, ok })
        sendJson(res, 200, dispatched.body)
        return
      }
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
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections()
        }
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    },
  }
}
