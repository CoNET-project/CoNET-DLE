/** Per-new-chain Q_A=4/5. Isolated from NFT 42 `/bft/message` and `bft-state.json`. */

import { ZERO32, type Hex } from '../../shared/bytes.js'
import { hashIndexRootOf } from '../../shared/hashIndexTree.js'
import { canonicalGroupId, normalizeHash32 } from '../../shared/hashLookup.js'
import type { LabRouteTable } from '../../shared/labRoute.js'
import { parseOptionalHash32 } from '../bft/bytes.js'
import { makeLabBftVote, parseArchiveVote, votesEqual } from '../bft/mac.js'
import {
  acceptVote,
  boundHashIndexRootOf,
  buildArchiveCertificate,
  buildPrevoteQc,
  hasQuorum,
  matchingVotes,
  membershipRootOf,
  topicQcRef,
  uniqueActiveSigners,
  voteSlotKey,
} from '../bft/quorum.js'
import { applyArchiveRoundInput, createEmptyRoundState, type ArchiveRoundState } from '../bft/tendermint.js'
import {
  ARCHIVE_QUORUM,
  CERT_KIND_ARCHIVE,
  CERT_KIND_PREVOTE_QC,
  VOTE_STEP_PRECOMMIT,
  VOTE_STEP_PREVOTE,
  type ArchiveCertificate,
  type ArchivePrevoteQc,
  type ArchiveVote,
  type BftPeer,
} from '../bft/types.js'
import { indexLabCertificateRoots, indexLabHashObject, labChainObjectLocator } from '../hashPipe.js'
import type { ArchiveStore } from '../store.js'

const GOSSIP_MS = 1_000
const GOSSIP_AFTER_IDLE_MS = 5_000
const REQUEST_TIMEOUT_MS = 2_500
const GOSSIP_PENDING_BATCH = 3
const GOSSIP_CERTIFIED_BATCH = 2
const GOSSIP_CERTIFIED_IDLE_BATCH = 3
const NEWCHAIN_BFT_SCHEMA = 'DleLabNewChainBftMessageV1' as const
const LAB_AC_NOTE =
  'Lab networked PrecommitQC for a new chainNftId. Not NFT 42. Votes are lab EIP-712 ArchiveBftVote; not a frozen EIP-712 L1 wrapper.'
const LAB_PREVOTE_NOTE =
  'Lab networked PrevoteQC for a new chainNftId. First-class hash object (kind=prevoteQc); not an AC field alias.'

export interface NewChainGenesisTopicInput {
  requestId: Hex
  chainNftId: string
  valueHash: Hex
  tipStateRoot: Hex
  votes?: ArchiveVote[]
  prevoteQc?: ArchivePrevoteQc | null
  certificate?: ArchiveCertificate | null
}

export interface NewChainGenesisBftOptions {
  domainId: string
  role: string
  peers: BftPeer[]
  store: ArchiveStore
  routeTable: LabRouteTable
  fetchImpl?: typeof fetch
  onPersist?: (snapshot: NewChainGenesisSnapshot) => void
}

export interface NewChainGenesisSnapshot {
  chainNftId: string
  requestId: Hex
  votes: ArchiveVote[]
  prevoteQc: ArchivePrevoteQc | null
  certificate: ArchiveCertificate | null
}

export interface NewChainGenesisBft {
  start(): Promise<void>
  stop(): void
  ensureTopic(input: NewChainGenesisTopicInput): void
  ingest(body: unknown): { ok: boolean; error?: string }
  certificate(chainNftId: string): ArchiveCertificate | null
  certifiedCount(): number
  pendingCount(): number
}

