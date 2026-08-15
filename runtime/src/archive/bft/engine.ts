import { ZERO32, type Hex } from './bytes.js'
import { labGenesisDepositBundle } from './labCandidate.js'
import { signLabVote } from './mac.js'
import { replayDepositBundle } from './modeA.js'
import {
  acceptVote,
  buildArchiveCertificate,
  hasQuorum,
  matchingVotes,
  membershipRootOf,
  topicQcRef,
  uniqueActiveSigners,
  voteSlotKey,
} from './quorum.js'
import { applyArchiveRoundInput, createEmptyRoundState, type ArchiveRoundState } from './tendermint.js'
import {
  ARCHIVE_QUORUM,
  CERT_KIND_ARCHIVE,
  CERT_KIND_PREVOTE_QC,
  VOTE_STEP_PRECOMMIT,
  VOTE_STEP_PREVOTE,
  type ArchiveCertificate,
  type ArchiveVote,
  type BftPeer,
  type BftStatus,
  type DepositBundle,
  type ModeAResult,
} from './types.js'
import type { ArchiveStore } from '../store.js'
import type { DleCertificateView, DleTipView } from '../../shared/protocol.js'

const GOSSIP_MS = 1_000
const GOSSIP_AFTER_AC_MS = 5_000
const REQUEST_TIMEOUT_MS = 2_000
const LAB_AC_NOTE = 'Lab networked PrecommitQC. Not a frozen EIP-712 L1 wrapper or corpus SSZ object.'

export interface ArchiveBftOptions {
  domainId: string
  role: string
  peers: BftPeer[]
  store: ArchiveStore
  bundle?: DepositBundle
  fetchImpl?: typeof fetch
}

export interface ArchiveBftEngine {
  start(): Promise<void>
  stop(): void
  ingest(body: unknown): { ok: boolean; error?: string; status: BftStatus }
  status(): BftStatus
  facadeViews(): { tip: DleTipView; certificate: DleCertificateView }
  certificate(): ArchiveCertificate | null
}

