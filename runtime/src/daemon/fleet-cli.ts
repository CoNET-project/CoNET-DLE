#!/usr/bin/env node
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import {
  HTTP_QUEUE_CLIENT_COUNT,
  httpQueueMiner,
  httpQueueMinersPresent,
} from '../shared/ondemand/index.js'
import {
  fetchSelectionLog,
  fetchWaitingPool,
  freezeWaitingPool,
  submitWaitHookToArchives,
  type ArchiveHookResult,
  type OnDemandWaitSession,
} from './core.js'

type ClientSession = OnDemandWaitSession & { archives: ArchiveHookResult[] }

const CLIENT_TICK_MS = 8_000
const SUPERVISOR_TICK_MS = 5_000
const SPAWN_STAGGER_MS = 100

interface ArchivesFile {
  schema: 'DleOnDemandHttpArchivesV1'
  archives: string[]
}

interface ParsedArgs {
  mode: 'supervisor' | 'client'
  index: number
  archivesFile: string
  dataDir: string
  clientCount: number
}

function parseArgs(argv: string[]): ParsedArgs {
  let mode: ParsedArgs['mode'] = 'supervisor'
  let index = 0
  let archivesFile = ''
  let dataDir = ''
  let clientCount = HTTP_QUEUE_CLIENT_COUNT
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === '--supervisor') {
      mode = 'supervisor'
      continue
    }
    if (arg === '--client' && next !== undefined) {
      mode = 'client'
      index = Number(next)
      i += 1
      continue
    }
    if (arg === '--archives-file' && next !== undefined) {
      archivesFile = resolve(next)
      i += 1
      continue
    }
    if (arg === '--data-dir' && next !== undefined) {
      dataDir = resolve(next)
      i += 1
      continue
    }
    if (arg === '--client-count' && next !== undefined) {
      clientCount = Number(next)
      i += 1
    }
  }
  if (archivesFile === '' || dataDir === '') {
    throw new Error(
      'usage: fleet-cli.js --supervisor|--client N --archives-file FILE --data-dir DIR [--client-count 30]',
    )
  }
  if (mode === 'client' && (!Number.isInteger(index) || index < 1 || index > HTTP_QUEUE_CLIENT_COUNT)) {
    throw new Error(`--client must be 1..${HTTP_QUEUE_CLIENT_COUNT}`)
  }
  if (!Number.isInteger(clientCount) || clientCount < 1 || clientCount > HTTP_QUEUE_CLIENT_COUNT) {
    throw new Error(`--client-count must be 1..${HTTP_QUEUE_CLIENT_COUNT}`)
  }
  return { mode, index, archivesFile, dataDir, clientCount }
}

