import { keccak256Utf8, type Hex } from '../../shared/bytes.js'

/**
 * Production qualification is intentionally a separate protocol from the
 * historical lab seating/BFT protocol.  This module evaluates evidence
 * collected from the real operators; it does not manufacture signatures,
 * L1 views, CL randomness, or DePIN observations.
 */

export const PRODUCTION_ROSTER_SCHEMA = 'ProductionRosterSnapshotV1' as const
export const PRODUCTION_ACTIVE_COUNT = 5
export const PRODUCTION_STANDBY_COUNT = 2
export const PRODUCTION_ROSTER_COUNT = 7
export const PRODUCTION_HEARTBEAT_QUORUM = 5
export const PRODUCTION_BFT_QUORUM = 4
export const PRODUCTION_FREEZE_DAYS = 30

export type ProductionQualificationReasonCode =
  | 'PRODUCTION_ROSTER_NOT_FIVE_PLUS_TWO'
  | 'PRODUCTION_ROSTER_DUPLICATE_SEAT'
  | 'PRODUCTION_ROSTER_EXTRA_STANDBY'
  | 'PRODUCTION_OPERATOR_IDENTITY_MISSING'
  | 'PRODUCTION_MANIFEST_HASH_MISMATCH'
  | 'PRODUCTION_HEARTBEAT_QUORUM_INSUFFICIENT'
  | 'PRODUCTION_HEARTBEAT_WINDOW_BROKEN'
  | 'PRODUCTION_HEARTBEAT_SIGNATURE_MISSING'
  | 'PRODUCTION_HEARTBEAT_DISCONNECT_EVIDENCE_MISSING'
  | 'PRODUCTION_BFT_NOT_PRODUCTION'
  | 'PRODUCTION_PREVOTE_QUORUM_INSUFFICIENT'
  | 'PRODUCTION_PRECOMMIT_QUORUM_INSUFFICIENT'
  | 'PRODUCTION_PRECOMMIT_WITHOUT_PREVOTE_QC'
  | 'PRODUCTION_BFT_STATE_MACHINE_INVALID'
  | 'PRODUCTION_BFT_LOCK_OR_WAL_UNPROVEN'
  | 'PRODUCTION_DOUBLE_SIGN_RISK'
  | 'PRODUCTION_CERTIFICATE_NOT_FRESH'
  | 'PRODUCTION_ARCHIVE_CERTIFICATE_MISSING'
  | 'PRODUCTION_ARCHIVE_CERTIFICATE_BINDING_MISMATCH'
  | 'PRODUCTION_ARCHIVE_SIGNATURE_SET_INVALID'
  | 'PRODUCTION_HASH_INDEX_NOT_COMMITTED'
  | 'PRODUCTION_CG_UNAVAILABLE'
  | 'PRODUCTION_CG_REGISTRY_MISMATCH'
  | 'PRODUCTION_CG_CHAIN_COVERAGE_INCOMPLETE'
  | 'PRODUCTION_DEPIN_GOSSIP_MISSING'
  | 'PRODUCTION_ON_DEMAND_NOT_PRODUCTION'
  | 'PRODUCTION_FREEZE_NOT_BEFORE_BEACON'
  | 'PRODUCTION_CL_RANDOMNESS_UNVERIFIED'
  | 'PRODUCTION_FREEZE_WINDOW_INCOMPLETE'
  | 'PRODUCTION_OUTAGE_OR_DRIFT'

export interface ProductionOperatorIdentityV1 {
  seatId: string
  operatorAddress: string
  signingKeyId: string
  identityEvidenceRef: string
}

export interface ProductionRosterSnapshotV1 {
  schema: typeof PRODUCTION_ROSTER_SCHEMA
  production: true
  groupId: string
  membershipEpoch: number
  keyEpoch: number
  snapshotId: string
  releaseId: string
  active: ProductionOperatorIdentityV1[]
  standby: ProductionOperatorIdentityV1[]
  extraStandbySeatIds: string[]
  commit: string
  freezeConfigHash: Hex
  hostedChainSetRoot: Hex
  lastACRef: Hex
  membershipRoot: Hex
  hashIndexRoot: Hex
  capturedAt: string
  manifestHash: Hex
}

