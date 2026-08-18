import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { archiveSeatingPill } from '../src/lib/archiveSeating.ts'
import { labSeatingDetailLabel, labSeatingGaugeHint } from '../src/lib/labSeatingCopy.ts'
import {
  ZERO32,
  hashIndexCommittedInAcFromRoot,
  hashIndexCommittedInAcPill,
  officialStandbysReadyPill,
  parseClockIsNotQualification,
  parseExtraStandbyReadyDoesNotCount,
  parseHashIndexCommittedInAc,
  parseOfficialStandbyReadyCount,
  parseOfficialStandbysReady,
  parsePilotQualified,
  parsePilotRunning,
  parsePilotStartedAt,
  parseStandbyReadyEip712,
  parseWarmupStartedAt,
  pilotClockPill,
} from '../src/lib/labOverlays.ts'
import type { LabArchiveRow } from '../src/types.ts'

const EMPTY_ROOT = '0x1111111111111111111111111111111111111111111111111111111111111111'

function seatingRow(partial: Partial<LabArchiveRow>): LabArchiveRow {
  return {
    domainId: 'fd-01-ionos-45',
    operatorDomainId: 'lab',
    hostId: 'fd-01',
    provider: 'ionos',
    region: 'us',
    role: 'active',
    health: 'live',
    lastQuorumOk: true,
    lastPeerOk: 6,
    heartbeats: 1,
    syncPhase: null,
    seatingQualified: false,
    participantWallet: '0x0000000000000000000000000000000000000001',
    source: 'live',
    ...partial,
  }
}

