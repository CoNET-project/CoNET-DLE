import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateProductionQualification,
  productionRosterManifestHash,
  type ProductionArchiveCertificateEvidenceV1,
  type ProductionBftEvidenceV1,
  type ProductionCgEvidenceV1,
  type ProductionDePinEvidenceV1,
  type ProductionHeartbeatEvidenceV1,
  type ProductionQualificationInputV1,
  type ProductionRosterSnapshotV1,
} from '../src/archive/syncQualification/productionQualification.js'

const ZERO = `0x${'00'.repeat(32)}` as `0x${string}`
const HASH = `0x${'11'.repeat(32)}` as `0x${string}`

function roster(): ProductionRosterSnapshotV1 {
  const base = {
    schema: 'ProductionRosterSnapshotV1' as const,
    production: true as const,
    groupId: '0xproduction-group',
    membershipEpoch: 3,
    keyEpoch: 4,
    active: Array.from({ length: 5 }, (_, index) => ({
      seatId: `a-${index + 1}`,
      operatorAddress: `0xoperator-${index + 1}`,
      signingKeyId: `key-${index + 1}`,
      identityEvidenceRef: `identity-${index + 1}`,
    })),
    standby: Array.from({ length: 2 }, (_, index) => ({
      seatId: `s-${index + 1}`,
      operatorAddress: `0xstandby-${index + 1}`,
      signingKeyId: `standby-key-${index + 1}`,
      identityEvidenceRef: `standby-identity-${index + 1}`,
    })),
    extraStandbySeatIds: [] as string[],
    releaseId: 'release-production-1',
    commit: 'commit-production-1',
    snapshotId: 'snapshot-production-1',
    freezeConfigHash: HASH,
    hostedChainSetRoot: HASH,
    lastACRef: HASH,
    membershipRoot: HASH,
    hashIndexRoot: HASH,
    capturedAt: '2026-09-01T00:00:00.000Z',
  }
  return { ...base, manifestHash: productionRosterManifestHash(base) }
}

function heartbeat(r: ProductionRosterSnapshotV1): ProductionHeartbeatEvidenceV1 {
  const seats = [...r.active, ...r.standby].map((seat) => seat.seatId)
  return {
    production: true,
    groupId: r.groupId,
    membershipEpoch: r.membershipEpoch,
    keyEpoch: r.keyEpoch,
    rosterManifestHash: r.manifestHash,
    releaseId: r.releaseId,
    commit: r.commit,
    snapshotId: r.snapshotId,
    sequenceStart: 1,
    sequenceEnd: 2,
    nonce: 'nonce-1',
    requiredQuorum: 5,
    requiredConsecutiveWindows: 2,
    windows: [1, 2].map((sequence) => ({
      windowId: `w-${sequence}`,
      startedAt: `2026-09-0${sequence}T00:00:00.000Z`,
      endedAt: `2026-09-0${sequence}T00:05:00.000Z`,
      signerSeatIds: seats.slice(0, 5),
      signatures: seats.slice(0, 5).map(() => HASH),
      signatureVerified: true,
      disconnectedSeatIds: [],
      disconnectEvidenceRefs: [],
      continuityEvidenceRef: `heartbeat-continuity-${sequence}.json`,
    })),
  }
}

function bft(r: ProductionRosterSnapshotV1): ProductionBftEvidenceV1 {
  return {
    production: true,
    groupId: r.groupId,
    membershipEpoch: r.membershipEpoch,
    keyEpoch: r.keyEpoch,
    rosterManifestHash: r.manifestHash,
    height: '100',
    round: 0,
    valueHash: HASH,
    phase: 'CERTIFIED',
    prevoteValueHash: HASH,
    precommitValueHash: HASH,
    lockRound: 0,
    walCheckpointRef: 'wal-checkpoint.json',
    doubleSignCheckRef: 'double-sign-check.json',
    prevoteSignerSeatIds: r.active.slice(0, 4).map((seat) => seat.seatId),
    prevoteQcRef: HASH,
    precommitSignerSeatIds: r.active.slice(0, 4).map((seat) => seat.seatId),
    precommitQcRef: HASH,
    prevoteQcValid: true,
    precommitQcValid: true,
    certificateFresh: true,
    lockStatePersisted: true,
    walReplayChecked: true,
    doubleSignFree: true,
    signatureEvidenceRefs: ['bft-signatures.json'],
  }
}

function certificate(r: ProductionRosterSnapshotV1, b: ProductionBftEvidenceV1): ProductionArchiveCertificateEvidenceV1 {
  return {
    production: true,
    groupId: r.groupId,
    membershipEpoch: r.membershipEpoch,
    keyEpoch: r.keyEpoch,
    snapshotId: r.snapshotId,
    releaseId: r.releaseId,
    commitHash: b.valueHash,
    chainNftId: '42',
    tipHeight: '100',
    parentAC: ZERO,
    stateRoot: HASH,
    daRoot: HASH,
    membershipRoot: r.membershipRoot,
    hashIndexRoot: r.hashIndexRoot,
    freezeConfigHash: r.freezeConfigHash,
    l1Context: { blockNumber: '900000', blockHash: HASH },
    prevoteQcRef: b.prevoteQcRef,
    precommitQcRef: b.precommitQcRef,
    signerSeatIds: r.active.slice(0, 4).map((seat) => seat.seatId),
    signatures: r.active.slice(0, 4).map(() => HASH),
    signaturesVerified: true,
    issuedAt: '2026-09-01T00:10:00.000Z',
    fresh: true,
  }
}

