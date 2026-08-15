import {
  ARCHIVE_ATTEST_QUORUM,
  LAB_EPOCH,
  LAB_GROUP_ID,
  LAB_MINERS,
  LAB_SELECTION_NOTE,
  LAB_SHARD_ID,
  MIN_WAIT_POOL,
  drawCommittee,
  normalizeAddress,
  sameHexList,
  type DrawResult,
  type SelectionLog,
  type SelectionView,
  type WaitMiner,
  type WaitingPoolView,
} from '../../shared/ondemand/index.js'
import type { Hex } from '../../shared/bytes.js'
import type { ArchiveStore } from '../store.js'
import { signLabPoolAttest, verifyLabPoolAttest, type PoolAttest } from './mac.js'

const GOSSIP_MS = 1_000
const GOSSIP_AFTER_ENDORSED_MS = 5_000
const REQUEST_TIMEOUT_MS = 2_000

export interface OnDemandPeer {
  domainId: string
  host: string
  port: number
  role: string
}

export interface OnDemandOptions {
  domainId: string
  role: string
  peers: OnDemandPeer[]
  store: ArchiveStore
  groupId?: string
  epoch?: number
  shardId?: string
  autoSeedLabMiners?: boolean
  autoFreeze?: boolean
  beacon?: Hex
  fetchImpl?: typeof fetch
}

export interface OnDemandHealth {
  ondemandFrozen: boolean
  ondemandMinerCount: number
  ondemandCommitteeCount: number
  ondemandStandbyCount: number
  ondemandAttestCount: number
  ondemandEndorsed: boolean
  ondemandPoolRoot: Hex
}

export interface OnDemandEngine {
  start(): Promise<void>
  stop(): void
  hook(body: unknown): { status: number; body: unknown }
  freeze(): { status: number; body: unknown }
  ingest(body: unknown): { ok: boolean; error?: string }
  health(): OnDemandHealth
  pool(): WaitingPoolView
  selection(): SelectionView
  facadeViews(): { waitingPool: WaitingPoolView; selectionLog: SelectionView }
  get(pathname: string): Record<string, unknown> | undefined
  post(pathname: string, body: unknown): { status: number; body: unknown } | undefined
}