describe('P25 lab overlays', () => {
  it('treats ZERO32 and missing root as not bound', () => {
    assert.equal(hashIndexCommittedInAcFromRoot(undefined), false)
    assert.equal(hashIndexCommittedInAcFromRoot(ZERO32), false)
    assert.equal(hashIndexCommittedInAcFromRoot(ZERO32.toUpperCase()), false)
    assert.equal(hashIndexCommittedInAcFromRoot(EMPTY_ROOT), true)
  })

  it('prefers trusted health boolean over certificate derivation', () => {
    assert.equal(parseHashIndexCommittedInAc({ hashIndexCommittedInAc: true }, { hashIndexRoot: ZERO32 }), true)
    assert.equal(parseHashIndexCommittedInAc({ hashIndexCommittedInAc: false }, { hashIndexRoot: EMPTY_ROOT }), false)
  })

  it('derives overlay from a non-zero certificate root when health omits the flag', () => {
    assert.equal(parseHashIndexCommittedInAc({}, { hashIndexRoot: EMPTY_ROOT }), true)
    assert.equal(parseHashIndexCommittedInAc({}, { hashIndexRoot: ZERO32 }), false)
  })

  it('returns null when health and certificate both omit the overlay', () => {
    assert.equal(parseHashIndexCommittedInAc(null, null), null)
    assert.equal(parseHashIndexCommittedInAc({}, {}), null)
    assert.equal(parseHashIndexCommittedInAc({ hashIndexCommittedInAc: 'yes' }, null), null)
  })

  it('reads officialStandbysReady from top-level, syncQualification, then new-chain alias', () => {
    assert.equal(parseOfficialStandbysReady(null), null)
    assert.equal(parseOfficialStandbysReady({ officialStandbysReady: true }), true)
    assert.equal(
      parseOfficialStandbysReady({
        officialStandbysReady: false,
        syncQualification: { officialStandbysReady: true },
      }),
      false,
    )
    assert.equal(parseOfficialStandbysReady({ syncQualification: { officialStandbysReady: true } }), true)
    assert.equal(parseOfficialStandbysReady({ newchainOfficialStandbysReady: true }), true)
    assert.equal(
      parseOfficialStandbysReady({
        syncQualification: { officialStandbysReady: false },
        newchainOfficialStandbysReady: true,
      }),
      false,
    )
  })

  it('reads official count and EIP-712 flags from nested syncQualification', () => {
    const health = {
      syncQualification: {
        officialStandbyReadyCount: 2,
        officialStandbysReady: true,
        standbyReadyEip712: true,
        extraStandbyReadyDoesNotCount: true,
      },
    }
    assert.equal(parseOfficialStandbyReadyCount(health), 2)
    assert.equal(parseStandbyReadyEip712(health), true)
    assert.equal(parseExtraStandbyReadyDoesNotCount(health), true)
    assert.equal(parseOfficialStandbyReadyCount({ officialStandbyReadyCount: 1 }), 1)
    assert.equal(parseOfficialStandbyReadyCount(null), null)
  })

  it('never paints overlay pills green', () => {
    assert.equal(officialStandbysReadyPill(null), null)
    assert.deepEqual(officialStandbysReadyPill(true), {
      label: 'Official standbys ready (lab overlay)',
      tone: 'blue',
    })
    assert.deepEqual(officialStandbysReadyPill(false), {
      label: 'Official standbys not ready',
      tone: 'warn',
    })
    assert.deepEqual(hashIndexCommittedInAcPill(true), {
      label: 'Hash index bound in AC (lab overlay)',
      tone: 'purple',
    })
    assert.deepEqual(hashIndexCommittedInAcPill(false), {
      label: 'Hash index not bound in AC',
      tone: 'neutral',
    })
    assert.notEqual(officialStandbysReadyPill(true)?.tone, 'ok')
    assert.notEqual(hashIndexCommittedInAcPill(true)?.tone, 'ok')
  })

  it('reads the 30-day clock from top-level then nested health, never as qualification', () => {
    const live = '2026-08-18T09:53:58.092Z'
    const warmup = '2026-08-14T17:10:16.786Z'
    assert.equal(parsePilotRunning(null), null)
    assert.equal(parsePilotRunning({}), null)
    assert.equal(parsePilotRunning({ officialStandbysReady: true }), null)
    assert.equal(parsePilotRunning({ pilotRunning: true }), true)
    assert.equal(parsePilotRunning({ pilotRunning: false, pilotStartedAt: live }), false)
    assert.equal(parsePilotRunning({ syncQualification: { pilotRunning: true } }), true)
    assert.equal(parsePilotRunning({ pilotStartedAt: live }), true)
    assert.equal(parsePilotRunning({ syncQualification: { pilotStartedAt: live } }), true)
    assert.equal(parsePilotRunning({ pilotStartedAt: null }), false)
    assert.equal(parsePilotRunning({ pilotStartedAt: 'not-an-iso' }), null)
    assert.equal(parsePilotStartedAt({ pilotStartedAt: live }), live)
    assert.equal(parseWarmupStartedAt({ warmupStartedAt: warmup }), warmup)
    assert.equal(parseClockIsNotQualification({ clockIsNotQualification: true }), true)
    assert.equal(parsePilotQualified({}), null)
    assert.equal(parsePilotQualified({ pilotRunning: true, pilotQualified: true }), false)
    assert.equal(parsePilotQualified({ clockIsNotQualification: true, pilotQualified: true }), false)
  })

  it('never paints the clock pill green or as 30-day qualified', () => {
    assert.equal(pilotClockPill(null), null)
    assert.deepEqual(pilotClockPill(true), {
      label: '30-day clock running (not qualified)',
      tone: 'warn',
    })
    assert.deepEqual(pilotClockPill(false), {
      label: '30-day clock not started',
      tone: 'neutral',
    })
    assert.notEqual(pilotClockPill(true)?.tone, 'ok')
    assert.notEqual(pilotClockPill(false)?.tone, 'ok')
    assert.match(pilotClockPill(true)?.label ?? '', /not qualified/)
    assert.doesNotMatch(pilotClockPill(true)?.label ?? '', /30-day qualified/)
  })

  it('keeps green seating pills on seatingQualified === true only', () => {
    assert.deepEqual(archiveSeatingPill(seatingRow({ seatingQualified: true, syncPhase: 'QUALIFIED' })), {
      label: 'seated',
      tone: 'ok',
    })
    assert.deepEqual(archiveSeatingPill(seatingRow({ seatingQualified: false, syncPhase: 'QUALIFIED' })), {
      label: 'not seated',
      tone: 'neutral',
    })
    assert.notEqual(
      archiveSeatingPill(seatingRow({ seatingQualified: false, lastQuorumOk: true })).tone,
      'ok',
    )
    assert.equal(labSeatingGaugeHint(7), 'Lab EIP-712 seated')
    assert.equal(labSeatingGaugeHint(0), 'Not seated')
    assert.equal(labSeatingDetailLabel(true, 'QUALIFIED'), 'seated (lab EIP-712)')
    assert.equal(labSeatingDetailLabel(false, 'SYNCING'), 'SYNCING')
    assert.doesNotMatch(labSeatingGaugeHint(1), /hmac/i)
    assert.doesNotMatch(labSeatingDetailLabel(true, 'QUALIFIED'), /hmac/i)
  })
})
