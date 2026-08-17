import { createHash, createHmac } from 'node:crypto'
import { toHex, type Hex } from '../../shared/bytes.js'
import {
  archiveStandbyReadinessMessage,
  labSeatingAddress,
  recoverArchiveStandbyReadiness,
  signArchiveStandbyReadiness,
} from './eip712.js'
import {
  ERR_SYNC_STANDBY,
  ERR_SYNC_STANDBY_HMAC_CUTOVER,
  ERR_SYNC_STANDBY_SIG,
  type ArchiveStandbyHmacReadinessV1,
  type ArchiveStandbyReadinessEnvelope,
  type ArchiveStandbyReadinessV1,
} from './types.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isHex32(value: unknown): value is Hex {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)
}

function hmacKey(domainId: string): Buffer {
  return createHash('sha256').update(`dle.archive.lab.standby.mac.v1|${domainId}`, 'utf8').digest()
}

function hmacCanonical(input: {
  domainId: string
  groupId: string
  hostedChainSetRoot: Hex
  lastACRef: Hex
  membershipRoot: Hex
  hashIndexRoot: Hex
  ready: boolean
}): string {
  return [
    'dle.archive.lab.standby.ready.v1',
    input.domainId,
    input.groupId,
    input.hostedChainSetRoot,
    input.lastACRef,
    input.membershipRoot,
    input.hashIndexRoot,
    input.ready ? '1' : '0',
  ].join('|')
}

export function isHmacStandbyReady(value: unknown): boolean {
  if (!isRecord(value) || value.schema !== 'ArchiveStandbyReadinessV1') return true
  if (value.hmacForgeable === true) return true
  if (value.eip712 !== true) return true
  if (typeof value.signature !== 'string' || !value.signature.startsWith('0x')) return true
  if (typeof value.signer !== 'string') return true
  if (typeof value.mac === 'string') return true
  return false
}

export function parseArchiveStandbyReadiness(
  value: unknown,
): { ok: true; envelope: ArchiveStandbyReadinessEnvelope } | { ok: false; error: string } {
  if (!isRecord(value) || value.schema !== 'ArchiveStandbyReadinessV1') {
    return { ok: false, error: ERR_SYNC_STANDBY }
  }
  if (typeof value.domainId !== 'string' || value.domainId === '') {
    return { ok: false, error: ERR_SYNC_STANDBY }
  }
  if (typeof value.groupId !== 'string' || value.groupId === '') {
    return { ok: false, error: ERR_SYNC_STANDBY }
  }
  if (
    !isHex32(value.hostedChainSetRoot) ||
    !isHex32(value.lastACRef) ||
    !isHex32(value.membershipRoot) ||
    !isHex32(value.hashIndexRoot)
  ) {
    return { ok: false, error: ERR_SYNC_STANDBY }
  }
  if (typeof value.ready !== 'boolean') return { ok: false, error: ERR_SYNC_STANDBY }
  const base = {
    schema: 'ArchiveStandbyReadinessV1' as const,
    labOnly: true as const,
    domainId: value.domainId,
    groupId: value.groupId,
    hostedChainSetRoot: value.hostedChainSetRoot,
    lastACRef: value.lastACRef,
    membershipRoot: value.membershipRoot,
    hashIndexRoot: value.hashIndexRoot,
    ready: value.ready,
  }
  if (isHmacStandbyReady(value)) {
    if (typeof value.mac !== 'string' || !value.mac.startsWith('0x')) {
      return { ok: false, error: ERR_SYNC_STANDBY }
    }
    const hmac: ArchiveStandbyHmacReadinessV1 = {
      ...base,
      hmacForgeable: true,
      eip712: false,
      mac: value.mac as Hex,
    }
    return { ok: true, envelope: hmac }
  }
  if (typeof value.signer !== 'string' || typeof value.signature !== 'string') {
    return { ok: false, error: ERR_SYNC_STANDBY }
  }
  const eip712: ArchiveStandbyReadinessV1 = {
    ...base,
    eip712: true,
    hmacForgeable: false,
    notProductionSecp256k1: true,
    notProductionOperatorKey: true,
    labDeterministicSeatingKey: true,
    notL1Settled: true,
    notThirtyDayQualification: true,
    signer: value.signer,
    signature: value.signature as Hex,
  }
  return { ok: true, envelope: eip712 }
}