export interface ProductionHeartbeatWindowV1 {
  windowId: string
  startedAt: string
  endedAt: string
  signerSeatIds: string[]
  signatures: Hex[]
  signatureVerified: boolean
  disconnectedSeatIds: string[]
  disconnectEvidenceRefs: string[]
  continuityEvidenceRef?: string
}

export interface ProductionHeartbeatEvidenceV1 {
  production: true
  groupId: string
  membershipEpoch: number
  keyEpoch: number
  rosterManifestHash: Hex
  releaseId: string
  commit: string
  snapshotId: string
  sequenceStart: number
  sequenceEnd: number
  nonce: string
  requiredQuorum: number
  requiredConsecutiveWindows: number
  windows: ProductionHeartbeatWindowV1[]
}

export interface ProductionBftEvidenceV1 {
  production: true
  groupId: string
  membershipEpoch: number
  keyEpoch: number
  rosterManifestHash: Hex
  height: string
  round: number
  valueHash: Hex
  phase: 'CERTIFIED'
  prevoteValueHash: Hex
  precommitValueHash: Hex
  lockRound: number
  walCheckpointRef: string
  doubleSignCheckRef: string
  prevoteSignerSeatIds: string[]
  prevoteQcRef: Hex
  precommitQcRef: Hex
  precommitSignerSeatIds: string[]
  prevoteQcValid: boolean
  precommitQcValid: boolean
  certificateFresh: boolean
  lockStatePersisted: boolean
  walReplayChecked: boolean
  doubleSignFree: boolean
  signatureEvidenceRefs: string[]
}

export interface ProductionArchiveCertificateEvidenceV1 {
  production: true
  groupId: string
  membershipEpoch: number
  keyEpoch: number
  snapshotId: string
  releaseId: string
  commitHash: Hex
  chainNftId: string
  tipHeight: string
  parentAC: Hex
  stateRoot: Hex
  daRoot: Hex
  membershipRoot: Hex
  hashIndexRoot: Hex
  freezeConfigHash: Hex
  l1Context: { blockNumber: string; blockHash: Hex }
  prevoteQcRef: Hex
  precommitQcRef: Hex
  signerSeatIds: string[]
  signatures: Hex[]
  signaturesVerified: boolean
  issuedAt: string
  fresh: boolean
}

export interface ProductionCgEvidenceV1 {
  production: true
  registryAddress: string
  verifierRegistryAddress: string
  groupId: string
  membershipEpoch: number
  keyEpoch: number
  chainNftIds: string[]
  archiveGroupIdByChain: Record<string, string>
  lastACByChain: Record<string, Hex>
  membershipRoot: Hex
  hashIndexRoot: Hex
  queriedAt: string
  viewProofRefs: string[]
}

export interface ProductionDePinEvidenceV1 {
  production: true
  groupId: string
  rosterManifestHash: Hex
  gossipEnvelopeRefs: string[]
  fanoutComplete: boolean
  deduplicated: boolean
  retryAndTimeoutEvidence: boolean
  freezeBeforeBeacon: boolean
  finalizedClRandomness: Hex
  finalizedClSlot: string
  finalizedClEpoch: string
  finalityProofRef: string
  randomnessProofVerified: boolean
  labOnly: false
}

export interface ProductionFreezeObservationV1 {
  freezeStartedAt: string
  evaluatedAt: string
  requiredDays: number
  stable: boolean
  rosterDrift: boolean
  outageWindowRefs: string[]
  consecutiveQualifiedWindows: number
}

export interface ProductionQualificationInputV1 {
  roster: ProductionRosterSnapshotV1
  heartbeat: ProductionHeartbeatEvidenceV1
  bft: ProductionBftEvidenceV1
  archiveCertificates: ProductionArchiveCertificateEvidenceV1[]
  cg: ProductionCgEvidenceV1
  depin: ProductionDePinEvidenceV1
  observation: ProductionFreezeObservationV1
}