interface TopicState {
  requestId: Hex
  chainNftId: string
  valueHash: Hex
  tipStateRoot: Hex
  votes: Map<string, ArchiveVote>
  prevoteQc: ArchivePrevoteQc | null
  certificate: ArchiveCertificate | null
  roundState: ArchiveRoundState
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function takeRoundRobin<T>(items: T[], start: number, limit: number): { picked: T[]; next: number } {
  if (items.length === 0 || limit <= 0) return { picked: [], next: 0 }
  const count = Math.min(limit, items.length)
  const origin = ((start % items.length) + items.length) % items.length
  const picked: T[] = []
  let idx = origin
  for (let i = 0; i < count; i += 1) {
    picked.push(items[idx]!)
    idx = (idx + 1) % items.length
  }
  return { picked, next: idx }
}

export { parseArchiveVote } from '../bft/mac.js'

export function parseArchiveCertificate(value: unknown): ArchiveCertificate | null {
  if (!isRecord(value) || value.schema !== 'DleLabArchiveCertificateV1' || value.kind !== CERT_KIND_ARCHIVE) {
    return null
  }
  if (typeof value.height !== 'number' || typeof value.round !== 'number') return null
  if (
    typeof value.valueHash !== 'string' ||
    typeof value.tipStateRoot !== 'string' ||
    typeof value.prevoteQCRef !== 'string' ||
    typeof value.membershipRoot !== 'string'
  ) {
    return null
  }
  if (!Array.isArray(value.signers) || !value.signers.every((item) => typeof item === 'string')) return null
  const hashIndexRoot = parseOptionalHash32(value.hashIndexRoot)
  if (hashIndexRoot === null) return null
  return {
    schema: 'DleLabArchiveCertificateV1',
    kind: CERT_KIND_ARCHIVE,
    height: value.height,
    round: value.round,
    valueHash: value.valueHash as Hex,
    tipStateRoot: value.tipStateRoot as Hex,
    prevoteQCRef: value.prevoteQCRef as Hex,
    membershipRoot: value.membershipRoot as Hex,
    hashIndexRoot,
    quorum: ARCHIVE_QUORUM,
    signers: value.signers as string[],
    networked: true,
    modeA: true,
    labOnly: true,
    note: typeof value.note === 'string' ? value.note : LAB_AC_NOTE,
  }
}

export function parseArchivePrevoteQc(value: unknown): ArchivePrevoteQc | null {
  if (!isRecord(value) || value.schema !== 'DleLabPrevoteQcV1' || value.kind !== CERT_KIND_PREVOTE_QC) {
    return null
  }
  if (typeof value.height !== 'number' || typeof value.round !== 'number') return null
  if (
    typeof value.valueHash !== 'string' ||
    typeof value.membershipRoot !== 'string' ||
    typeof value.qcRef !== 'string'
  ) {
    return null
  }
  if (!Array.isArray(value.signers) || !value.signers.every((item) => typeof item === 'string')) return null
  const hashIndexRoot = parseOptionalHash32(value.hashIndexRoot)
  if (hashIndexRoot === null) return null
  return {
    schema: 'DleLabPrevoteQcV1',
    kind: CERT_KIND_PREVOTE_QC,
    height: value.height,
    round: value.round,
    valueHash: value.valueHash as Hex,
    membershipRoot: value.membershipRoot as Hex,
    hashIndexRoot,
    qcRef: value.qcRef as Hex,
    quorum: ARCHIVE_QUORUM,
    signers: value.signers as string[],
    networked: true,
    labOnly: true,
    note: typeof value.note === 'string' ? value.note : LAB_PREVOTE_NOTE,
  }
}

export function createNewChainGenesisBft(options: NewChainGenesisBftOptions): NewChainGenesisBft {
  const role = options.role === 'active' ? 'active' : 'standby'
  const roster = [
    { domainId: options.domainId, host: '127.0.0.1', port: 0, role },
    ...options.peers,
  ]
  const activeDomainIds = roster.filter((row) => row.role === 'active').map((row) => row.domainId).sort()
  const membershipRoot = membershipRootOf(activeDomainIds)
  const groupId = canonicalGroupId(options.routeTable.ownGroupId)
  const topics = new Map<string, TopicState>()
  const fetchImpl = options.fetchImpl ?? fetch
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let pendingCursor = 0
  let certifiedCursor = 0

  function snapshotOf(topic: TopicState): NewChainGenesisSnapshot {
    return {
      chainNftId: topic.chainNftId,
      requestId: topic.requestId,
      votes: [...topic.votes.values()],
      prevoteQc: topic.prevoteQc,
      certificate: topic.certificate,
    }
  }

  function persistTopic(topic: TopicState): void {
    options.onPersist?.(snapshotOf(topic))
  }

  function liveHashIndexRoot(): Hex {
    return hashIndexRootOf(options.store.hash.listLocators()) as Hex
  }

  function boundHashIndexRoot(topic: TopicState): Hex {
    return boundHashIndexRootOf([...topic.votes.values()], liveHashIndexRoot())
  }

  function prevoteTopicRef(topic: TopicState): Hex {
    return topicQcRef({
      kind: CERT_KIND_PREVOTE_QC,
      valueHash: topic.valueHash,
      membershipRoot,
      hashIndexRoot: boundHashIndexRoot(topic),
      height: 1,
      round: 0,
    })
  }

  function signersFor(topic: TopicState, step: number, prevoteQCRef?: Hex): string[] {
    return uniqueActiveSigners(
      matchingVotes({
        votes: [...topic.votes.values()],
        step,
        valueHash: topic.valueHash,
        height: 1,
        round: 0,
        membershipRoot,
        hashIndexRoot: boundHashIndexRoot(topic),
        ...(prevoteQCRef !== undefined ? { prevoteQCRef } : {}),
      }),
      activeDomainIds,
    )
  }

  function indexCertificate(topic: TopicState, next: ArchiveCertificate): void {
    const hash = normalizeHash32(next.valueHash)
    if (hash === null || hash === ZERO32) return
    indexLabHashObject(
      options.store.hash,
      labChainObjectLocator('ac', hash, topic.chainNftId, '0x1', next.valueHash, groupId),
      {
        schema: 'DleLabArchiveCertificateV1',
        chainNftId: topic.chainNftId,
        requestId: topic.requestId,
        certificate: next,
        labOnly: true,
        notNft42: true,
      },
    )
    indexLabCertificateRoots(options.store.hash, {
      tipStateRoot: next.tipStateRoot,
      membershipRoot: next.membershipRoot,
      chainNftId: topic.chainNftId,
      height: '0x1',
      acRef: next.valueHash,
      groupId,
    })
  }

  function indexPrevoteQc(topic: TopicState, next: ArchivePrevoteQc): void {
    const hash = normalizeHash32(next.qcRef)
    if (hash === null || hash === ZERO32) return
    indexLabHashObject(
      options.store.hash,
      labChainObjectLocator('prevoteQc', hash, topic.chainNftId, '0x1', next.valueHash, groupId),
      next,
    )
  }

  function installPrevoteQc(topic: TopicState, next: ArchivePrevoteQc): void {
    const previous = topic.prevoteQc
    if (
      previous !== null &&
      previous.qcRef === next.qcRef &&
      previous.signers.length >= next.signers.length &&
      previous.signers.every((id) => next.signers.includes(id))
    ) {
      return
    }
    topic.prevoteQc = next
    persistTopic(topic)
    options.store.appendWal({
      type: 'newchain-prevote-qc',
      chainNftId: topic.chainNftId,
      qcRef: next.qcRef,
      valueHash: next.valueHash,
      signers: next.signers,
    })
    indexPrevoteQc(topic, next)
  }

  function installCertificate(
    topic: TopicState,
    next: ArchiveCertificate,
    opts?: { announce?: boolean },
  ): void {
    const previous = topic.certificate
    if (
      previous !== null &&
      previous.valueHash === next.valueHash &&
      previous.signers.length >= next.signers.length &&
      previous.signers.every((id) => next.signers.includes(id))
    ) {
      return
    }
    topic.certificate = next
    persistTopic(topic)
    options.store.appendWal({
      type: 'newchain-archive-certificate',
      chainNftId: topic.chainNftId,
      valueHash: next.valueHash,
      signers: next.signers,
      quorum: next.quorum,
    })
    indexCertificate(topic, next)
    if (opts?.announce !== false) void postTopics([topic])
  }

  function addOwnVote(topic: TopicState, step: number, prevoteQCRef: Hex): void {
    if (role !== 'active') return
    const hashIndexRoot = boundHashIndexRoot(topic)
    const unsigned = {
      domainId: options.domainId,
      height: 1,
      round: 0,
      step,
      valueHash: topic.valueHash,
      membershipRoot,
      hashIndexRoot,
      prevoteQCRef,
    }
    const vote = makeLabBftVote(unsigned)
    const accepted = acceptVote({
      vote,
      existing: topic.votes.get(voteSlotKey(vote)),
      activeDomainIds,
      membershipRoot,
      expectedHashIndexRoot: hashIndexRoot,
    })
    if (!accepted.ok) return
    topic.votes.set(voteSlotKey(accepted.vote), accepted.vote)
    persistTopic(topic)
  }

  function tryAdvance(topic: TopicState): void {
    if (topic.certificate !== null) return
    const prevoteSigners = signersFor(topic, VOTE_STEP_PREVOTE)
    if (hasQuorum(prevoteSigners)) {
      const built = buildPrevoteQc({
        valueHash: topic.valueHash,
        membershipRoot,
        hashIndexRoot: boundHashIndexRoot(topic),
        height: 1,
        round: 0,
        signers: prevoteSigners,
      })
      if (built.ok) {
        if (topic.prevoteQc === null || topic.prevoteQc.qcRef === built.prevoteQc.qcRef) {
          installPrevoteQc(topic, built.prevoteQc)
        }
      }
      if (topic.roundState.step === 'PREVOTE') {
        const qcRef = prevoteTopicRef(topic)
        const transition = applyArchiveRoundInput(topic.roundState, {
          type: 'PREVOTE_QC',
          value: topic.valueHash,
          qcRef,
        })
        if (transition.error === undefined) {
          topic.roundState = transition.state
          const output = transition.outputs[0]
          if (output !== undefined && role === 'active' && output.value !== ZERO32) {
            addOwnVote(topic, VOTE_STEP_PRECOMMIT, output.reference)
          }
        }
      }
    }
    const qcRef = prevoteTopicRef(topic)
    const precommitSigners = signersFor(topic, VOTE_STEP_PRECOMMIT, qcRef)
    if (hasQuorum(precommitSigners)) {
      const built = buildArchiveCertificate({
        valueHash: topic.valueHash,
        tipStateRoot: topic.tipStateRoot,
        membershipRoot,
        hashIndexRoot: boundHashIndexRoot(topic),
        height: 1,
        round: 0,
        prevoteQCRef: qcRef,
        signers: precommitSigners,
      })
      if (built.ok) {
        if (topic.roundState.step === 'PRECOMMIT') {
          const committed = applyArchiveRoundInput(topic.roundState, {
            type: 'PRECOMMIT_QC',
            value: topic.valueHash,
            acRef: topicQcRef({
              kind: CERT_KIND_ARCHIVE,
              valueHash: topic.valueHash,
              membershipRoot,
              hashIndexRoot: boundHashIndexRoot(topic),
              height: 1,
              round: 0,
              prevoteQCRef: qcRef,
            }),
          })
          if (committed.error === undefined) topic.roundState = committed.state
        }
        installCertificate(topic, built.certificate)
      }
    }
  }

  function proposeIfNeeded(topic: TopicState): void {
    if (topic.certificate !== null) return
    if (role !== 'active' || topic.roundState.step !== 'PROPOSE') return
    const transition = applyArchiveRoundInput(topic.roundState, {
      type: 'PROPOSAL',
      value: topic.valueHash,
      available: true,
      validRound: 0xffff_ffff,
      validPrevoteQCRef: ZERO32,
    })
    if (transition.error === undefined) {
      topic.roundState = transition.state
      const output = transition.outputs[0]
      if (output !== undefined && output.value !== ZERO32) {
        addOwnVote(topic, VOTE_STEP_PREVOTE, ZERO32)
      }
    }
    tryAdvance(topic)
  }

  function adoptCertificate(topic: TopicState, candidate: ArchiveCertificate): boolean {
    if (candidate.valueHash !== topic.valueHash) return false
    if (candidate.tipStateRoot !== topic.tipStateRoot) return false
    if (candidate.membershipRoot !== membershipRoot) return false
    if (candidate.hashIndexRoot !== boundHashIndexRoot(topic)) return false
    if (candidate.signers.some((id) => !activeDomainIds.includes(id))) return false
    if (candidate.signers.length < ARCHIVE_QUORUM) return false
    const precommitSigners = signersFor(topic, VOTE_STEP_PRECOMMIT, candidate.prevoteQCRef)
    if (!candidate.signers.every((id) => precommitSigners.includes(id))) return false
    installCertificate(topic, candidate)
    return true
  }

  function ingestVote(topic: TopicState, raw: unknown): string | undefined {
    const vote = parseArchiveVote(raw)
    if (vote === null) return 'ERR_INVALID_VOTE'
    if (vote.valueHash !== topic.valueHash) return 'ERR_VALUE_HASH_MISMATCH'
    const accepted = acceptVote({
      vote,
      existing: topic.votes.get(voteSlotKey(vote)),
      activeDomainIds,
      membershipRoot,
      expectedHashIndexRoot: boundHashIndexRoot(topic),
    })
    if (!accepted.ok) return accepted.error
    const key = voteSlotKey(accepted.vote)
    const existing = topic.votes.get(key)
    if (existing !== undefined && votesEqual(existing, accepted.vote)) {
      if (topic.certificate === null) tryAdvance(topic)
      return undefined
    }
    topic.votes.set(key, accepted.vote)
    if (topic.certificate === null) persistTopic(topic)
    tryAdvance(topic)
    return undefined
  }

  function topicWire(topic: TopicState): Record<string, unknown> {
    return {
      chainNftId: topic.chainNftId,
      requestId: topic.requestId,
      valueHash: topic.valueHash,
      votes: [...topic.votes.values()],
      prevoteQc: topic.prevoteQc,
      certificate: topic.certificate,
    }
  }

  async function postTopics(selected: TopicState[]): Promise<void> {
    if (selected.length === 0) return
    const seen = new Set<string>()
    const unique: TopicState[] = []
    for (const topic of selected) {
      if (seen.has(topic.chainNftId)) continue
      seen.add(topic.chainNftId)
      unique.push(topic)
    }
    const payload = {
      schema: NEWCHAIN_BFT_SCHEMA,
      from: options.domainId,
      notNft42: true,
      topics: unique.map(topicWire),
    }
    await Promise.all(
      options.peers
        .filter((peer) => peer.role === 'active' || peer.role === 'standby')
        .map(async (peer) => {
          try {
            await fetchImpl(`http://${peer.host}:${peer.port}/newchain/bft`, {
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

  async function gossip(): Promise<void> {
    const pending = [...topics.values()].filter((topic) => topic.certificate === null)
    const certified = [...topics.values()].filter((topic) => topic.certificate !== null)
    if (pending.length === 0 && certified.length === 0) return
    const pendingPick = takeRoundRobin(pending, pendingCursor, GOSSIP_PENDING_BATCH)
    pendingCursor = pendingPick.next
    const certifiedLimit = pending.length === 0 ? GOSSIP_CERTIFIED_IDLE_BATCH : GOSSIP_CERTIFIED_BATCH
    const certifiedPick = takeRoundRobin(certified, certifiedCursor, certifiedLimit)
    certifiedCursor = certifiedPick.next
    await postTopics([...pendingPick.picked, ...certifiedPick.picked])
  }

  function allCertified(): boolean {
    if (topics.size === 0) return true
    return [...topics.values()].every((topic) => topic.certificate !== null)
  }

  function scheduleGossip(delay: number): void {
    timer = setTimeout(() => {
      void (async () => {
        try {
          await gossip()
        } finally {
          if (!stopped) scheduleGossip(allCertified() ? GOSSIP_AFTER_IDLE_MS : GOSSIP_MS)
        }
      })()
    }, delay)
  }

  return {
    async start() {
      stopped = false
      let n = 0
      for (const topic of topics.values()) {
        proposeIfNeeded(topic)
        n += 1
        if (n % 16 === 0) await new Promise<void>((resolve) => setImmediate(resolve))
      }
      scheduleGossip(0)
    },
    stop() {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    },
    ensureTopic(input) {
      const key = input.chainNftId
      let topic = topics.get(key)
      if (topic === undefined) {
        topic = {
          requestId: input.requestId,
          chainNftId: input.chainNftId,
          valueHash: input.valueHash,
          tipStateRoot: input.tipStateRoot,
          votes: new Map(),
          prevoteQc: input.prevoteQc ?? null,
          certificate: input.certificate ?? null,
          roundState: createEmptyRoundState(1, 0),
        }
        topics.set(key, topic)
      }
      if (Array.isArray(input.votes)) {
        for (const raw of input.votes) {
          const vote = parseArchiveVote(raw)
          if (vote === null || vote.valueHash !== topic.valueHash) continue
          const accepted = acceptVote({
            vote,
            existing: topic.votes.get(voteSlotKey(vote)),
            activeDomainIds,
            membershipRoot,
          })
          if (accepted.ok) topic.votes.set(voteSlotKey(accepted.vote), accepted.vote)
        }
      }
      if (input.prevoteQc) installPrevoteQc(topic, input.prevoteQc)
      if (input.certificate) installCertificate(topic, input.certificate, { announce: false })
      if (topic.certificate === null) proposeIfNeeded(topic)
      else {
        indexCertificate(topic, topic.certificate)
        if (topic.prevoteQc !== null) indexPrevoteQc(topic, topic.prevoteQc)
      }
    },
    ingest(body) {
      if (!isRecord(body) || body.schema !== NEWCHAIN_BFT_SCHEMA) {
        return { ok: false, error: 'ERR_INVALID_NEWCHAIN_BFT' }
      }
      if (!Array.isArray(body.topics)) return { ok: false, error: 'ERR_INVALID_NEWCHAIN_BFT' }
      let error: string | undefined
      for (const raw of body.topics) {
        if (!isRecord(raw) || typeof raw.chainNftId !== 'string') continue
        const topic = topics.get(raw.chainNftId)
        if (topic === undefined) continue
        if (Array.isArray(raw.votes)) {
          for (const vote of raw.votes) {
            const next = ingestVote(topic, vote)
            if (next !== undefined && next !== 'ERR_WAL_DOUBLE_SIGN') error = next
          }
        }
        if (topic.certificate === null && raw.certificate !== undefined && raw.certificate !== null) {
          const incoming = parseArchiveCertificate(raw.certificate)
          if (incoming !== null) adoptCertificate(topic, incoming)
        }
        if (raw.prevoteQc !== undefined && raw.prevoteQc !== null) {
          const incoming = parseArchivePrevoteQc(raw.prevoteQc)
          if (
            incoming !== null &&
            incoming.valueHash === topic.valueHash &&
            incoming.membershipRoot === membershipRoot &&
            incoming.hashIndexRoot === boundHashIndexRoot(topic)
          ) {
            installPrevoteQc(topic, incoming)
          }
        }
        tryAdvance(topic)
      }
      return error === undefined ? { ok: true } : { ok: false, error }
    },
    certificate(chainNftId) {
      return topics.get(chainNftId)?.certificate ?? null
    },
    certifiedCount() {
      return [...topics.values()].filter((topic) => topic.certificate !== null).length
    },
    pendingCount() {
      return [...topics.values()].filter((topic) => topic.certificate === null).length
    },
  }
}
