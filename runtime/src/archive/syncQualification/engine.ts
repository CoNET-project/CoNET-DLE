import { isHashObjectKind, sameGroupId, type HashLocatorV1 } from '../../shared/hashLookup.js'
import type { LabRouteTable } from '../../shared/labRoute.js'
import { isFreezerSlot, projectHashObject } from '../hashStore.js'
import type { ArchiveStore } from '../store.js'
import { probeFinalizedClRandomness, type ClBeaconProbeResult } from './clBeacon.js'
import {
  probeProductionCg,
  productionCgHealthView,
  productionCgOpeningSmoke,
  productionCgStatusFields,
  type ProductionCgProbeResult,
} from './productionCg.js'
import {
  answerChallengeLocal,
  bindChallengeBeacon,
  challengeCoversLiveOpening,
  challengeHashOf,
  challengeSamplesMatchSeed,
  freezeChallengeRoots,
  freezeMatchesInventory,
  gradeChallenge,
  isHmacChallenge,
  isSyncChallengerMissingReason,
  labCgOpeningView,
  postFreezeRevealSalt,
  verifyEip712Challenge,
} from './challenge.js'
import { snapshotInventory, statusRootsMatch } from './inventory.js'
import {
  buildCertificate,
  isHmacSeatingVote,
  makeSyncVote,
  uniqueAcceptingSigners,
  verifySyncRejectVote,
  verifySyncVote,
} from './mac.js'
import {
  isHmacStandbyReady,
  makeArchiveStandbyReadiness,
  parseArchiveStandbyReadiness,
  parseStandbyReadyMap,
  verifyEip712StandbyReady,
} from './standbyReady.js'
import {
  ERR_SYNC_CHALLENGE_HMAC_CUTOVER,
  ERR_SYNC_CHALLENGE_SAMPLES,
  ERR_SYNC_STANDBY_HMAC_CUTOVER,
  ERR_SYNC_STANDBY_ROLE,
  ERR_SYNC_STANDBY_ROOT,
  LAB_SYNC_MAX_HOSTED_CHAINS,
  LAB_SYNC_OPEN_ALL_HOSTED_CHAINS,
  OFFICIAL_STANDBY_COUNT,
  SYNC_CATCHUP_BATCH,
  SYNC_QUALIFIED_CATCHUP_MIN_MS,
  SYNC_CHALLENGE_TIMEOUT_MS,
  SYNC_QUORUM,
  SYNC_STATUS_TIMEOUT_MS,
  SYNC_TICK_MS,
  isOfficialStandbyRole,
  type ArchiveStandbyReadinessEnvelope,
  type ArchiveStateChallengeV1,
  type ArchiveSyncFreezeV1,
  type ArchiveSyncQualificationCertificateV1,
  type ArchiveSyncVoteV1,
  type SyncInventoryV1,
  type SyncPeer,
  type SyncPhase,
  type SyncRosterRowV1,
  type SyncStatusV1,
} from './types.js'

export interface SyncEngineOptions {
  domainId: string
  role: string
  peers: SyncPeer[]
  store: ArchiveStore
  table: LabRouteTable
  fetchImpl?: typeof fetch
  onQualified?: () => void
  tickMs?: number
  clBeaconProbe?: () => ClBeaconProbeResult
  productionCgProbe?: (inventory: SyncInventoryV1) => ProductionCgProbeResult
  postFreezeRevealMaterial?: () => string
}

export interface SyncQualificationEngine {
  start(): Promise<void>
  stop(): void
  tick(): Promise<void>
  phase(): SyncPhase
  seatingQualified(): boolean
  hopForbidden(): boolean
  markHopDuringChallenge(): void
  status(): SyncStatusV1
  inventory(): SyncInventoryV1
  opening(): Record<string, unknown>
  roster(): SyncRosterRowV1[]
  alignedQualifiedCount(): number
  hasUnseatedActive(): boolean
  inventoryShouldFreeze(): boolean
  health(): Record<string, unknown>
  handleChallenge(body: unknown): { ok: boolean; error?: string; answer?: unknown }
  handleVote(body: unknown): { ok: boolean; error?: string; seatingQualified?: boolean }
  handleReject(body: unknown): { ok: boolean; error?: string }
  handleStandbyReady(body: unknown): { ok: boolean; error?: string }
  officialStandbyReadyCount(): number
  officialStandbysReady(): boolean
  claimSync(): boolean
}