function loadArchives(path: string): string[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as ArchivesFile
  if (raw.schema !== 'DleOnDemandHttpArchivesV1' || !Array.isArray(raw.archives) || raw.archives.length === 0) {
    throw new Error('archives file must list HTTP archive URLs')
  }
  if (raw.archives.some((url) => !url.startsWith('http://'))) {
    throw new Error('on-demand HTTP queue must use http:// archive URLs, not https or explorer')
  }
  return raw.archives
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function runClient(options: ParsedArgs, archives: string[]): void {
  const miner = httpQueueMiner(options.index)
  const statusPath = resolve(options.dataDir, `client-${String(options.index).padStart(2, '0')}.json`)
  let lastTrusted: ClientSession | null = null
  let queuedEverywhere = false

  const tick = (): void => {
    setTimeout(() => {
      void (async () => {
        try {
          const session = queuedEverywhere
            ? await pollQueued(archives, miner, lastTrusted)
            : await submitWaitHookToArchives(archives, miner)
          lastTrusted = session
          queuedEverywhere =
            session.archives.every((row) => row.minerInPool) ||
            session.status === 'queued' ||
            session.status === 'frozen'
          writeJson(statusPath, {
            schema: 'DleOnDemandHttpClientStatusV1',
            index: options.index,
            miner,
            updatedAt: new Date().toISOString(),
            session,
          })
        } catch (error) {
          writeJson(statusPath, {
            schema: 'DleOnDemandHttpClientStatusV1',
            index: options.index,
            miner,
            updatedAt: new Date().toISOString(),
            session: lastTrusted,
            lastError: error instanceof Error ? error.message : String(error),
          })
        } finally {
          tick()
        }
      })()
    }, CLIENT_TICK_MS)
  }

  void (async () => {
    try {
      const session = await submitWaitHookToArchives(archives, miner)
      lastTrusted = session
      queuedEverywhere =
        session.archives.every((row) => row.minerInPool) ||
        session.status === 'queued' ||
        session.status === 'frozen'
      writeJson(statusPath, {
        schema: 'DleOnDemandHttpClientStatusV1',
        index: options.index,
        miner,
        updatedAt: new Date().toISOString(),
        session,
      })
    } catch (error) {
      writeJson(statusPath, {
        schema: 'DleOnDemandHttpClientStatusV1',
        index: options.index,
        miner,
        updatedAt: new Date().toISOString(),
        session: null,
        lastError: error instanceof Error ? error.message : String(error),
      })
    } finally {
      tick()
    }
  })()
}

async function pollQueued(
  archives: string[],
  miner: string,
  lastTrusted: ClientSession | null,
): Promise<ClientSession> {
  const first = archives[0]!
  const pool = await fetchWaitingPool(first)
  const selection = await fetchSelectionLog(first)
  const selected = selection.available === true ? selection : null
  const slot = pool.miners.findIndex((row) => row.toLowerCase() === miner.toLowerCase())
  return {
    schema: 'DleOnDemandWaitV1',
    status: pool.frozen ? 'frozen' : 'queued',
    slot: slot >= 0 ? slot : null,
    miner,
    groupId: pool.groupId,
    poolRoot: selected?.poolRoot ?? pool.poolRoot,
    committee: selected?.committee ?? lastTrusted?.committee ?? [],
    standbys: selected?.standbys ?? lastTrusted?.standbys ?? [],
    recomputed: lastTrusted?.recomputed === true,
    endorsed: selected?.endorsed === true,
    archives:
      lastTrusted?.archives ?? archives.map((archiveUrl) => ({ archiveUrl, status: 'queued', minerInPool: true })),
    note: pool.frozen
      ? 'Already queued; archive waiting pool is now frozen.'
      : 'Already queued; polling HTTP /ondemand/pool without re-hooking.',
  }
}

async function snapshotArchives(archives: string[]): Promise<
  Array<{
    archiveUrl: string
    frozen: boolean
    minerCount: number
    minersPresent: boolean
    poolRoot: string | null
    endorsed: boolean
  }>
> {
  const rows = []
  for (const archiveUrl of archives) {
    const pool = await fetchWaitingPool(archiveUrl)
    let endorsed = false
    try {
      const selection = await fetchSelectionLog(archiveUrl)
      endorsed = selection.available === true && selection.endorsed === true
    } catch {
      endorsed = false
    }
    rows.push({
      archiveUrl,
      frozen: pool.frozen,
      minerCount: pool.minerCount,
      minersPresent: httpQueueMinersPresent(pool.miners),
      poolRoot: pool.poolRoot,
      endorsed,
    })
  }
  return rows
}

function runSupervisor(options: ParsedArgs, archives: string[]): void {
  const statusPath = resolve(options.dataDir, 'supervisor.json')
  const children: ChildProcess[] = []
  let freezeStarted = false
  const self = process.argv[1] ?? fileURLToPath(import.meta.url)

  const spawnNext = (index: number): void => {
    if (index > options.clientCount) return
    const child = spawn(
      process.execPath,
      [
        self,
        '--client',
        String(index),
        '--archives-file',
        options.archivesFile,
        '--data-dir',
        options.dataDir,
      ],
      { stdio: ['ignore', 'ignore', 'inherit'] },
    )
    children.push(child)
    setTimeout(() => spawnNext(index + 1), SPAWN_STAGGER_MS)
  }

  const tick = (): void => {
    setTimeout(() => {
      void (async () => {
        try {
          const rows = await snapshotArchives(archives)
          const ready = rows.every((row) => row.minersPresent && row.minerCount >= options.clientCount)
          if (ready && !freezeStarted && rows.some((row) => !row.frozen)) {
            freezeStarted = true
            for (const archiveUrl of archives) {
              try {
                await freezeWaitingPool(archiveUrl)
              } catch {
                /* keep last trusted snapshot; retry next tick */
                freezeStarted = false
              }
            }
          }
          writeJson(statusPath, {
            schema: 'DleOnDemandHttpSupervisorV1',
            updatedAt: new Date().toISOString(),
            clientCount: options.clientCount,
            children: children.length,
            freezeStarted,
            ready,
            archives: rows,
            note: 'HTTP wait-hook queue on archive TCP 27101. Not 30-day qualification. Hooks do not gossip; each client posts to every archive.',
          })
        } catch (error) {
          writeJson(statusPath, {
            schema: 'DleOnDemandHttpSupervisorV1',
            updatedAt: new Date().toISOString(),
            clientCount: options.clientCount,
            children: children.length,
            freezeStarted,
            lastError: error instanceof Error ? error.message : String(error),
            note: 'Untrusted poll failed; previous archive snapshot was not cleared.',
          })
        } finally {
          tick()
        }
      })()
    }, SUPERVISOR_TICK_MS)
  }

  writeJson(statusPath, {
    schema: 'DleOnDemandHttpSupervisorV1',
    updatedAt: new Date().toISOString(),
    clientCount: options.clientCount,
    children: 0,
    freezeStarted: false,
    note: 'Supervisor starting HTTP on-demand clients.',
  })
  spawnNext(1)
  tick()
}

const options = parseArgs(process.argv.slice(2))
mkdirSync(options.dataDir, { recursive: true })
const archives = loadArchives(options.archivesFile)
if (options.mode === 'client') runClient(options, archives)
else runSupervisor(options, archives)
