#!/usr/bin/env node
import { createServer } from 'node:http'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const AGENT_NAME = 'dle-30d-lab'
const HEARTBEAT_MS = 6_000
const REQUEST_TIMEOUT_MS = 2_500

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function nowIso() {
  return new Date().toISOString()
}

function appendWal(path, record) {
  appendFileSync(path, `${JSON.stringify(record)}\n`, 'utf8')
}

function parseArgs(argv) {
  const out = new Map()
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    const value = argv[i + 1]
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error('usage: agent.mjs --config FILE')
    }
    out.set(key.slice(2), value)
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const configPath = args.get('config')
if (!configPath) throw new Error('missing --config')
const config = readJson(configPath)
const labDir = dirname(fileURLToPath(import.meta.url))
const walDir = join(labDir, 'wal')
const statePath = join(labDir, 'state.json')
mkdirSync(walDir, { recursive: true })
const walPath = join(walDir, 'heartbeat.ndjson')

const startedAt = Date.now()
const state = {
  schema: 'DleLabAgentStateV1',
  agent: AGENT_NAME,
  domainId: config.domainId,
  role: config.role,
  port: config.port,
  startedAt: nowIso(),
  heartbeats: 0,
  lastQuorumOk: false,
  lastPeerOk: 0,
  lastError: null,
}

writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
appendWal(walPath, { type: 'start', at: state.startedAt, domainId: state.domainId, role: state.role })

function json(res, code, body) {
  const payload = JSON.stringify(body)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'x-dle-lab-agent': AGENT_NAME,
  })
  res.end(payload)
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${config.port}`)
  if (req.method === 'GET' && url.pathname === '/health') {
    json(res, 200, {
      ok: true,
      agent: AGENT_NAME,
      domainId: state.domainId,
      role: state.role,
      uptimeMs: Date.now() - startedAt,
      heartbeats: state.heartbeats,
      lastQuorumOk: state.lastQuorumOk,
      lastPeerOk: state.lastPeerOk,
      isolatedFromElCl: true,
    })
    return
  }
  if (req.method === 'GET' && url.pathname === '/state') {
    json(res, 200, state)
    return
  }
  json(res, 404, { ok: false, error: 'not_found' })
})

server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`${AGENT_NAME} listening on 0.0.0.0:${config.port} domain=${state.domainId}\n`)
})

function probePeer(peer) {
  return new Promise((resolve) => {
    const req = fetch(`http://${peer.host}:${peer.port}/health`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    req
      .then(async (response) => {
        if (!response.ok) {
          resolve({ domainId: peer.domainId, ok: false })
          return
        }
        const body = await response.json()
        resolve({
          domainId: peer.domainId,
          ok: body.ok === true && body.agent === AGENT_NAME && body.domainId === peer.domainId,
        })
      })
      .catch(() => resolve({ domainId: peer.domainId, ok: false }))
  })
}

function scheduleHeartbeat() {
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
        const quorumOk = activeOk + selfActive >= 4
        state.heartbeats += 1
        state.lastQuorumOk = quorumOk
        state.lastPeerOk = results.filter((row) => row.ok).length
        state.lastError = null
        writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
        appendWal(walPath, {
          type: 'heartbeat',
          at: nowIso(),
          domainId: state.domainId,
          quorumOk,
          activeOk: activeOk + selfActive,
          peerOk: state.lastPeerOk,
        })
      } catch (error) {
        state.lastError = error instanceof Error ? error.message : String(error)
        writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
      } finally {
        scheduleHeartbeat()
      }
    })()
  }, HEARTBEAT_MS)
}

scheduleHeartbeat()