export interface ProductionQualificationResultV1 {
  schema: 'ProductionQualificationResultV1'
  pilotQualified: boolean
  productionReadiness: boolean
  reasonCodes: ProductionQualificationReasonCode[]
  rosterManifestHash: Hex | null
  evidence: {
    heartbeat: boolean
    bft: boolean
    archiveCertificate: boolean
    productionCg: boolean
    depinOnDemand: boolean
    thirtyDayFreeze: boolean
  }
}

function addReason(
  reasons: ProductionQualificationReasonCode[],
  reason: ProductionQualificationReasonCode,
): void {
  if (!reasons.includes(reason)) reasons.push(reason)
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort()
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const a = sorted(unique(left))
  const b = sorted(unique(right))
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function isNonEmpty(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== ''
}

function isNonZeroHash(value: string): boolean {
  return /^0x(?!0+$)[0-9a-fA-F]{64}$/.test(value)
}

function validUniqueSigners(
  signerSeatIds: readonly string[],
  signatures: readonly string[],
  allowedSeatIds: readonly string[],
): boolean {
  return signatures.length === signerSeatIds.length &&
    unique(signerSeatIds).length === signerSeatIds.length &&
    signerSeatIds.every((seatId) => allowedSeatIds.includes(seatId))
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function productionRosterManifestHash(
  roster: Omit<ProductionRosterSnapshotV1, 'manifestHash'>,
): Hex {
  return keccak256Utf8(stableJson(roster))
}

export function validateProductionRoster(
  roster: ProductionRosterSnapshotV1,
  reasons: ProductionQualificationReasonCode[],
): void {
  const activeSeats = roster.active.map((seat) => seat.seatId)
  const standbySeats = roster.standby.map((seat) => seat.seatId)
  if (
    roster.schema !== PRODUCTION_ROSTER_SCHEMA ||
    roster.production !== true ||
    roster.active.length !== PRODUCTION_ACTIVE_COUNT ||
    roster.standby.length !== PRODUCTION_STANDBY_COUNT ||
    roster.active.length + roster.standby.length !== PRODUCTION_ROSTER_COUNT
  ) {
    addReason(reasons, 'PRODUCTION_ROSTER_NOT_FIVE_PLUS_TWO')
  }
  if (unique([...activeSeats, ...standbySeats]).length !== PRODUCTION_ROSTER_COUNT) {
    addReason(reasons, 'PRODUCTION_ROSTER_DUPLICATE_SEAT')
  }
  if (roster.extraStandbySeatIds.length > 0) addReason(reasons, 'PRODUCTION_ROSTER_EXTRA_STANDBY')
  if ([...roster.active, ...roster.standby].some((seat) =>
    seat.operatorAddress === '' || seat.signingKeyId === '' || seat.identityEvidenceRef === '')) {
    addReason(reasons, 'PRODUCTION_OPERATOR_IDENTITY_MISSING')
  }
  const { manifestHash: ignored, ...unsigned } = roster
  void ignored
  if (productionRosterManifestHash(unsigned) !== roster.manifestHash) {
    addReason(reasons, 'PRODUCTION_MANIFEST_HASH_MISMATCH')
  }
}

function validateHeartbeat(
  roster: ProductionRosterSnapshotV1,
  heartbeat: ProductionHeartbeatEvidenceV1,
  reasons: ProductionQualificationReasonCode[],
): boolean {
  const seats = [...roster.active, ...roster.standby].map((seat) => seat.seatId)
  if (!heartbeat.production || heartbeat.groupId !== roster.groupId ||
      heartbeat.rosterManifestHash !== roster.manifestHash ||
      heartbeat.releaseId !== roster.releaseId || heartbeat.commit !== roster.commit ||
      heartbeat.snapshotId !== roster.snapshotId || heartbeat.requiredQuorum !== PRODUCTION_HEARTBEAT_QUORUM) {
    addReason(reasons, 'PRODUCTION_HEARTBEAT_SIGNATURE_MISSING')
    return false
  }
  if (heartbeat.sequenceEnd < heartbeat.sequenceStart ||
      heartbeat.sequenceEnd - heartbeat.sequenceStart + 1 !== heartbeat.windows.length ||
      heartbeat.windows.length < heartbeat.requiredConsecutiveWindows) {
    addReason(reasons, 'PRODUCTION_HEARTBEAT_WINDOW_BROKEN')
    return false
  }
  let ok = true
  for (const window of heartbeat.windows) {
    const validSigners = window.signerSeatIds.filter((seat) => seats.includes(seat))
    if (!window.signatureVerified ||
        !validUniqueSigners(window.signerSeatIds, window.signatures, seats)) {
      addReason(reasons, 'PRODUCTION_HEARTBEAT_SIGNATURE_MISSING')
      ok = false
    }
    if (unique(validSigners).length < heartbeat.requiredQuorum) {
      addReason(reasons, 'PRODUCTION_HEARTBEAT_QUORUM_INSUFFICIENT')
      ok = false
    }
    if (window.disconnectedSeatIds.length !== window.disconnectEvidenceRefs.length) {
      addReason(reasons, 'PRODUCTION_HEARTBEAT_DISCONNECT_EVIDENCE_MISSING')
      ok = false
    }
    if (window.continuityEvidenceRef === undefined || window.continuityEvidenceRef === '') {
      addReason(reasons, 'PRODUCTION_HEARTBEAT_WINDOW_BROKEN')
      ok = false
    }
  }
  return ok
}

function validateBft(
  roster: ProductionRosterSnapshotV1,
  bft: ProductionBftEvidenceV1,
  reasons: ProductionQualificationReasonCode[],
): boolean {
  const active = roster.active.map((seat) => seat.seatId)
  if (!bft.production || bft.groupId !== roster.groupId || bft.rosterManifestHash !== roster.manifestHash) {
    addReason(reasons, 'PRODUCTION_BFT_NOT_PRODUCTION')
    return false
  }
  if (bft.phase !== 'CERTIFIED' ||
      bft.prevoteValueHash !== bft.valueHash ||
      bft.precommitValueHash !== bft.valueHash ||
      bft.lockRound > bft.round ||
      !isNonEmpty(bft.walCheckpointRef) ||
      !isNonEmpty(bft.doubleSignCheckRef) ||
      !isNonEmpty(bft.prevoteQcRef) ||
      !isNonEmpty(bft.precommitQcRef)) {
    addReason(reasons, 'PRODUCTION_BFT_STATE_MACHINE_INVALID')
  }
  const prevotes = bft.prevoteSignerSeatIds.filter((seat) => active.includes(seat))
  const precommits = bft.precommitSignerSeatIds.filter((seat) => active.includes(seat))
  let ok = true
  if (unique(prevotes).length < PRODUCTION_BFT_QUORUM || !bft.prevoteQcValid) {
    addReason(reasons, 'PRODUCTION_PREVOTE_QUORUM_INSUFFICIENT')
    ok = false
  }
  if (unique(precommits).length < PRODUCTION_BFT_QUORUM || !bft.precommitQcValid) {
    addReason(reasons, 'PRODUCTION_PRECOMMIT_QUORUM_INSUFFICIENT')
    ok = false
  }
  if (bft.prevoteQcRef === '0x' + '00'.repeat(32) || bft.precommitQcRef === '0x' + '00'.repeat(32)) {
    addReason(reasons, 'PRODUCTION_PRECOMMIT_WITHOUT_PREVOTE_QC')
    ok = false
  }
  if (!bft.lockStatePersisted || !bft.walReplayChecked) {
    addReason(reasons, 'PRODUCTION_BFT_LOCK_OR_WAL_UNPROVEN')
    ok = false
  }
  if (!bft.doubleSignFree) {
    addReason(reasons, 'PRODUCTION_DOUBLE_SIGN_RISK')
    ok = false
  }
  if (!bft.certificateFresh) addReason(reasons, 'PRODUCTION_CERTIFICATE_NOT_FRESH')
  return ok && bft.certificateFresh
}

export function evaluateProductionQualification(
  input: ProductionQualificationInputV1,
): ProductionQualificationResultV1 {
  const reasons: ProductionQualificationReasonCode[] = []
  validateProductionRoster(input.roster, reasons)
  const heartbeat = validateHeartbeat(input.roster, input.heartbeat, reasons)
  const bft = validateBft(input.roster, input.bft, reasons)
  const certificate = input.archiveCertificates.find((candidate) =>
    candidate.production &&
    candidate.groupId === input.roster.groupId &&
    candidate.membershipEpoch === input.roster.membershipEpoch &&
    candidate.keyEpoch === input.roster.keyEpoch &&
    candidate.snapshotId === input.roster.snapshotId &&
    candidate.releaseId === input.roster.releaseId &&
    candidate.hashIndexRoot === input.roster.hashIndexRoot &&
    candidate.membershipRoot === input.roster.membershipRoot &&
    candidate.freezeConfigHash === input.roster.freezeConfigHash &&
    candidate.prevoteQcRef === input.bft.prevoteQcRef &&
    candidate.precommitQcRef === input.bft.precommitQcRef &&
    candidate.commitHash === input.bft.valueHash &&
    candidate.signaturesVerified &&
    candidate.fresh)
  if (certificate === undefined) {
    addReason(reasons, 'PRODUCTION_ARCHIVE_CERTIFICATE_MISSING')
  } else if (certificate.signerSeatIds.length < PRODUCTION_BFT_QUORUM ||
      certificate.groupId !== input.roster.groupId ||
      certificate.chainNftId.trim() === '' ||
      certificate.tipHeight.trim() === '' ||
      certificate.l1Context.blockNumber.trim() === '' ||
      !isNonZeroHash(certificate.l1Context.blockHash)) {
    addReason(reasons, 'PRODUCTION_ARCHIVE_CERTIFICATE_BINDING_MISMATCH')
  } else if (
    certificate.signatures.length !== certificate.signerSeatIds.length ||
    unique(certificate.signerSeatIds).length !== certificate.signerSeatIds.length ||
    certificate.signerSeatIds.some((seatId) => !input.roster.active.some((seat) => seat.seatId === seatId))
  ) {
    addReason(reasons, 'PRODUCTION_ARCHIVE_SIGNATURE_SET_INVALID')
  }
  if (input.roster.hashIndexRoot === '0x' + '00'.repeat(32) ||
      certificate?.hashIndexRoot === '0x' + '00'.repeat(32)) {
    addReason(reasons, 'PRODUCTION_HASH_INDEX_NOT_COMMITTED')
  }
  const cgChains = Object.keys(input.cg.archiveGroupIdByChain)
  if (!input.cg.production) addReason(reasons, 'PRODUCTION_CG_UNAVAILABLE')
  if (input.cg.registryAddress.toLowerCase() !== input.cg.verifierRegistryAddress.toLowerCase()) {
    addReason(reasons, 'PRODUCTION_CG_REGISTRY_MISMATCH')
  }
  if (cgChains.length === 0 || !sameSet(cgChains, input.cg.chainNftIds) ||
      cgChains.some((chainId) => input.cg.archiveGroupIdByChain[chainId] !== input.roster.groupId) ||
      input.cg.membershipRoot !== input.roster.membershipRoot ||
      input.cg.hashIndexRoot !== input.roster.hashIndexRoot ||
      input.cg.lastACByChain === undefined ||
      cgChains.some((chainId) => !isNonZeroHash(input.cg.lastACByChain[chainId] ?? '')) ||
      input.cg.viewProofRefs.length !== cgChains.length ||
      input.cg.viewProofRefs.some((ref) => !isNonEmpty(ref))) {
    addReason(reasons, 'PRODUCTION_CG_CHAIN_COVERAGE_INCOMPLETE')
  }
  if (!input.depin.production || input.depin.labOnly || !input.depin.fanoutComplete ||
      !input.depin.deduplicated || !input.depin.retryAndTimeoutEvidence ||
      input.depin.groupId !== input.roster.groupId ||
      input.depin.rosterManifestHash !== input.roster.manifestHash ||
      input.depin.gossipEnvelopeRefs.length === 0 ||
      input.depin.finalityProofRef.trim() === '' ||
      input.depin.finalizedClSlot.trim() === '' ||
      input.depin.finalizedClEpoch.trim() === '') {
    addReason(reasons, 'PRODUCTION_DEPIN_GOSSIP_MISSING')
    addReason(reasons, 'PRODUCTION_ON_DEMAND_NOT_PRODUCTION')
  }
  if (!input.depin.freezeBeforeBeacon) addReason(reasons, 'PRODUCTION_FREEZE_NOT_BEFORE_BEACON')
  if (!input.depin.randomnessProofVerified || !isNonZeroHash(input.depin.finalizedClRandomness)) {
    addReason(reasons, 'PRODUCTION_CL_RANDOMNESS_UNVERIFIED')
  }
  const freezeMs = Date.parse(input.observation.freezeStartedAt)
  const evaluatedMs = Date.parse(input.observation.evaluatedAt)
  const observationDays = (evaluatedMs - freezeMs) /
    (24 * 60 * 60 * 1000)
  if (!Number.isFinite(freezeMs) || !Number.isFinite(evaluatedMs) ||
      evaluatedMs < freezeMs ||
      !input.observation.stable || input.observation.requiredDays !== PRODUCTION_FREEZE_DAYS ||
      observationDays < PRODUCTION_FREEZE_DAYS ||
      input.observation.consecutiveQualifiedWindows === 0) {
    addReason(reasons, 'PRODUCTION_FREEZE_WINDOW_INCOMPLETE')
  }
  if (input.observation.rosterDrift || input.observation.outageWindowRefs.length > 0) {
    addReason(reasons, 'PRODUCTION_OUTAGE_OR_DRIFT')
  }
  const result: ProductionQualificationResultV1 = {
    schema: 'ProductionQualificationResultV1',
    pilotQualified: reasons.length === 0,
    productionReadiness: reasons.length === 0,
    reasonCodes: reasons,
    rosterManifestHash: input.roster.manifestHash,
    evidence: {
      heartbeat: heartbeat &&
        !reasons.includes('PRODUCTION_HEARTBEAT_DISCONNECT_EVIDENCE_MISSING'),
      bft: bft &&
        !reasons.some((reason) => reason.startsWith('PRODUCTION_PREVOTE_') ||
          reason.startsWith('PRODUCTION_PRECOMMIT_') ||
          reason === 'PRODUCTION_BFT_STATE_MACHINE_INVALID' ||
          reason === 'PRODUCTION_BFT_LOCK_OR_WAL_UNPROVEN' ||
          reason === 'PRODUCTION_DOUBLE_SIGN_RISK' ||
          reason === 'PRODUCTION_CERTIFICATE_NOT_FRESH'),
      archiveCertificate: certificate !== undefined &&
        !reasons.includes('PRODUCTION_ARCHIVE_SIGNATURE_SET_INVALID') &&
        !reasons.includes('PRODUCTION_HASH_INDEX_NOT_COMMITTED'),
      productionCg: input.cg.production &&
        !reasons.includes('PRODUCTION_CG_REGISTRY_MISMATCH') &&
        !reasons.includes('PRODUCTION_CG_CHAIN_COVERAGE_INCOMPLETE'),
      depinOnDemand: input.depin.production && !input.depin.labOnly &&
        input.depin.fanoutComplete && input.depin.randomnessProofVerified &&
        !reasons.includes('PRODUCTION_DEPIN_GOSSIP_MISSING') &&
        !reasons.includes('PRODUCTION_CL_RANDOMNESS_UNVERIFIED'),
      thirtyDayFreeze: !reasons.includes('PRODUCTION_FREEZE_WINDOW_INCOMPLETE') &&
        !reasons.includes('PRODUCTION_OUTAGE_OR_DRIFT'),
    },
  }
  return result
}
