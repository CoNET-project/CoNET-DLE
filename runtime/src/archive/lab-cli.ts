#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { listenArchiveHttp } from './http.js'
import { openArchiveStore } from './store.js'

const HEARTBEAT_MS = 6_000
const REQUEST_TIMEOUT_MS = 2_500
const LAB_AGENT_COMPAT = 'dle-30d-lab'

interface LabPeer {
  domainId: string
  host: string
  port: number
  role: string
}

interface LabConfig {
  domainId: string
  role: string
  port: number
  peers?: LabPeer[]
}

function parseArgs(argv: string[]): { configPath: string; dataDir: string } {
  let configPath = ''
  let dataDir = ''
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === '--config' && next !== undefined) {
      configPath = resolve(next)
      i += 1
      continue
    }
    if (arg === '--data-dir' && next !== undefined) {
      dataDir = resolve(next)
      i += 1
    }
  }
  if (configPath === '') throw new Error('usage: lab-cli.js --config FILE [--data-dir DIR]')
  return { configPath, dataDir }
}

function isPeerHealthy(body: unknown, domainId: string): boolean {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return false
  const row = body as Record<string, unknown>
  if (row.ok !== true || row.domainId !== domainId) return false
  return row.command === 'archive' || row.agent === LAB_AGENT_COMPAT
}

async function probePeer(peer: LabPeer): Promise<{ domainId: string; ok: boolean }> {
  try {
    const response = await fetch(`http://${peer.host}:${peer.port}/health`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) return { domainId: peer.domainId, ok: false }
    return { domainId: peer.domainId, ok: isPeerHealthy(await response.json(), peer.domainId) }
  } catch {
    return { domainId: peer.domainId, ok: false }
  }
}

const options = parseArgs(process.argv.slice(2))
const config = JSON.parse(readFileSync(options.configPath, 'utf8')) as LabConfig
if (typeof config.domainId !== 'string' || typeof config.role !== 'string') {
  throw new Error('config must include domainId and role')
}
const port = Number(config.port)
if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('invalid config.port')
const labDir = dirname(fileURLToPath(import.meta.url))
const dataDir = options.dataDir !== '' ? options.dataDir : resolve(labDir, '../../data')
const statePath = resolve(dataDir, 'state.json')
const store = openArchiveStore(dataDir)
const startedAt = Date.now()
const state = {
  schema: 'DleArchiveLabStateV1',
  command: 'archive',
  runtime: 'nodejs',
  agent: LAB_AGENT_COMPAT,
  domainId: config.domainId,
  role: config.role,
  port,
  startedAt: new Date().toISOString(),
  heartbeats: 0,
  lastQuorumOk: false,
  lastPeerOk: 0,
  lastError: null as string | null,
}

function persistState(): void {
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

persistState()
store.appendWal({ type: 'lab-start', domainId: state.domainId, role: state.role })

const server = await listenArchiveHttp({
  port,
  store,
  identity: { domainId: config.domainId, role: config.role },
  extraHealth() {
    return {
      agent: LAB_AGENT_COMPAT,
      isolatedFromElCl: true,
      producesBlocks: false,
      uptimeMs: Date.now() - startedAt,
      heartbeats: state.heartbeats,
      lastQuorumOk: state.lastQuorumOk,
      lastPeerOk: state.lastPeerOk,
    }
  },
  extraGet(pathname) {
    if (pathname === '/state') return { ...state, uptimeMs: Date.now() - startedAt }
    return undefined
  },
})

function scheduleHeartbeat(): void {
  setTimeout(() => {
    void (async () => {
      try {
        const peers = Array.isArray(config.peers) ? config.peers : []
        const results = await Promise.all(peers.map((peer) => probePeer(peer)))
        const activePeers = peers.filter((peer) => peer.role === 'active')
        const activeOk = results.filter(
          (row) => row.ok && activePeers.some((peer) => peer.domainId === row.domainId),
        ).length
        const selfActive = state.role === 'active' ? 1 : 0
        state.heartbeats += 1
        state.lastQuorumOk = activeOk + selfActive >= 4
        state.lastPeerOk = results.filter((row) => row.ok).length
        state.lastError = null
        persistState()
        store.appendWal({
          type: 'heartbeat',
          domainId: state.domainId,
          quorumOk: state.lastQuorumOk,
          peerOk: state.lastPeerOk,
        })
      } catch (error) {
        state.lastError = error instanceof Error ? error.message : String(error)
        persistState()
      } finally {
        scheduleHeartbeat()
      }
    })()
  }, HEARTBEAT_MS)
}

scheduleHeartbeat()
process.stdout.write(
  `${JSON.stringify({ ok: true, ...server.info, dataDir, listening: `0.0.0.0:${server.port}` }, null, 2)}\n`,
)

const shutdown = (): void => {
  void server.close().then(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