interface PersistedSync {
  schema: 'DleLabSyncQualificationStateV1'
  phase: SyncPhase
  nonce: number
  rejectReason: string | null
  certificate: ArchiveSyncQualificationCertificateV1 | null
  pendingChallenge?: ArchiveStateChallengeV1 | null
  pendingFreeze?: ArchiveSyncFreezeV1 | null
  holdClaimed?: boolean
  standbyReady?: Record<string, ArchiveStandbyReadinessEnvelope>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function activeDomainIds(domainId: string, role: string, peers: readonly SyncPeer[]): string[] {
  const ids = peers.filter((peer) => peer.role === 'active').map((peer) => peer.domainId)
  if (role === 'active' && !ids.includes(domainId)) ids.push(domainId)
  return [...new Set(ids)].sort()
}

function locatorBodyHeld(store: ArchiveStore, locator: HashLocatorV1): boolean {
  if (store.hash.getLocator(locator.hash) === null) return false
  if (!isHashObjectKind(locator.kind)) return true
  return projectHashObject(store.hash.getBody(locator.chainNftId, locator.height), locator.kind) !== undefined
}

function slotHasKind(object: unknown, kind: HashLocatorV1['kind']): boolean {
  if (!isHashObjectKind(kind)) return true
  if (isFreezerSlot(object)) return object.objects[kind] !== undefined
  return kind === 'ac'
}

function ingestObject(store: ArchiveStore, locator: HashLocatorV1, object: unknown): void {
  if (isFreezerSlot(object)) {
    for (const [kind, body] of Object.entries(object.objects)) {
      if (isHashObjectKind(kind) && body !== undefined) {
        store.hash.putBody(locator.chainNftId, locator.height, body, kind)
      }
    }
    if (!slotHasKind(object, locator.kind)) return
    store.hash.putLocator(locator)
    return
  }
  store.hash.putLocator(locator)
  store.hash.putBody(locator.chainNftId, locator.height, object, locator.kind)
}

export function createSyncQualificationEngine(options: SyncEngineOptions): SyncQualificationEngine {
  const fetchImpl = options.fetchImpl ?? fetch
  const actives = activeDomainIds(options.domainId, options.role, options.peers)
  let phase: SyncPhase = 'SYNCING'
  let nonce = 1
  let rejectReason: string | null = null
  let certificate: ArchiveSyncQualificationCertificateV1 | null = null
  let pendingChallenge: ArchiveStateChallengeV1 | null = null
  let pendingFreeze: ArchiveSyncFreezeV1 | null = null
  let holdClaimed = false
  let votes: ArchiveSyncVoteV1[] = []
  let rosterRows: SyncRosterRowV1[] = []
  let hopDuringChallenge = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  let qualifiedNotified = false
  let inventoryCache: { locatorCount: number; value: SyncInventoryV1 } | null = null
  let voteCursor = 0
  let lastQualifiedCatchUpAt = 0
  let standbyReady: Record<string, ArchiveStandbyReadinessEnvelope> = {}

  const persisted = options.store.loadSyncQualificationState() as PersistedSync | null
  if (persisted?.schema === 'DleLabSyncQualificationStateV1') {
    nonce = persisted.nonce
    rejectReason = persisted.rejectReason
    certificate = persisted.certificate
    pendingChallenge = persisted.pendingChallenge ?? null
    if (pendingChallenge !== null && !verifyEip712Challenge(pendingChallenge).ok) {
      pendingChallenge = null
    }
    pendingFreeze = persisted.pendingFreeze ?? null
    holdClaimed = persisted.holdClaimed === true
    standbyReady = parseStandbyReadyMap(persisted.standbyReady)
    if (persisted.phase === 'REJECTED') {
      phase = 'SYNCING'
      rejectReason = null
      certificate = null
      pendingChallenge = null
      pendingFreeze = null
      holdClaimed = false
    } else {
      phase = persisted.phase === 'STATE_CHALLENGE' ? 'CLAIMED_SYNC' : persisted.phase
    }
  }

  function inventoryNow(): SyncInventoryV1 {
    const locatorCount = options.store.hash.locatorCount()
    if (inventoryCache !== null && (inventoryCache.locatorCount === locatorCount || options.store.hash.isBatching())) {
      return inventoryCache.value
    }
    const value = snapshotInventory({
      store: options.store.hash,
      table: options.table,
      domainId: options.domainId,
      activeDomainIds: actives,
    })
    inventoryCache = { locatorCount, value }
    return value
  }

  function productionCgNow(inventory: SyncInventoryV1): ProductionCgProbeResult {
    return (
      options.productionCgProbe?.(inventory) ??
      probeProductionCg({ labHostedChainNftIds: inventory.chainNftIds })
    )
  }

  function persist(): void {
    options.store.persistSyncQualificationState({
      schema: 'DleLabSyncQualificationStateV1',
      phase,
      nonce,
      rejectReason,
      certificate,
      pendingChallenge,
      pendingFreeze,
      holdClaimed,
      standbyReady,
    })
  }

  function bindPendingFreeze(inventory: SyncInventoryV1, freeze: ArchiveSyncFreezeV1): ArchiveStateChallengeV1 {
    const revealMaterial = options.postFreezeRevealMaterial?.() ?? `${Date.now()}`
    pendingChallenge = bindChallengeBeacon({
      freeze,
      inventory,
      revealSalt: postFreezeRevealSalt({
        domainId: options.domainId,
        freezeHex: freeze.freezeHex,
        frozenAt: freeze.frozenAt,
        revealMaterial,
      }),
      probe: options.clBeaconProbe?.() ?? probeFinalizedClRandomness(),
    })
    pendingFreeze = null
    nonce += 1
    persist()
    return pendingChallenge
  }

  function ensurePendingChallenge(): ArchiveStateChallengeV1 {
    const inventory = inventoryNow()
    if (
      pendingChallenge !== null &&
      verifyEip712Challenge(pendingChallenge).ok &&
      statusRootsMatch(inventory, pendingChallenge) &&
      challengeCoversLiveOpening(pendingChallenge, inventory) &&
      challengeSamplesMatchSeed(pendingChallenge, inventory)
    ) {
      return pendingChallenge
    }
    if (pendingFreeze !== null && freezeMatchesInventory(pendingFreeze, inventory)) {
      persist()
      return bindPendingFreeze(inventory, pendingFreeze)
    }
    pendingFreeze = freezeChallengeRoots({
      inventory,
      candidate: options.domainId,
      challenger: options.domainId,
      nonce,
    })
    pendingChallenge = null
    persist()
    return bindPendingFreeze(inventory, pendingFreeze)
  }

  function enterClaimedSync(hold: boolean): void {
    phase = 'CLAIMED_SYNC'
    rejectReason = null
    if (hold) holdClaimed = true
    ensurePendingChallenge()
    persist()
  }

  function notifyQualified(): void {
    if (qualifiedNotified || phase !== 'QUALIFIED') return
    qualifiedNotified = true
    options.onQualified?.()
  }

  function adoptCertificate(next: ArchiveSyncQualificationCertificateV1): void {
    certificate = next
    phase = 'QUALIFIED'
    rejectReason = null
    persist()
    options.store.appendWal({
      type: 'sync-qualified',
      domainId: options.domainId,
      challengeHash: next.challengeHash,
      notThirtyDayQualification: true,
    })
    notifyQualified()
    void gossipOwnStandbyReady()
  }

  function returnToSyncing(): void {
    phase = 'SYNCING'
    rejectReason = null
    pendingChallenge = null
    pendingFreeze = null
    persist()
  }

  function reject(reason: string): void {
    // Whitepaper missing-object is the candidate's miss, not the voter's.
    if (isSyncChallengerMissingReason(reason)) return
    // Growing freezer: auto-claim roots / proofs can drift. Catch up again.
    // Explicit claimSync() (holdClaimed) is a false claim → terminal.
    // Hop during the opening is always terminal.
    if (
      !holdClaimed &&
      reason !== 'ERR_SYNC_HOP_DURING_CHALLENGE' &&
      (reason.startsWith('ERR_SYNC_ROOT_MISMATCH') ||
        reason.startsWith('ERR_SYNC_INDEX_PROOF') ||
        reason.startsWith('ERR_SYNC_OBJECT_MISMATCH') ||
        reason.startsWith('ERR_SYNC_SEED_MISMATCH'))
    ) {
      returnToSyncing()
      return
    }
    phase = 'REJECTED'
    rejectReason = reason
    persist()
    options.store.appendWal({ type: 'sync-rejected', domainId: options.domainId, reason })
  }

  function restoreIfCertificateHolds(): void {
    if (certificate === null) return
    if (certificate.candidate !== options.domainId) {
      certificate = null
      return
    }
    // Seating binds the challenge-time inventory. Later appends must not unseat.
    phase = 'QUALIFIED'
    rejectReason = null
  }

  async function readJson(url: string, timeoutMs = SYNC_STATUS_TIMEOUT_MS): Promise<unknown | null> {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) })
      if (!response.ok) return null
      return (await response.json()) as unknown
    } catch {
      return null
    }
  }

  async function postJson(url: string, body: unknown): Promise<unknown | null> {
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(SYNC_CHALLENGE_TIMEOUT_MS),
      })
      if (!response.ok) return null
      return (await response.json()) as unknown
    } catch {
      return null
    }
  }

  function parseStatus(value: unknown): SyncRosterRowV1 | null {
    if (!isRecord(value) || typeof value.domainId !== 'string' || typeof value.phase !== 'string') {
      return null
    }
    return {
      domainId: value.domainId,
      ...(typeof value.role === 'string' ? { role: value.role } : {}),
      phase: value.phase as SyncPhase,
      seatingQualified: value.seatingQualified === true,
      lastQuorumOkIsNotSeating: true,
      ...(typeof value.groupId === 'string' ? { groupId: value.groupId } : {}),
      ...(typeof value.leafCount === 'number' ? { leafCount: value.leafCount } : {}),
      ...(typeof value.hostedChainSetRoot === 'string'
        ? { hostedChainSetRoot: value.hostedChainSetRoot as SyncInventoryV1['hostedChainSetRoot'] }
        : {}),
      ...(typeof value.lastACRef === 'string' ? { lastACRef: value.lastACRef as SyncInventoryV1['lastACRef'] } : {}),
      ...(typeof value.membershipRoot === 'string'
        ? { membershipRoot: value.membershipRoot as SyncInventoryV1['membershipRoot'] }
        : {}),
      ...(typeof value.hashIndexRoot === 'string'
        ? { hashIndexRoot: value.hashIndexRoot as SyncInventoryV1['hashIndexRoot'] }
        : {}),
    }
  }

  function parseInventory(value: unknown): SyncInventoryV1 | null {
    if (!isRecord(value) || value.schema !== 'DleLabSyncInventoryV1') return null
    if (!Array.isArray(value.locators) || !Array.isArray(value.chainNftIds)) return null
    if (
      typeof value.hostedChainSetRoot !== 'string' ||
      typeof value.lastACRef !== 'string' ||
      typeof value.membershipRoot !== 'string' ||
      typeof value.hashIndexRoot !== 'string' ||
      typeof value.groupId !== 'string'
    ) {
      return null
    }
    return value as unknown as SyncInventoryV1
  }

  function localRosterRow(): SyncRosterRowV1 {
    const inventory = inventoryNow()
    return {
      domainId: options.domainId,
      role: options.role,
      phase,
      seatingQualified: phase === 'QUALIFIED',
      lastQuorumOkIsNotSeating: true,
      groupId: inventory.groupId,
      leafCount: inventory.leafCount,
      hostedChainSetRoot: inventory.hostedChainSetRoot,
      lastACRef: inventory.lastACRef,
      membershipRoot: inventory.membershipRoot,
      hashIndexRoot: inventory.hashIndexRoot,
    }
  }

  async function refreshRoster(): Promise<void> {
    const rows: SyncRosterRowV1[] = [localRosterRow()]
    await Promise.all(
      options.peers.map(async (peer) => {
        const row = parseStatus(await readJson(`${peer.url.replace(/\/$/, '')}/sync/status`))
        if (row !== null) rows.push(row)
      }),
    )
    rosterRows = rows
  }

  function bootstrapVotersExist(): boolean {
    return !rosterRows.some((row) => row.seatingQualified && row.domainId !== options.domainId)
  }

  function peerRole(domainId: string): string {
    if (domainId === options.domainId) return options.role
    return options.peers.find((peer) => peer.domainId === domainId)?.role ?? ''
  }

  function standbyRootsMatch(
    envelope: ArchiveStandbyReadinessEnvelope,
    inventory: SyncInventoryV1,
  ): boolean {
    return (
      envelope.groupId === inventory.groupId &&
      envelope.hostedChainSetRoot === inventory.hostedChainSetRoot &&
      envelope.lastACRef === inventory.lastACRef &&
      envelope.membershipRoot === inventory.membershipRoot &&
      envelope.hashIndexRoot === inventory.hashIndexRoot
    )
  }

  function officialStandbyReadyCount(): number {
    const inventory = inventoryNow()
    let count = 0
    for (const [domainId, envelope] of Object.entries(standbyReady)) {
      if (!isOfficialStandbyRole(domainId, peerRole(domainId))) continue
      if (isHmacStandbyReady(envelope)) continue
      if (!verifyEip712StandbyReady(envelope).ok) continue
      if (envelope.ready !== true) continue
      if (!standbyRootsMatch(envelope, inventory)) continue
      count += 1
    }
    return count
  }

  function officialStandbysReady(): boolean {
    return officialStandbyReadyCount() >= OFFICIAL_STANDBY_COUNT
  }

  function handleStandbyReady(body: unknown): { ok: boolean; error?: string } {
    const parsed = parseArchiveStandbyReadiness(body)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    if (isHmacStandbyReady(parsed.envelope)) {
      return { ok: false, error: ERR_SYNC_STANDBY_HMAC_CUTOVER }
    }
    const verified = verifyEip712StandbyReady(parsed.envelope)
    if (!verified.ok) return { ok: false, error: verified.error }
    if (peerRole(parsed.envelope.domainId) !== 'standby') {
      return { ok: false, error: ERR_SYNC_STANDBY_ROLE }
    }
    if (!standbyRootsMatch(parsed.envelope, inventoryNow())) {
      return { ok: false, error: ERR_SYNC_STANDBY_ROOT }
    }
    standbyReady[parsed.envelope.domainId] = parsed.envelope
    persist()
    return { ok: true }
  }

  async function gossipOwnStandbyReady(): Promise<void> {
    if (phase !== 'QUALIFIED') return
    if (!isOfficialStandbyRole(options.domainId, options.role)) return
    const inventory = inventoryNow()
    const existing = standbyReady[options.domainId]
    const reusable =
      existing !== undefined &&
      !isHmacStandbyReady(existing) &&
      verifyEip712StandbyReady(existing).ok &&
      existing.ready === true &&
      standbyRootsMatch(existing, inventory)
    const envelope = reusable
      ? existing
      : makeArchiveStandbyReadiness({
          domainId: options.domainId,
          groupId: inventory.groupId,
          hostedChainSetRoot: inventory.hostedChainSetRoot,
          lastACRef: inventory.lastACRef,
          membershipRoot: inventory.membershipRoot,
          hashIndexRoot: inventory.hashIndexRoot,
          ready: true,
        })
    if (!reusable) {
      standbyReady[options.domainId] = envelope
      persist()
    }
    await Promise.all(
      options.peers.map((peer) =>
        postJson(`${peer.url.replace(/\/$/, '')}/sync/standby-ready`, envelope),
      ),
    )
  }

  function alignedQualifiedCount(): number {
    const local = localRosterRow()
    return rosterRows.filter(
      (row) =>
        row.seatingQualified &&
        (row.role ?? peerRole(row.domainId)) === 'active' &&
        statusRootsMatch(local, row),
    ).length
  }

  function hasUnseatedActive(): boolean {
    if (options.role === 'active' && phase !== 'QUALIFIED') return true
    const activeIds = new Set<string>()
    if (options.role === 'active') activeIds.add(options.domainId)
    for (const peer of options.peers) {
      if (peer.role === 'active') activeIds.add(peer.domainId)
    }
    for (const id of activeIds) {
      if (id === options.domainId) continue
      const row = rosterRows.find((item) => item.domainId === id)
      if (row === undefined) return true
      if ((row.role ?? peerRole(id)) === 'active' && !row.seatingQualified) return true
    }
    return false
  }

  function inventoryShouldFreeze(): boolean {
    if (hasUnseatedActive()) return true
    if (phase === 'STATE_CHALLENGE') return true
    return rosterRows.some((row) => row.phase === 'STATE_CHALLENGE')
  }

  function canVote(): boolean {
    if (options.role !== 'active') return false
    if (phase === 'QUALIFIED') return true
    if (phase !== 'CLAIMED_SYNC' && phase !== 'STATE_CHALLENGE') return false
    if (inventoryNow().leafCount <= 0) return false
    const qualified = alignedQualifiedCount()
    return qualified < SYNC_QUORUM || bootstrapVotersExist()
  }

  function sameGroupRow(row: SyncRosterRowV1): boolean {
    if (row.domainId === options.domainId) return false
    if (row.groupId === undefined || row.groupId === '') return false
    return sameGroupId(row.groupId, options.table.ownGroupId)
  }

  function rankedSameGroupRows(): SyncRosterRowV1[] {
    const candidates = rosterRows.filter(sameGroupRow)
    const rootPop = new Map<string, number>()
    for (const row of candidates) {
      const key = row.hashIndexRoot ?? ''
      rootPop.set(key, (rootPop.get(key) ?? 0) + 1)
    }
    return [...candidates].sort((left, right) => {
      const leaf = (right.leafCount ?? 0) - (left.leafCount ?? 0)
      if (leaf !== 0) return leaf
      const pop =
        (rootPop.get(right.hashIndexRoot ?? '') ?? 0) - (rootPop.get(left.hashIndexRoot ?? '') ?? 0)
      if (pop !== 0) return pop
      return Number(right.seatingQualified) - Number(left.seatingQualified)
    })
  }

  function richestSameGroupRow(): SyncRosterRowV1 | null {
    return rankedSameGroupRows()[0] ?? null
  }

  async function fetchPeerInventory(domainId: string): Promise<SyncInventoryV1 | null> {
    const peer = options.peers.find((item) => item.domainId === domainId)
    if (peer === undefined) return null
    const parsed = parseInventory(
      await readJson(`${peer.url.replace(/\/$/, '')}/sync/inventory`, SYNC_CHALLENGE_TIMEOUT_MS),
    )
    if (parsed === null) return null
    if (!sameGroupId(parsed.groupId, options.table.ownGroupId)) return null
    return parsed
  }

  async function fetchHeightObject(domainId: string, chainNftId: string, height: string): Promise<unknown | null> {
    const peer = options.peers.find((row) => row.domainId === domainId)
    if (peer === undefined) return null
    try {
      const response = await fetchImpl(`${peer.url.replace(/\/$/, '')}/rpc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'dle_getObject',
          params: [chainNftId, height],
        }),
        signal: AbortSignal.timeout(2_500),
      })
      if (!response.ok) return null
      const parsed = (await response.json()) as unknown
      if (!isRecord(parsed) || !isRecord(parsed.result) || parsed.result.status !== 'hit') return null
      return parsed.result.object
    } catch {
      return null
    }
  }

  async function catchUp(target: SyncInventoryV1, donorDomainId: string): Promise<void> {
    const missing = target.locators.filter((locator) => !locatorBodyHeld(options.store, locator))
    const keys = new Map<string, HashLocatorV1[]>()
    for (const locator of missing) {
      const key = `${locator.chainNftId}:${locator.height}`
      const list = keys.get(key) ?? []
      list.push(locator)
      keys.set(key, list)
    }
    const donorIds = [donorDomainId, ...rankedSameGroupRows().map((row) => row.domainId)].filter(
      (id, index, all) => id !== options.domainId && all.indexOf(id) === index,
    )
    if (donorIds.length === 0) return
    options.store.hash.beginBatch()
    try {
      let pulled = 0
      for (const locators of keys.values()) {
        if (pulled >= SYNC_CATCHUP_BATCH) break
        const first = locators[0]!
        let best: unknown = null
        for (const donor of donorIds) {
          const object = await fetchHeightObject(donor, first.chainNftId, first.height)
          if (object === null) continue
          if (best === null) best = object
          if (locators.every((locator) => slotHasKind(object, locator.kind))) {
            best = object
            break
          }
        }
        if (best === null) continue
        for (const locator of locators) ingestObject(options.store, locator, best)
        pulled += 1
        if (pulled % 16 === 0) {
          await new Promise<void>((resolve) => {
            setImmediate(resolve)
          })
        }
      }
    } finally {
      options.store.hash.endBatch()
    }
  }

  function parseChallenge(value: unknown): ArchiveStateChallengeV1 | null {
    if (!isRecord(value) || value.schema !== 'ArchiveStateChallengeV1') return null
    if (typeof value.candidate !== 'string' || typeof value.seed !== 'string') return null
    const challenge = value as unknown as ArchiveStateChallengeV1
    if (!verifyEip712Challenge(challenge).ok) return null
    return challenge
  }

  function nextVoteCandidate(phases: readonly SyncPhase[]): string | null {
    const ids = rosterRows
      .filter((row) => row.domainId !== options.domainId && phases.includes(row.phase))
      .map((row) => row.domainId)
      .sort()
    if (ids.length === 0) return null
    const pick = ids[voteCursor % ids.length]
    voteCursor += 1
    return pick ?? null
  }

  async function challengeCandidate(candidate: string): Promise<void> {
    const peer = options.peers.find((row) => row.domainId === candidate)
    if (peer === undefined || candidate === options.domainId) return
    const status = await readJson(`${peer.url.replace(/\/$/, '')}/sync/status`)
    const challenge = isRecord(status) ? parseChallenge(status.pendingChallenge) : null
    if (challenge === null || challenge.candidate !== candidate) return
    const local = inventoryNow()
    const challengeMatchesLive = statusRootsMatch(local, challenge)
    const challengeMatchesSeat =
      certificate !== null &&
      statusRootsMatch(
        {
          groupId: certificate.groupId,
          hostedChainSetRoot: certificate.hostedChainSetRoot,
          lastACRef: certificate.lastACRef,
          membershipRoot: certificate.membershipRoot,
          hashIndexRoot: certificate.hashIndexRoot,
        },
        challenge,
      )
    if (!challengeMatchesLive && !challengeMatchesSeat) {
      // Auto-claim peers self-demote when the richest moves. Only an
      // explicit claimSync() is a false inventory claim.
      if (phase === 'QUALIFIED' && isRecord(status) && status.holdClaimed === true) {
        const vote = makeSyncVote({
          domainId: options.domainId,
          candidate,
          challengeHash: challengeHashOf(challenge),
          accept: false,
          groupId: challenge.groupId,
          hostedChainSetRoot: challenge.hostedChainSetRoot,
          lastACRef: challenge.lastACRef,
          membershipRoot: challenge.membershipRoot,
          hashIndexRoot: challenge.hashIndexRoot,
        })
        await postJson(`${peer.url.replace(/\/$/, '')}/sync/reject`, {
          ...vote,
          reason: 'ERR_SYNC_ROOT_MISMATCH',
        })
      }
      return
    }
    if (!challengeSamplesMatchSeed(challenge, local)) return
    const replied = await postJson(`${peer.url.replace(/\/$/, '')}/sync/challenge`, challenge)
    if (!isRecord(replied) || replied.ok !== true || !isRecord(replied.answer)) return
    const graded = gradeChallenge({
      challenge,
      answer: replied.answer as never,
      expected: local,
      store: options.store.hash,
    })
    const vote = makeSyncVote({
      domainId: options.domainId,
      candidate,
      challengeHash: challengeHashOf(challenge),
      accept: graded.ok,
      groupId: challenge.groupId,
      hostedChainSetRoot: challenge.hostedChainSetRoot,
      lastACRef: challenge.lastACRef,
      membershipRoot: challenge.membershipRoot,
      hashIndexRoot: challenge.hashIndexRoot,
    })
    if (!graded.ok) {
      if (isSyncChallengerMissingReason(graded.reason)) return
      await postJson(`${peer.url.replace(/\/$/, '')}/sync/reject`, { ...vote, reason: graded.reason })
      return
    }
    await postJson(`${peer.url.replace(/\/$/, '')}/sync/vote`, vote)
  }

  async function tickWork(): Promise<void> {
    if (phase === 'REJECTED') {
      await refreshRoster()
      return
    }
    restoreIfCertificateHolds()
    await refreshRoster()
    const targetRow = richestSameGroupRow()
    const local = inventoryNow()
    if (targetRow !== null && !statusRootsMatch(local, targetRow) && !holdClaimed) {
      if (phase !== 'QUALIFIED') {
        phase = 'SYNCING'
        pendingChallenge = null
      }
      const now = Date.now()
      const skipQualifiedCatchUp =
        phase === 'QUALIFIED' &&
        lastQualifiedCatchUpAt > 0 &&
        now - lastQualifiedCatchUpAt < SYNC_QUALIFIED_CATCHUP_MIN_MS
      if (!skipQualifiedCatchUp) {
        if (phase === 'QUALIFIED') lastQualifiedCatchUpAt = now
        const target = await fetchPeerInventory(targetRow.domainId)
        if (target !== null && !statusRootsMatch(inventoryNow(), target)) {
          await catchUp(target, targetRow.domainId)
        }
      }
    } else if (targetRow !== null && statusRootsMatch(local, targetRow)) {
      if (phase === 'SYNCING') enterClaimedSync(false)
    } else if (targetRow === null && local.leafCount > 0 && options.peers.length === 0) {
      if (phase === 'SYNCING') enterClaimedSync(false)
    }
    if (phase === 'QUALIFIED') {
      notifyQualified()
      await gossipOwnStandbyReady()
      await refreshRoster()
      if (canVote()) {
        const candidate = nextVoteCandidate(['CLAIMED_SYNC'])
        if (candidate !== null) await challengeCandidate(candidate)
      }
      return
    }
    persist()
    await refreshRoster()
    if (phase === 'CLAIMED_SYNC' && canVote()) {
      const candidate = nextVoteCandidate(['CLAIMED_SYNC', 'STATE_CHALLENGE'])
      if (candidate !== null) await challengeCandidate(candidate)
    }
  }

  return {
    async start() {
      persist()
      notifyQualified()
      const loop = (delay: number): void => {
        timer = setTimeout(() => {
          void (async () => {
            try {
              if (!stopped) await tickWork()
            } finally {
              if (!stopped) loop(options.tickMs ?? SYNC_TICK_MS)
            }
          })()
        }, delay)
      }
      loop(0)
    },
    stop() {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
    },
    tick: tickWork,
    phase: () => phase,
    seatingQualified: () => phase === 'QUALIFIED',
    hopForbidden: () => phase === 'STATE_CHALLENGE',
    markHopDuringChallenge() {
      hopDuringChallenge = true
    },
    status() {
      if (phase === 'CLAIMED_SYNC' || phase === 'QUALIFIED') {
        ensurePendingChallenge()
      }
      const inventory = inventoryNow()
      const productionCg = productionCgNow(inventory)
      return {
        schema: 'ArchiveSyncQualificationLabV1',
        labOnly: true,
        lastQuorumOkIsNotSeating: true,
        notThirtyDayQualification: true,
        hmacForgeable: false,
        seatingEip712: true,
        challengeEip712: true,
        standbyReadyEip712: true,
        officialStandbyReadyCount: officialStandbyReadyCount(),
        officialStandbysReady: officialStandbysReady(),
        extraStandbyReadyDoesNotCount: true,
        notL1Settled: true,
        notClRandao: true,
        freezeBeforeBeacon: true,
        labBeaconAfterFreeze: true,
        notProductionBeacon: true,
        publicrpcNotClRandao: true,
        ...productionCgStatusFields(productionCg),
        domainId: options.domainId,
        role: options.role,
        phase,
        seatingQualified: phase === 'QUALIFIED',
        groupId: inventory.groupId,
        hostedChainSetRoot: inventory.hostedChainSetRoot,
        lastACRef: inventory.lastACRef,
        membershipRoot: inventory.membershipRoot,
        hashIndexRoot: inventory.hashIndexRoot,
        leafCount: inventory.leafCount,
        nonce,
        holdClaimed,
        rejectReason,
        certificate,
        pendingChallenge,
      }
    },
    inventory: inventoryNow,
    opening() {
      const inventory = inventoryNow()
      const view = labCgOpeningView(inventory, inventory.hashIndexRoot)
      const productionCg = productionCgNow(inventory)
      return {
        schema: 'DleLabCgOpeningV1',
        labOnly: true,
        eip712: true,
        hmacForgeable: false,
        challengeEip712: true,
        notProductionCg: true,
        labHostedSetNotProductionCg: true,
        publicrpcNotProductionCg: true,
        notThirtyDayQualification: true,
        policy: LAB_SYNC_OPEN_ALL_HOSTED_CHAINS || LAB_SYNC_MAX_HOSTED_CHAINS <= 0 ? 'all-hosted' : 'capped',
        cap: LAB_SYNC_MAX_HOSTED_CHAINS,
        hostedChainCount: view.hostedChainCount,
        openedChainCount: view.openedChainCount,
        openedAllHostedChains: view.openedAllHostedChains,
        sampleCount: view.sampleCount,
        productionCg: productionCgOpeningSmoke({
          probe: productionCg,
          seed: inventory.hashIndexRoot,
          locators: inventory.locators,
        }),
      }
    },
    roster: () => rosterRows,
    alignedQualifiedCount,
    hasUnseatedActive,
    inventoryShouldFreeze,
    health() {
      const inventory = inventoryNow()
      const productionCg = productionCgNow(inventory)
      return {
        seatingQualified: phase === 'QUALIFIED',
        lastQuorumOkIsNotSeating: true,
        inventoryFrozen: inventoryShouldFreeze(),
        hostedChainCount: inventory.chainNftIds.length,
        labCgOpening: LAB_SYNC_OPEN_ALL_HOSTED_CHAINS || LAB_SYNC_MAX_HOSTED_CHAINS <= 0 ? 'all-hosted' : 'capped',
        labCgOpeningNotProduction: true,
        labHostedSetNotProductionCg: true,
        publicrpcNotProductionCg: true,
        productionCgAvailable: productionCg.available,
        hasUnseatedActive: hasUnseatedActive(),
        alignedQualifiedCount: alignedQualifiedCount(),
        productionCg: productionCgHealthView(productionCg),
        syncQualification: {
          schema: 'ArchiveSyncQualificationLabV1',
          labOnly: true,
          lastQuorumOkIsNotSeating: true,
          notThirtyDayQualification: true,
          hmacForgeable: false,
          seatingEip712: true,
          challengeEip712: true,
          standbyReadyEip712: true,
          officialStandbyReadyCount: officialStandbyReadyCount(),
          officialStandbysReady: officialStandbysReady(),
          extraStandbyReadyDoesNotCount: true,
          notL1Settled: true,
          notClRandao: true,
          freezeBeforeBeacon: true,
          labBeaconAfterFreeze: true,
          notProductionBeacon: true,
          publicrpcNotClRandao: true,
          ...productionCgStatusFields(productionCg),
          domainId: options.domainId,
          role: options.role,
          phase,
          seatingQualified: phase === 'QUALIFIED',
          groupId: inventory.groupId,
          hostedChainSetRoot: inventory.hostedChainSetRoot,
          lastACRef: inventory.lastACRef,
          membershipRoot: inventory.membershipRoot,
          hashIndexRoot: inventory.hashIndexRoot,
          leafCount: inventory.leafCount,
          nonce,
          holdClaimed,
          rejectReason,
        },
        syncRoster: rosterRows,
      }
    },
    handleChallenge(body) {
      if (!isRecord(body) || body.schema !== 'ArchiveStateChallengeV1') {
        return { ok: false, error: 'ERR_SYNC_CHALLENGE' }
      }
      if (isHmacChallenge(body)) return { ok: false, error: ERR_SYNC_CHALLENGE_HMAC_CUTOVER }
      const incoming = body as unknown as ArchiveStateChallengeV1
      const verified = verifyEip712Challenge(incoming)
      if (!verified.ok) return { ok: false, error: verified.error }
      if (!challengeSamplesMatchSeed(incoming, inventoryNow())) {
        return { ok: false, error: ERR_SYNC_CHALLENGE_SAMPLES }
      }
      if (phase === 'SYNCING' || phase === 'REJECTED') {
        return { ok: false, error: 'ERR_SYNC_NOT_CLAIMED' }
      }
      if (incoming.candidate !== options.domainId) return { ok: false, error: 'ERR_SYNC_CANDIDATE' }
      if (!statusRootsMatch(inventoryNow(), incoming)) {
        pendingChallenge = null
        if (phase === 'CLAIMED_SYNC' || phase === 'QUALIFIED') ensurePendingChallenge()
        return { ok: false, error: 'ERR_SYNC_CHALLENGE_STALE' }
      }
      if (pendingChallenge === null || !verifyEip712Challenge(pendingChallenge).ok) {
        pendingChallenge = incoming
      }
      if (pendingChallenge.seed !== incoming.seed) return { ok: false, error: 'ERR_SYNC_CHALLENGE_STALE' }
      const challenge = incoming
      const previous = phase
      hopDuringChallenge = false
      phase = 'STATE_CHALLENGE'
      const answer = answerChallengeLocal(options.store.hash, inventoryNow(), challenge)
      if (hopDuringChallenge) {
        reject('ERR_SYNC_HOP_DURING_CHALLENGE')
        return { ok: false, error: 'ERR_SYNC_HOP_DURING_CHALLENGE', answer }
      }
      phase = previous === 'QUALIFIED' ? 'QUALIFIED' : 'CLAIMED_SYNC'
      persist()
      return { ok: true, answer }
    },
    handleVote(body) {
      if (!isRecord(body) || body.schema !== 'ArchiveSyncVoteV1') return { ok: false, error: 'ERR_SYNC_VOTE' }
      if (isHmacSeatingVote(body)) return { ok: false, error: 'ERR_SYNC_HMAC_CUTOVER' }
      const vote = body as unknown as ArchiveSyncVoteV1
      if (vote.candidate !== options.domainId) return { ok: false, error: 'ERR_SYNC_CANDIDATE' }
      if (!verifySyncVote(vote)) return { ok: false, error: 'ERR_SYNC_SIG' }
      if (!actives.includes(vote.domainId) || vote.domainId === options.domainId) {
        return { ok: false, error: 'ERR_SYNC_VOTER' }
      }
      const inventory = inventoryNow()
      if (vote.membershipRoot !== inventory.membershipRoot) {
        return { ok: false, error: 'ERR_SYNC_MEMBERSHIP' }
      }
      if (
        vote.groupId !== inventory.groupId ||
        vote.hostedChainSetRoot !== inventory.hostedChainSetRoot ||
        vote.lastACRef !== inventory.lastACRef ||
        vote.hashIndexRoot !== inventory.hashIndexRoot
      ) {
        return { ok: false, error: 'ERR_SYNC_ROOT_MISMATCH' }
      }
      votes = [...votes.filter((row) => row.domainId !== vote.domainId), vote]
      const built = buildCertificate({
        groupId: inventory.groupId,
        candidate: options.domainId,
        challengeHash: vote.challengeHash,
        hostedChainSetRoot: inventory.hostedChainSetRoot,
        lastACRef: inventory.lastACRef,
        membershipRoot: inventory.membershipRoot,
        hashIndexRoot: inventory.hashIndexRoot,
        votes,
        activeDomainIds: actives,
      })
      if ('ok' in built && built.ok === false) {
        persist()
        return { ok: true, seatingQualified: false }
      }
      adoptCertificate(built as ArchiveSyncQualificationCertificateV1)
      return { ok: true, seatingQualified: true }
    },
    handleStandbyReady,
    officialStandbyReadyCount,
    officialStandbysReady,
    handleReject(body) {
      if (!isRecord(body) || body.schema !== 'ArchiveSyncVoteV1') return { ok: false, error: 'ERR_SYNC_REJECT' }
      if (isHmacSeatingVote(body)) return { ok: false, error: 'ERR_SYNC_HMAC_CUTOVER' }
      const vote = body as unknown as ArchiveSyncVoteV1
      if (vote.candidate !== options.domainId || vote.accept !== false) {
        return { ok: false, error: 'ERR_SYNC_REJECT' }
      }
      if (!verifySyncRejectVote(vote)) return { ok: false, error: 'ERR_SYNC_SIG' }
      if (!actives.includes(vote.domainId) || vote.domainId === options.domainId) {
        return { ok: false, error: 'ERR_SYNC_VOTER' }
      }
      if (phase === 'QUALIFIED') return { ok: true, seatingQualified: true }
      const inboundReason = typeof body.reason === 'string' ? body.reason : 'ERR_SYNC_CHALLENGE_FAILED'
      if (isSyncChallengerMissingReason(inboundReason)) return { ok: true }
      reject(inboundReason)
      return { ok: true }
    },
    claimSync() {
      if (phase === 'QUALIFIED' || phase === 'REJECTED') return false
      if (inventoryNow().leafCount === 0) return false
      enterClaimedSync(true)
      return true
    },
  }
}

export function syncVoteSigners(
  votes: readonly ArchiveSyncVoteV1[],
  actives: readonly string[],
  candidate: string,
  challengeHash: SyncInventoryV1['hashIndexRoot'],
  membershipRoot: SyncInventoryV1['membershipRoot'],
): string[] {
  return uniqueAcceptingSigners(votes, actives, candidate, challengeHash, membershipRoot)
}
