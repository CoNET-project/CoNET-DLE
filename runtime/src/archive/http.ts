import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { jsonRpcError } from '../shared/jsonrpc.js'
import type {
  DleArchiveInfo,
  DleCertificateView,
  DleSelectionLogView,
  DleTipView,
  DleWaitingPoolView,
} from '../shared/protocol.js'
import { createHashLookupAdapter } from './hashPipe.js'
import type { Hop1Fetch } from './hop1.js'
import {
  buildArchiveFacadeInfo,
  defaultFacadeViews,
  dispatchArchiveJsonRpcEnvelope,
} from './jsonrpcFacade.js'
import {
  defaultLabRouteTable,
  liveGroupCount,
  liveGroupIds,
  type LabRouteTable,
} from '../shared/labRoute.js'
import type { ArchiveStore } from './store.js'

const HASH_GET_RE = /^\/api\/v2\/dle\/hash\/(0x[0-9a-fA-F]{64})$/i
const OBJECT_GET_RE = /^\/api\/v2\/dle\/object\/(\d+)\/(0x[0-9a-fA-F]+)$/i
const ROUTE_GET_RE = /^\/api\/v2\/dle\/route\/(\d+)$/i
const PROVIDERS_GET_RE = /^\/api\/v2\/dle\/historyProviders\/(\d+)$/i
const ARCHIVES_GET_RE = /^\/api\/v2\/dle\/archivesOf\/(\d+)$/i
const CHAINS_GET_RE = /^\/api\/v2\/dle\/chainsOf\/([^/]+)$/i
const PROVE_GET_RE = /^\/api\/v2\/dle\/proveHash\/(0x[0-9a-fA-F]{64})$/i

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
  facadeViews?: () => {
    tip: DleTipView
    certificate: DleCertificateView
    waitingPool?: DleWaitingPoolView
    selectionLog?: DleSelectionLogView
  }
  onPost?: (pathname: string, body: unknown) => { status: number; body: unknown } | undefined
  routeTable?: LabRouteTable
  hopFetch?: Hop1Fetch
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

function clusterView(options: ArchiveHttpOptions): { liveGroupCount: number; liveGroupIds: string[] } {
  const table =
    options.routeTable ??
    defaultLabRouteTable({
      domainId: options.identity?.domainId ?? 'local',
      role: options.identity?.role ?? 'active',
    })
  return {
    liveGroupCount: liveGroupCount(table),
    liveGroupIds: liveGroupIds(table),
  }
}

function lookupAdapter(options: ArchiveHttpOptions) {
  return createHashLookupAdapter(options.store.hash, {
    table:
      options.routeTable ??
      defaultLabRouteTable({
        domainId: options.identity?.domainId ?? 'local',
        role: options.identity?.role ?? 'active',
      }),
    ...(options.hopFetch !== undefined ? { fetchObject: options.hopFetch } : {}),
  })
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
        ...clusterView(options),
      })
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/v2/dle') {
      const extra = options.extraHealth?.() ?? {}
      const views = options.facadeViews?.() ?? defaultFacadeViews()
      const clusters = clusterView(options)
      sendJson(res, 200, {
        schema: 'DleExplorerApiV1',
        chainId: info.chainId,
        chainIdHex: info.chainIdHex,
        producesBlocks: false,
        hasTipVm: false,
        l1Isolated: true,
        batchSupported: true,
        ...clusters,
        tip: views.tip,
        certificate: views.certificate,
        waitingPool: views.waitingPool ?? null,
        selection: views.selectionLog ?? null,
        archive: {
          ok: true,
          ...info,
          ...(options.identity ?? {}),
          ...extra,
          ...clusters,
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
    if (req.method === 'GET') {
      const lookup = lookupAdapter(options)
      const hashMatch = HASH_GET_RE.exec(url.pathname)
      const hashParam = hashMatch?.[1]
      if (hashParam !== undefined) {
        sendJson(res, 200, await lookup.get(hashParam))
        return
      }
      const objectMatch = OBJECT_GET_RE.exec(url.pathname)
      if (objectMatch?.[1] !== undefined && objectMatch[2] !== undefined) {
        sendJson(res, 200, lookup.getObjectLocal(objectMatch[1], objectMatch[2]))
        return
      }
      const routeMatch = ROUTE_GET_RE.exec(url.pathname)
      if (routeMatch?.[1] !== undefined) {
        sendJson(res, 200, lookup.route(routeMatch[1]))
        return
      }
      const providersMatch = PROVIDERS_GET_RE.exec(url.pathname)
      if (providersMatch?.[1] !== undefined) {
        sendJson(res, 200, lookup.historyProviders(providersMatch[1]))
        return
      }
      const archivesMatch = ARCHIVES_GET_RE.exec(url.pathname)
      if (archivesMatch?.[1] !== undefined) {
        sendJson(res, 200, lookup.archivesOf(archivesMatch[1]))
        return
      }
      const chainsMatch = CHAINS_GET_RE.exec(url.pathname)
      if (chainsMatch?.[1] !== undefined) {
        sendJson(res, 200, lookup.chainsOf(decodeURIComponent(chainsMatch[1])))
        return
      }
      if (url.pathname === '/api/v2/dle/hashIndexRoot') {
        sendJson(res, 200, lookup.hashIndexRoot())
        return
      }
      const proveMatch = PROVE_GET_RE.exec(url.pathname)
      if (proveMatch?.[1] !== undefined) {
        const proof = lookup.proveHash(proveMatch[1])
        sendJson(res, 200, 'ok' in proof && proof.ok === false ? { error: proof.error } : proof)
        return
      }
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
        const dispatched = await dispatchArchiveJsonRpcEnvelope(
          parsed,
          info,
          views,
          lookupAdapter(options),
        )
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
