import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluatePilotQualification,
  type QualificationNodeEvidence,
} from '../src/archive/syncQualification/qualificationGate.js'
import {
  canonicalStandbyDomainId,
  isExtraStandby,
  isOfficialStandbyRole,
} from '../src/archive/syncQualification/types.js'

function evidence(domainId: string, overrides: Partial<QualificationNodeEvidence> = {}): QualificationNodeEvidence {
  return {
    domainId,
    role: 'active',
    releaseId: 'release-1',
    commit: 'commit-1',
    rosterHash: 'roster-1',
    snapshotId: 'snapshot-1',
    freezeConfigHash: 'freeze-1',
    officialStandby: false,
    extraStandby: false,
    ac: { committed: true, pending: false, snapshotId: 'snapshot-1' },
    bft: {
      productionCertificate: true,
      productionOperatorKey: true,
      processStarted: true,
      networked: true,
      certificateAvailable: true,
      prevoteCount: 5,
      precommitCount: 5,
      quorum: 5,
      certificateFresh: true,
      snapshotId: 'snapshot-1',
    },
    cg: {
      available: true,
      production: true,
      labBeaconOnly: false,
      productionDepin: true,
    },
    trade: {
      inScope: false,
      production: false,
      mock: true,
    },
    ...overrides,
  }
}

test('standby deployment aliases normalize without promoting extra standby', () => {
  assert.equal(canonicalStandbyDomainId('fd-06-ionos-174'), 'fd-06')
  assert.equal(canonicalStandbyDomainId('FD-07-ionos-207'), 'fd-07')
  assert.equal(isOfficialStandbyRole('fd-06-ionos-174', 'standby'), true)
  assert.equal(isExtraStandby('fd-08-hosthatch-hk1'), true)
  assert.equal(isOfficialStandbyRole('fd-08-hosthatch-hk1', 'standby'), false)
  assert.equal(canonicalStandbyDomainId('fd-05-hosthatch-tokyo2'), null)
})

test('qualification gate rejects release, snapshot, and standby drift', () => {
  const nodes = Array.from({ length: 7 }, (_, index) => evidence(`fd-0${index + 1}`))
  nodes[1] = evidence('fd-02', { commit: 'different-commit' })
  nodes[2] = evidence('fd-03', { snapshotId: 'different-snapshot' })
  nodes[3] = evidence('fd-04', { role: 'standby', officialStandby: false })
  const result = evaluatePilotQualification(nodes)
  assert.equal(result.pilotQualified, false)
  assert.equal(result.reasonCodes.includes('INCONSISTENT_RELEASE'), true)
  assert.equal(result.reasonCodes.includes('INCONSISTENT_SNAPSHOT'), true)
  assert.equal(result.reasonCodes.includes('STANDBY_CLASSIFICATION_DRIFT'), true)
})

test('qualification gate rejects pending archive certificate and lab-only BFT', () => {
  const nodes = Array.from({ length: 7 }, (_, index) => evidence(`fd-0${index + 1}`))
  nodes[0] = evidence('fd-01', {
    ac: { committed: false, pending: true, snapshotId: 'other-snapshot' },
    bft: {
      productionCertificate: false,
      productionOperatorKey: false,
      processStarted: true,
      networked: true,
      certificateAvailable: true,
      prevoteCount: 5,
      precommitCount: 5,
      quorum: 5,
      certificateFresh: true,
      snapshotId: 'snapshot-1',
    },
    cg: { available: false, production: false, labBeaconOnly: true, productionDepin: false },
  })
  const result = evaluatePilotQualification(nodes)
  assert.equal(result.pilotQualified, false)
  assert.equal(result.reasonCodes.includes('AC_NOT_COMMITTED'), true)
  assert.equal(result.reasonCodes.includes('AC_PENDING'), true)
  assert.equal(result.reasonCodes.includes('AC_SNAPSHOT_MISMATCH'), true)
  assert.equal(result.reasonCodes.includes('PRODUCTION_CG_UNAVAILABLE'), true)
  assert.equal(result.reasonCodes.includes('LAB_BEACON_ONLY'), true)
  assert.equal(result.reasonCodes.includes('NON_PRODUCTION_DEPIN_GOSSIP'), true)
})

test('qualification gate rejects missing production operator evidence', () => {
  const nodes = Array.from({ length: 7 }, (_, index) => evidence(`fd-0${index + 1}`))
  nodes[0] = evidence('fd-01', {
    bft: {
      productionCertificate: false,
      productionOperatorKey: false,
      processStarted: true,
      networked: true,
      certificateAvailable: true,
      prevoteCount: 5,
      precommitCount: 5,
      quorum: 5,
      certificateFresh: true,
      snapshotId: 'snapshot-1',
    },
  })
  const result = evaluatePilotQualification(nodes)
  assert.equal(result.pilotQualified, false)
  assert.equal(result.reasonCodes.includes('BFT_CERTIFICATE_UNAVAILABLE'), true)
})

test('qualification gate requires current prevote and precommit quorums', () => {
  const nodes = Array.from({ length: 7 }, (_, index) => evidence(`fd-0${index + 1}`))
  nodes[0] = evidence('fd-01', {
    bft: {
      productionCertificate: true,
      productionOperatorKey: true,
      processStarted: true,
      networked: true,
      certificateAvailable: true,
      prevoteCount: 4,
      precommitCount: 3,
      quorum: 5,
      certificateFresh: true,
      snapshotId: 'snapshot-1',
    },
  })
  const result = evaluatePilotQualification(nodes)
  assert.equal(result.pilotQualified, false)
  assert.equal(result.reasonCodes.includes('BFT_PREVOTE_INSUFFICIENT'), true)
  assert.equal(result.reasonCodes.includes('BFT_PRECOMMIT_INSUFFICIENT'), true)
})

test('qualification gate rejects stale certificates and signer-set drift', () => {
  const nodes = Array.from({ length: 7 }, (_, index) => evidence(`fd-0${index + 1}`))
  nodes[0] = evidence('fd-01', {
    ac: {
      committed: true,
      pending: false,
      snapshotId: 'snapshot-1',
      signerSet: ['fd-01', 'fd-02'],
    },
    bft: {
      productionCertificate: true,
      productionOperatorKey: true,
      processStarted: true,
      networked: true,
      certificateAvailable: true,
      prevoteCount: 5,
      precommitCount: 5,
      quorum: 5,
      certificateFresh: false,
      signerSet: ['fd-01', 'fd-03'],
      snapshotId: 'snapshot-1',
    },
  })
  const result = evaluatePilotQualification(nodes)
  assert.equal(result.pilotQualified, false)
  assert.equal(result.reasonCodes.includes('BFT_CERTIFICATE_STALE'), true)
  assert.equal(result.reasonCodes.includes('BFT_SIGNER_SET_MISMATCH'), true)
})

test('trade exclusion is explicit and never reports production readiness', () => {
  const nodes = Array.from({ length: 7 }, (_, index) => evidence(`fd-0${index + 1}`))
  const result = evaluatePilotQualification(nodes)
  assert.equal(result.trade.inScope, false)
  assert.equal(result.trade.excluded, true)
  assert.equal(result.trade.production, false)
  assert.equal(result.trade.mock, true)
  assert.equal(result.reasonCodes.includes('TRADE_NOT_PRODUCTION'), false)
  assert.equal(result.productionReadiness, false)
})