interface PersistedOnDemand {
  schema: 'DleLabOnDemandStateV1'
  miners: WaitMiner[]
  frozen: boolean
  freezeAt: string | null
  attests: PoolAttest[]
  selection: SelectionLog | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseAttest(value: unknown): PoolAttest | null {
  if (!isRecord(value) || value.schema !== 'DleLabPoolAttestV1') return null
  if (typeof value.domainId !== 'string') return null
  if (typeof value.epoch !== 'number' || typeof value.shardId !== 'string') return null
  if (typeof value.poolRoot !== 'string' || typeof value.roulette !== 'string' || typeof value.mac !== 'string') {
    return null
  }
  return {
    schema: 'DleLabPoolAttestV1',
    domainId: value.domainId,
    poolRoot: value.poolRoot as Hex,
    epoch: value.epoch,
    shardId: value.shardId,
    roulette: value.roulette as Hex,
    mac: value.mac as Hex,
  }
}

function parseSelection(value: unknown): SelectionLog | null {
  if (!isRecord(value) || value.schema !== 'DleLabSelectionLogV1' || value.available !== true) return null
  if (typeof value.epoch !== 'number' || typeof value.shardId !== 'string' || typeof value.groupId !== 'string') {
    return null
  }
  if (
    typeof value.poolRoot !== 'string' ||
    typeof value.beacon !== 'string' ||
    typeof value.roulette !== 'string'
  ) {
    return null
  }
  if (!Array.isArray(value.committee) || !value.committee.every((item) => typeof item === 'string')) return null
  if (!Array.isArray(value.standbys) || !value.standbys.every((item) => typeof item === 'string')) return null
  if (!Array.isArray(value.attestors) || !value.attestors.every((item) => typeof item === 'string')) return null
  return {
    schema: 'DleLabSelectionLogV1',
    available: true,
    endorsed: value.endorsed === true,
    epoch: value.epoch,
    shardId: value.shardId,
    groupId: value.groupId,
    poolRoot: value.poolRoot as Hex,
    beacon: value.beacon as Hex,
    roulette: value.roulette as Hex,
    committee: value.committee as Hex[],
    standbys: value.standbys as Hex[],
    attestors: value.attestors as string[],
    quorum: ARCHIVE_ATTEST_QUORUM,
    labBeacon: true,
    labOnly: true,
    note: typeof value.note === 'string' ? value.note : LAB_SELECTION_NOTE,
  }
}

export function createOnDemandEngine(options: OnDemandOptions): OnDemandEngine {
  const role = options.role === 'active' ? 'active' : 'standby'
  const groupId = options.groupId ?? LAB_GROUP_ID
  const epoch = options.epoch ?? LAB_EPOCH
  const shardId = options.shardId ?? LAB_SHARD_ID
  const fetchImpl = options.fetchImpl ?? fetch
  const miners = new Map<string, WaitMiner>()
  const attests = new Map<string, PoolAttest>()
  let frozen = false
  let freezeAt: string | null = null
  let draw: DrawResult | null = null
  let selection: SelectionLog | null = null
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const persisted = options.store.loadOnDemandState() as PersistedOnDemand | null
  if (persisted?.schema === 'DleLabOnDemandStateV1') {
    for (const row of persisted.miners) {
      miners.set(row.address.toLowerCase(), row)
    }
    frozen = persisted.frozen
    freezeAt = persisted.freezeAt
    for (const raw of persisted.attests) {
      const attest = parseAttest(raw)
      if (attest !== null && verifyLabPoolAttest(attest)) attests.set(attest.domainId, attest)
    }
    if (persisted.selection !== null) {
      const loaded = parseSelection(persisted.selection)
      if (loaded !== null) selection = loaded
    }
    if (frozen && miners.size >= MIN_WAIT_POOL) {
      draw = computeDraw()
    }
  }

  function minerList(): Hex[] {
    return [...miners.keys()].sort() as Hex[]
  }

  function computeDraw(): DrawResult {
    const input: Parameters<typeof drawCommittee>[0] = {
      miners: minerList(),
      epoch,
      shardId,
    }
    if (options.beacon !== undefined) input.beacon = options.beacon
    return drawCommittee(input)
  }

  function persist(): void {
    options.store.persistOnDemandState({
      schema: 'DleLabOnDemandStateV1',
      miners: [...miners.values()].sort((left, right) => left.address.localeCompare(right.address)),
      frozen,
      freezeAt,
      attests: [...attests.values()],
      selection,
    })
  }

  function matchingAttestors(): string[] {
    if (draw === null) return []
    return [...attests.values()]
      .filter(
        (row) =>
          row.poolRoot === draw!.poolRoot &&
          row.roulette === draw!.roulette &&
          row.epoch === epoch &&
          row.shardId === shardId &&
          verifyLabPoolAttest(row),
      )
      .map((row) => row.domainId)
      .sort()
  }

  function rebuildSelection(): void {
    if (draw === null) return
    const attestors = matchingAttestors()
    const next: SelectionLog = {
      schema: 'DleLabSelectionLogV1',
      available: true,
      endorsed: attestors.length >= ARCHIVE_ATTEST_QUORUM,
      epoch,
      shardId,
      groupId,
      poolRoot: draw.poolRoot,
      beacon: draw.beacon,
      roulette: draw.roulette,
      committee: draw.committee,
      standbys: draw.standbys,
      attestors,
      quorum: ARCHIVE_ATTEST_QUORUM,
      labBeacon: true,
      labOnly: true,
      note: LAB_SELECTION_NOTE,
    }
    selection = next
    persist()
  }

  function addOwnAttest(): void {
    if (role !== 'active' || draw === null) return
    const unsigned = {
      domainId: options.domainId,
      poolRoot: draw.poolRoot,
      epoch,
      shardId,
      roulette: draw.roulette,
    }
    const attest: PoolAttest = { schema: 'DleLabPoolAttestV1', ...unsigned, mac: signLabPoolAttest(unsigned) }
    attests.set(attest.domainId, attest)
    options.store.appendWal({ type: 'ondemand-attest', domainId: attest.domainId, poolRoot: attest.poolRoot })
    rebuildSelection()
  }

  function applyFreeze(): string | undefined {
    if (frozen) return undefined
    if (miners.size < MIN_WAIT_POOL) return 'ERR_POOL_TOO_SMALL'
    frozen = true
    freezeAt = new Date().toISOString()
    draw = computeDraw()
    options.store.appendWal({ type: 'ondemand-freeze', poolRoot: draw.poolRoot, minerCount: miners.size })
    addOwnAttest()
    persist()
    return undefined
  }

  function seedLabMiners(): void {
    const now = new Date().toISOString()
    for (const address of LAB_MINERS) {
      const key = address.toLowerCase()
      if (miners.has(key)) continue
      miners.set(key, { address, joinNonce: 0, joinedAt: now })
    }
  }

  function hook(body: unknown): { status: number; body: unknown } {
    if (!isRecord(body) || (body.schema !== undefined && body.schema !== 'DleOnDemandHookV1')) {
      return { status: 400, body: { ok: false, error: 'ERR_INVALID_HOOK' } }
    }
    let miner: Hex
    try {
      miner = normalizeAddress(typeof body.miner === 'string' ? body.miner : '')
    } catch {
      return { status: 400, body: { ok: false, error: 'ERR_INVALID_HOOK' } }
    }
    const requestedGroup = typeof body.groupId === 'string' ? body.groupId : groupId
    if (requestedGroup !== groupId) {
      return { status: 400, body: { ok: false, error: 'ERR_UNKNOWN_GROUP' } }
    }
    const key = miner.toLowerCase()
    if (frozen) {
      return {
        status: 409,
        body: {
          ok: false,
          error: 'ERR_POOL_FROZEN',
          status: 'frozen',
          miner,
          groupId,
          pool: pool(),
          selection: selectionView(),
        },
      }
    }
    if (miners.has(key)) {
      return {
        status: 409,
        body: {
          ok: false,
          error: 'ERR_DUPLICATE_HOOK',
          status: 'rejected',
          miner,
          groupId,
          note: 'One in-flight wait hook per (miner, groupId). Duplicate hooks are rejected (anti-hoard).',
        },
      }
    }
    miners.set(key, { address: miner, joinNonce: 0, joinedAt: new Date().toISOString() })
    options.store.appendWal({ type: 'ondemand-hook', miner, groupId })
    persist()
    return {
      status: 200,
      body: {
        ok: true,
        status: 'queued',
        miner,
        groupId,
        slot: minerList().indexOf(miner),
        note: 'Wait hook queued. Freeze poolRoot before drawing 7+2.',
      },
    }
  }

  function freeze(): { status: number; body: unknown } {
    const error = applyFreeze()
    if (error !== undefined) return { status: 400, body: { ok: false, error } }
    return { status: 200, body: { ok: true, frozen: true, pool: pool(), selection: selectionView() } }
  }

  function adoptAttest(raw: unknown): string | undefined {
    const attest = parseAttest(raw)
    if (attest === null) return 'ERR_INVALID_ATTEST'
    if (!verifyLabPoolAttest(attest)) return 'ERR_INVALID_MAC'
    if (draw !== null && (attest.poolRoot !== draw.poolRoot || attest.roulette !== draw.roulette)) {
      return 'ERR_ATTEST_MISMATCH'
    }
    attests.set(attest.domainId, attest)
    rebuildSelection()
    return undefined
  }

  function ingest(body: unknown): { ok: boolean; error?: string } {
    if (!isRecord(body) || body.schema !== 'DleLabOnDemandMessageV1') {
      return { ok: false, error: 'ERR_INVALID_MESSAGE' }
    }
    let error: string | undefined
    if (Array.isArray(body.attests)) {
      for (const raw of body.attests) {
        const next = adoptAttest(raw)
        if (next !== undefined) error = next
      }
    }
    if (draw !== null && body.selection !== undefined && body.selection !== null) {
      const incoming = parseSelection(body.selection)
      if (
        incoming !== null &&
        incoming.poolRoot === draw.poolRoot &&
        incoming.roulette === draw.roulette &&
        sameHexList(incoming.committee, draw.committee) &&
        sameHexList(incoming.standbys, draw.standbys)
      ) {
        for (const id of incoming.attestors) {
          const attest = attests.get(id)
          if (attest) continue
        }
        rebuildSelection()
      }
    }
    return error === undefined ? { ok: true } : { ok: false, error }
  }

  async function gossip(): Promise<void> {
    const payload = {
      schema: 'DleLabOnDemandMessageV1',
      from: options.domainId,
      attests: [...attests.values()],
      selection,
    }
    await Promise.all(
      options.peers
        .filter((peer) => peer.role === 'active' || peer.role === 'standby')
        .map(async (peer) => {
          try {
            await fetchImpl(`http://${peer.host}:${peer.port}/ondemand/message`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', connection: 'close' },
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            })
          } catch {
            /* peer may be restarting */
          }
        }),
    )
  }