interface PersistedBft {
  schema: 'DleLabBftStateV1'
  votes: ArchiveVote[]
  certificate: ArchiveCertificate | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseVote(value: unknown): ArchiveVote | null {
  if (!isRecord(value)) return null
  if (value.schema !== 'DleLabVoteV1') return null
  if (typeof value.domainId !== 'string') return null
  if (typeof value.height !== 'number' || typeof value.round !== 'number' || typeof value.step !== 'number') {
    return null
  }
  if (
    typeof value.valueHash !== 'string' ||
    typeof value.membershipRoot !== 'string' ||
    typeof value.prevoteQCRef !== 'string' ||
    typeof value.mac !== 'string'
  ) {
    return null
  }
  return {
    schema: 'DleLabVoteV1',
    domainId: value.domainId,
    height: value.height,
    round: value.round,
    step: value.step,
    valueHash: value.valueHash as Hex,
    membershipRoot: value.membershipRoot as Hex,
    prevoteQCRef: value.prevoteQCRef as Hex,
    mac: value.mac as Hex,
  }
}

function parseCertificate(value: unknown): ArchiveCertificate | null {
  if (!isRecord(value)) return null
  if (value.schema !== 'DleLabArchiveCertificateV1' || value.kind !== CERT_KIND_ARCHIVE) return null
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
  return {
    schema: 'DleLabArchiveCertificateV1',
    kind: CERT_KIND_ARCHIVE,
    height: value.height,
    round: value.round,
    valueHash: value.valueHash as Hex,
    tipStateRoot: value.tipStateRoot as Hex,
    prevoteQCRef: value.prevoteQCRef as Hex,
    membershipRoot: value.membershipRoot as Hex,
    quorum: ARCHIVE_QUORUM,
    signers: value.signers as string[],
    networked: true,
    modeA: true,
    labOnly: true,
    note: typeof value.note === 'string' ? value.note : LAB_AC_NOTE,
  }
}

export function createArchiveBftEngine(options: ArchiveBftOptions): ArchiveBftEngine {
  const role = options.role === 'active' ? 'active' : 'standby'
  const roster = [
    { domainId: options.domainId, host: '127.0.0.1', port: 0, role },
    ...options.peers,
  ]
  const activeDomainIds = roster.filter((row) => row.role === 'active').map((row) => row.domainId).sort()
  const membershipRoot = membershipRootOf(activeDomainIds)
  const bundle = options.bundle ?? labGenesisDepositBundle()
  const replay: ModeAResult = replayDepositBundle(bundle)
  const votes = new Map<string, ArchiveVote>()
  let certificate: ArchiveCertificate | null = null
  let roundState: ArchiveRoundState = createEmptyRoundState(1, 0)
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const fetchImpl = options.fetchImpl ?? fetch

  const persisted = options.store.loadBftState() as PersistedBft | null
  if (persisted?.schema === 'DleLabBftStateV1') {
    for (const raw of persisted.votes) {
      const vote = parseVote(raw)
      if (vote === null) continue
      const accepted = acceptVote({
        vote,
        existing: votes.get(voteSlotKey(vote)),
        activeDomainIds,
        membershipRoot,
      })
      if (accepted.ok) votes.set(voteSlotKey(accepted.vote), accepted.vote)
    }
    if (persisted.certificate !== null) {
      const loaded = parseCertificate(persisted.certificate)
      if (loaded !== null) certificate = loaded
    }
  }

  function persist(): void {
    options.store.persistBftState({
      schema: 'DleLabBftStateV1',
      votes: [...votes.values()],
      certificate,
    })
  }

  function valueHash(): Hex {
    return replay.ok ? replay.valueHash : ZERO32
  }

  function tipStateRoot(): Hex {
    return replay.ok ? replay.tipStateRoot : ZERO32
  }

  function prevoteTopicRef(): Hex {
    return topicQcRef({
      kind: CERT_KIND_PREVOTE_QC,
      valueHash: valueHash(),
      membershipRoot,
      height: 1,
      round: 0,
    })
  }

  function acTopicRef(prevoteQCRef: Hex): Hex {
    return topicQcRef({
      kind: CERT_KIND_ARCHIVE,
      valueHash: valueHash(),
      membershipRoot,
      height: 1,
      round: 0,
      prevoteQCRef,
    })
  }

  function signersFor(step: number, prevoteQCRef?: Hex): string[] {
    return uniqueActiveSigners(
      matchingVotes({
        votes: [...votes.values()],
        step,
        valueHash: valueHash(),
        height: 1,
        round: 0,
        membershipRoot,
        ...(prevoteQCRef !== undefined ? { prevoteQCRef } : {}),
      }),
      activeDomainIds,
    )
  }

  function installCertificate(next: ArchiveCertificate): void {
    const previous = certificate
    if (
      previous !== null &&
      previous.valueHash === next.valueHash &&
      previous.signers.length >= next.signers.length &&
      previous.signers.every((id) => next.signers.includes(id))
    ) {
      return
    }
    certificate = next
    persist()
    options.store.appendWal({
      type: 'archive-certificate',
      valueHash: next.valueHash,
      signers: next.signers,
      quorum: next.quorum,
    })
  }

  function tryAdvance(): void {
    if (!replay.ok) return
    const prevoteSigners = signersFor(VOTE_STEP_PREVOTE)
    if (hasQuorum(prevoteSigners) && roundState.step === 'PREVOTE') {
      const qcRef = prevoteTopicRef()
      const transition = applyArchiveRoundInput(roundState, {
        type: 'PREVOTE_QC',
        value: valueHash(),
        qcRef,
      })
      if (transition.error === undefined) {
        roundState = transition.state
        const output = transition.outputs[0]
        if (output !== undefined && role === 'active' && output.value !== ZERO32) {
          addOwnVote(VOTE_STEP_PRECOMMIT, output.reference)
        }
      }
    }
    const qcRef = prevoteTopicRef()
    const precommitSigners = signersFor(VOTE_STEP_PRECOMMIT, qcRef)
    if (hasQuorum(precommitSigners)) {
      const built = buildArchiveCertificate({
        valueHash: valueHash(),
        tipStateRoot: tipStateRoot(),
        membershipRoot,
        height: 1,
        round: 0,
        prevoteQCRef: qcRef,
        signers: precommitSigners,
      })
      if (built.ok) {
        if (roundState.step === 'PRECOMMIT') {
          const committed = applyArchiveRoundInput(roundState, {
            type: 'PRECOMMIT_QC',
            value: valueHash(),
            acRef: acTopicRef(qcRef),
          })
          if (committed.error === undefined) roundState = committed.state
        }
        installCertificate(built.certificate)
      }
    }
  }

  function addOwnVote(step: number, prevoteQCRef: Hex): void {
    if (role !== 'active' || !replay.ok) return
    const unsigned = {
      domainId: options.domainId,
      height: 1,
      round: 0,
      step,
      valueHash: valueHash(),
      membershipRoot,
      prevoteQCRef,
    }
    const vote: ArchiveVote = { schema: 'DleLabVoteV1', ...unsigned, mac: signLabVote(unsigned) }
    const existing = votes.get(voteSlotKey(vote))
    const accepted = acceptVote({ vote, existing, activeDomainIds, membershipRoot })
    if (!accepted.ok) return
    votes.set(voteSlotKey(accepted.vote), accepted.vote)
    options.store.appendWal({ type: 'bft-vote', domainId: vote.domainId, step: vote.step })
    persist()
  }

  function adoptCertificate(candidate: ArchiveCertificate): boolean {
    if (!replay.ok) return false
    if (candidate.valueHash !== valueHash()) return false
    if (candidate.membershipRoot !== membershipRoot) return false
    if (candidate.signers.some((id) => !activeDomainIds.includes(id))) return false
    if (candidate.signers.length < ARCHIVE_QUORUM) return false
    const precommitSigners = signersFor(VOTE_STEP_PRECOMMIT, candidate.prevoteQCRef)
    if (!candidate.signers.every((id) => precommitSigners.includes(id))) return false
    installCertificate(candidate)
    return true
  }

  function ingestVote(raw: unknown): string | undefined {
    const vote = parseVote(raw)
    if (vote === null) return 'ERR_INVALID_VOTE'
    const accepted = acceptVote({
      vote,
      existing: votes.get(voteSlotKey(vote)),
      activeDomainIds,
      membershipRoot,
    })
    if (!accepted.ok) return accepted.error
    votes.set(voteSlotKey(accepted.vote), accepted.vote)
    persist()
    tryAdvance()
    return undefined
  }

  async function gossip(): Promise<void> {
    const payload = {
      schema: 'DleLabBftMessageV1',
      from: options.domainId,
      votes: [...votes.values()],
      certificate,
    }
    await Promise.all(
      options.peers
        .filter((peer) => peer.role === 'active' || peer.role === 'standby')
        .map(async (peer) => {
          try {
            await fetchImpl(`http://${peer.host}:${peer.port}/bft/message`, {
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
          if (!stopped) scheduleGossip(certificate !== null ? GOSSIP_AFTER_AC_MS : GOSSIP_MS)
        }
      })()
    }, delay)
  }

  function status(): BftStatus {
    const row: BftStatus = {
      schema: 'DleLabBftStatusV1',
      networked: true,
      modeA: true,
      modeAAccepted: replay.ok,
      role,
      voted: role === 'active' && replay.ok,
      step: roundState.step,
      height: roundState.height,
      round: roundState.round,
      prevoteCount: signersFor(VOTE_STEP_PREVOTE).length,
      precommitCount: signersFor(VOTE_STEP_PRECOMMIT, prevoteTopicRef()).length,
      certificateAvailable: certificate !== null,
      valueHash: valueHash(),
      quorum: ARCHIVE_QUORUM,
      labOnly: true,
    }
    if (!replay.ok) row.modeAError = replay.code
    return row
  }

  function facadeViews(): { tip: DleTipView; certificate: DleCertificateView } {
    if (certificate === null) {
      return {
        tip: {
          height: '0x0',
          hash: ZERO32,
          finalized: false,
          note: 'Archive node does not produce blocks; tip finality is an Archive Certificate.',
        },
        certificate: {
          available: false,
          reason: 'Networked Archive Certificate is not produced in this scaffold.',
        },
      }
    }
    return {
      tip: {
        height: '0x1',
        hash: certificate.valueHash,
        finalized: true,
        note: 'Tip finalized by a lab networked Archive Certificate (PrecommitQC). Archives do not produce blocks.',
      },
      certificate: {
        available: true,
        reason: certificate.note,
        height: '0x1',
        hash: certificate.valueHash,
        quorum: certificate.quorum,
        networked: true,
        modeA: true,
        signers: certificate.signers,
        kind: certificate.kind,
        round: certificate.round,
        prevoteQCRef: certificate.prevoteQCRef,
        labOnly: true,
      },
    }
  }

  return {
    async start() {
      if (certificate !== null) {
        scheduleGossip(GOSSIP_MS)
        return
      }
      if (replay.ok && role === 'active' && roundState.step === 'PROPOSE') {
        const transition = applyArchiveRoundInput(roundState, {
          type: 'PROPOSAL',
          value: valueHash(),
          available: true,
          validRound: 0xffff_ffff,
          validPrevoteQCRef: ZERO32,
        })
        if (transition.error === undefined) {
          roundState = transition.state
          const output = transition.outputs[0]
          if (output !== undefined && output.value !== ZERO32) {
            addOwnVote(VOTE_STEP_PREVOTE, ZERO32)
          }
        }
      }
      tryAdvance()
      scheduleGossip(0)
    },
    stop() {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    },
    ingest(body: unknown) {
      if (!isRecord(body) || body.schema !== 'DleLabBftMessageV1') {
        return { ok: false, error: 'ERR_INVALID_MESSAGE', status: status() }
      }
      let error: string | undefined
      if (Array.isArray(body.votes)) {
        for (const raw of body.votes) {
          const next = ingestVote(raw)
          if (next !== undefined && next !== 'ERR_WAL_DOUBLE_SIGN') error = next
        }
      }
      if (certificate === null && body.certificate !== undefined && body.certificate !== null) {
        const incoming = parseCertificate(body.certificate)
        if (incoming !== null) adoptCertificate(incoming)
      }
      tryAdvance()
      return error === undefined ? { ok: true, status: status() } : { ok: false, error, status: status() }
    },
    status,
    facadeViews,
    certificate() {
      return certificate
    },
  }
}