function cg(r: ProductionRosterSnapshotV1): ProductionCgEvidenceV1 {
  return {
    production: true,
    registryAddress: '0xregistry',
    verifierRegistryAddress: '0xregistry',
    groupId: r.groupId,
    membershipEpoch: r.membershipEpoch,
    keyEpoch: r.keyEpoch,
    chainNftIds: ['42', '43'],
    archiveGroupIdByChain: { '42': r.groupId, '43': r.groupId },
    lastACByChain: { '42': HASH, '43': HASH },
    membershipRoot: r.membershipRoot,
    hashIndexRoot: r.hashIndexRoot,
    queriedAt: '2026-09-01T00:15:00.000Z',
    viewProofRefs: ['l1-view-42.json', 'l1-view-43.json'],
  }
}

function depin(r: ProductionRosterSnapshotV1): ProductionDePinEvidenceV1 {
  return {
    production: true,
    groupId: r.groupId,
    rosterManifestHash: r.manifestHash,
    gossipEnvelopeRefs: ['gossip-envelope-batch.json'],
    fanoutComplete: true,
    deduplicated: true,
    retryAndTimeoutEvidence: true,
    freezeBeforeBeacon: true,
    finalizedClRandomness: HASH,
    finalizedClSlot: '900',
    finalizedClEpoch: '28',
    finalityProofRef: 'cl-finality.json',
    randomnessProofVerified: true,
    labOnly: false,
  }
}

function input(): ProductionQualificationInputV1 {
  const r = roster()
  const b = bft(r)
  return {
    roster: r,
    heartbeat: heartbeat(r),
    bft: b,
    archiveCertificates: [certificate(r, b)],
    cg: cg(r),
    depin: depin(r),
    observation: {
      freezeStartedAt: '2026-08-01T00:00:00.000Z',
      evaluatedAt: '2026-09-01T00:00:00.000Z',
      requiredDays: 30,
      stable: true,
      rosterDrift: false,
      outageWindowRefs: [],
      consecutiveQualifiedWindows: 2,
    },
  }
}

test('production qualification accepts only a complete, independently bound evidence set', () => {
  const result = evaluateProductionQualification(input())
  assert.equal(result.pilotQualified, true)
  assert.deepEqual(result.reasonCodes, [])
})

test('3/7 heartbeat and extra standby fail closed', () => {
  const value = input()
  value.roster.extraStandbySeatIds = ['fd-08']
  value.heartbeat.windows[0].signerSeatIds = value.heartbeat.windows[0].signerSeatIds.slice(0, 3)
  value.heartbeat.windows[0].signatures = value.heartbeat.windows[0].signatures.slice(0, 3)
  const result = evaluateProductionQualification(value)
  assert.equal(result.pilotQualified, false)
  assert.equal(result.reasonCodes.includes('PRODUCTION_ROSTER_EXTRA_STANDBY'), true)
  assert.equal(result.reasonCodes.includes('PRODUCTION_HEARTBEAT_QUORUM_INSUFFICIENT'), true)
})

test('missing hash-index root and verifier registry mismatch cannot qualify C_G/AC', () => {
  const value = input()
  value.roster.hashIndexRoot = ZERO
  value.cg.verifierRegistryAddress = '0xold-archive-group-registry'
  const result = evaluateProductionQualification(value)
  assert.equal(result.pilotQualified, false)
  assert.equal(result.reasonCodes.includes('PRODUCTION_HASH_INDEX_NOT_COMMITTED'), true)
  assert.equal(result.reasonCodes.includes('PRODUCTION_CG_REGISTRY_MISMATCH'), true)
})

test('BFT cannot skip the certified state machine or WAL/double-sign evidence', () => {
  const value = input()
  value.bft.phase = 'CERTIFIED'
  value.bft.precommitValueHash = '0xdifferent'
  value.bft.walCheckpointRef = ''
  const result = evaluateProductionQualification(value)
  assert.equal(result.pilotQualified, false)
  assert.equal(result.reasonCodes.includes('PRODUCTION_BFT_STATE_MACHINE_INVALID'), true)
})

test('lab-only beacon and non-finalized randomness cannot qualify on-demand', () => {
  const value = input()
  value.depin.labOnly = true
  value.depin.randomnessProofVerified = false
  value.depin.finalizedClRandomness = ZERO
  const result = evaluateProductionQualification(value)
  assert.equal(result.pilotQualified, false)
  assert.equal(result.reasonCodes.includes('PRODUCTION_ON_DEMAND_NOT_PRODUCTION'), true)
  assert.equal(result.reasonCodes.includes('PRODUCTION_CL_RANDOMNESS_UNVERIFIED'), true)
})