  function scheduleGossip(delay: number): void {
    timer = setTimeout(() => {
      void (async () => {
        try {
          await gossip()
        } finally {
          if (!stopped) scheduleGossip(selection?.endorsed === true ? GOSSIP_AFTER_ENDORSED_MS : GOSSIP_MS)
        }
      })()
    }, delay)
  }

  function pool(): WaitingPoolView {
    return {
      schema: 'DleWaitingPoolV1',
      groupId,
      epoch,
      shardId,
      frozen,
      miners: minerList(),
      poolRoot: draw?.poolRoot ?? null,
      minerCount: miners.size,
    }
  }

  function selectionView(): SelectionView {
    if (selection === null) {
      return { schema: 'DleLabSelectionLogV1', available: false, reason: 'Waiting pool is not frozen yet.' }
    }
    return selection
  }

  function health(): OnDemandHealth {
    return {
      ondemandFrozen: frozen,
      ondemandMinerCount: miners.size,
      ondemandCommitteeCount: draw?.committee.length ?? 0,
      ondemandStandbyCount: draw?.standbys.length ?? 0,
      ondemandAttestCount: matchingAttestors().length,
      ondemandEndorsed: selection?.endorsed === true,
      ondemandPoolRoot: draw?.poolRoot ?? (`0x${'00'.repeat(32)}` as Hex),
    }
  }

  return {
    async start() {
      if (options.autoSeedLabMiners === true && miners.size === 0) seedLabMiners()
      if (options.autoFreeze === true) applyFreeze()
      if (frozen && draw !== null && role === 'active' && !attests.has(options.domainId)) addOwnAttest()
      persist()
      scheduleGossip(0)
    },
    stop() {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    },
    hook,
    freeze,
    ingest,
    health,
    pool,
    selection: selectionView,
    facadeViews() {
      return { waitingPool: pool(), selectionLog: selectionView() }
    },
    get(pathname) {
      if (pathname === '/ondemand/pool') return { ...pool() }
      if (pathname === '/ondemand/selection') return { ...selectionView() }
      return undefined
    },
    post(pathname, body) {
      if (pathname === '/ondemand/hook') return hook(body)
      if (pathname === '/ondemand/freeze') return freeze()
      if (pathname === '/ondemand/message') {
        const result = ingest(body)
        return { status: result.ok ? 200 : 400, body: result }
      }
      return undefined
    },
  }
}