export function makeArchiveStandbyReadiness(input: {
  domainId: string
  groupId: string
  hostedChainSetRoot: Hex
  lastACRef: Hex
  membershipRoot: Hex
  hashIndexRoot: Hex
  ready: boolean
}): ArchiveStandbyReadinessV1 {
  const message = archiveStandbyReadinessMessage({
    groupId: input.groupId,
    hostedChainSetRoot: input.hostedChainSetRoot,
    lastACRef: input.lastACRef,
    membershipRoot: input.membershipRoot,
    hashIndexRoot: input.hashIndexRoot,
    ready: input.ready,
  })
  return {
    schema: 'ArchiveStandbyReadinessV1',
    labOnly: true,
    eip712: true,
    hmacForgeable: false,
    notProductionSecp256k1: true,
    notProductionOperatorKey: true,
    labDeterministicSeatingKey: true,
    notL1Settled: true,
    notThirtyDayQualification: true,
    domainId: input.domainId,
    groupId: input.groupId,
    hostedChainSetRoot: input.hostedChainSetRoot,
    lastACRef: input.lastACRef,
    membershipRoot: input.membershipRoot,
    hashIndexRoot: input.hashIndexRoot,
    ready: input.ready,
    signer: labSeatingAddress(input.domainId),
    signature: signArchiveStandbyReadiness(input.domainId, message),
  }
}

export function makeHmacStandbyReady(input: {
  domainId: string
  groupId: string
  hostedChainSetRoot: Hex
  lastACRef: Hex
  membershipRoot: Hex
  hashIndexRoot: Hex
  ready: boolean
}): ArchiveStandbyHmacReadinessV1 {
  const mac = toHex(
    createHmac('sha256', hmacKey(input.domainId)).update(hmacCanonical(input), 'utf8').digest(),
  )
  return {
    schema: 'ArchiveStandbyReadinessV1',
    labOnly: true,
    hmacForgeable: true,
    eip712: false,
    domainId: input.domainId,
    groupId: input.groupId,
    hostedChainSetRoot: input.hostedChainSetRoot,
    lastACRef: input.lastACRef,
    membershipRoot: input.membershipRoot,
    hashIndexRoot: input.hashIndexRoot,
    ready: input.ready,
    mac,
  }
}

export function verifyEip712StandbyReady(
  envelope: ArchiveStandbyReadinessEnvelope,
): { ok: true; recovered: string } | { ok: false; error: string } {
  if (isHmacStandbyReady(envelope)) return { ok: false, error: ERR_SYNC_STANDBY_HMAC_CUTOVER }
  const signed = envelope as ArchiveStandbyReadinessV1
  try {
    const recovered = recoverArchiveStandbyReadiness(
      archiveStandbyReadinessMessage({
        groupId: signed.groupId,
        hostedChainSetRoot: signed.hostedChainSetRoot,
        lastACRef: signed.lastACRef,
        membershipRoot: signed.membershipRoot,
        hashIndexRoot: signed.hashIndexRoot,
        ready: signed.ready,
      }),
      signed.signature,
    )
    const expected = labSeatingAddress(signed.domainId)
    if (recovered.toLowerCase() !== expected.toLowerCase()) {
      return { ok: false, error: ERR_SYNC_STANDBY_SIG }
    }
    if (signed.signer.toLowerCase() !== expected.toLowerCase()) {
      return { ok: false, error: ERR_SYNC_STANDBY_SIG }
    }
    return { ok: true, recovered }
  } catch {
    return { ok: false, error: ERR_SYNC_STANDBY_SIG }
  }
}

export function parseStandbyReadyMap(value: unknown): Record<string, ArchiveStandbyReadinessEnvelope> {
  if (!isRecord(value)) return {}
  const out: Record<string, ArchiveStandbyReadinessEnvelope> = {}
  for (const [domainId, row] of Object.entries(value)) {
    const parsed = parseArchiveStandbyReadiness(row)
    if (!parsed.ok) continue
    out[domainId] = parsed.envelope
  }
  return out
}
