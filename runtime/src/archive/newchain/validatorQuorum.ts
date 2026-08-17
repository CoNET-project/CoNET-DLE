/** Laboratory Q_V=5/7. P18: new quorums are EIP-712. HMAC is keep-only / cutover tests. */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { getAddress } from 'ethers'
import { concatBytes, fromHex, keccak256Utf8, toHex, type Hex } from '../../shared/bytes.js'
import { HASH32_RE } from '../../shared/hashLookup.js'
import {
  labSeatingAddress,
  recoverArchiveValidatorQuorumAttest,
  signArchiveValidatorQuorumAttest,
  type ArchiveValidatorQuorumAttestTyped,
} from '../syncQualification/eip712.js'

export const LAB_VALIDATOR_COUNT = 7
export const LAB_VALIDATOR_QUORUM = 5
export const LAB_VALIDATOR_QUORUM_SCHEMA = 'DleLabValidatorQuorumV1' as const
export const ERR_VALIDATOR_QUORUM_HMAC_CUTOVER = 'ERR_VALIDATOR_QUORUM_HMAC_CUTOVER'
export const ERR_VALIDATOR_QUORUM_SIG = 'ERR_VALIDATOR_QUORUM_SIG'

export interface DleLabValidatorAttestationV1 {
  validatorId: Hex
  mac?: Hex
  signature?: Hex
  signer?: string
  eip712?: boolean
  hmacForgeable?: boolean
}

export interface DleLabValidatorQuorumV1 {
  schema: typeof LAB_VALIDATOR_QUORUM_SCHEMA
  labOnly: true
  hmacForgeable: boolean
  eip712?: boolean
  validatorQuorumEip712?: boolean
  notProductionSecp256k1: true
  labDeterministicSeatingKey?: boolean
  notProductionOperatorKey?: boolean
  notL1Settled?: boolean
  quorum: typeof LAB_VALIDATOR_QUORUM
  committeeSize: typeof LAB_VALIDATOR_COUNT
  committee: Hex[]
  attestations: DleLabValidatorAttestationV1[]
}

export interface ValidatorQuorumSubject {
  requestId: Hex
  valueHash: Hex
  tipStateRoot: Hex
  bodyCommitment: Hex
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isHex32(value: unknown): value is Hex {
  return typeof value === 'string' && HASH32_RE.test(value)
}

export function labValidatorId(requestId: Hex, index: number): Hex {
  return keccak256Utf8(`dle.lab.validator.id.v1|${requestId.toLowerCase()}|${index}`)
}

export function labValidatorCommittee(requestId: Hex): Hex[] {
  return Array.from({ length: LAB_VALIDATOR_COUNT }, (_, index) => labValidatorId(requestId, index))
}

function macKey(validatorId: Hex): Buffer {
  return createHash('sha256').update(`dle.lab.validator.mac.v1|${validatorId.toLowerCase()}`, 'utf8').digest()
}

export function validatorVoteBytes(subject: ValidatorQuorumSubject): Uint8Array {
  return concatBytes(
    new TextEncoder().encode('dle.lab.validator.vote.v1'),
    fromHex(subject.requestId, 32),
    fromHex(subject.valueHash, 32),
    fromHex(subject.tipStateRoot, 32),
    fromHex(subject.bodyCommitment, 32),
  )
}

/** Legacy HMAC. Tests use this to prove P18 cutover. New quorums must not use it. */
export function signHmacLabValidatorAttestation(validatorId: Hex, subject: ValidatorQuorumSubject): Hex {
  return toHex(createHmac('sha256', macKey(validatorId)).update(validatorVoteBytes(subject)).digest())
}

export function verifyHmacLabValidatorAttestation(
  attestation: DleLabValidatorAttestationV1,
  subject: ValidatorQuorumSubject,
): boolean {
  if (typeof attestation.mac !== 'string') return false
  let expected: Uint8Array
  let actual: Uint8Array
  try {
    expected = fromHex(signHmacLabValidatorAttestation(attestation.validatorId, subject), 32)
    actual = fromHex(attestation.mac, 32)
  } catch {
    return false
  }
  if (actual.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
}

export function buildHmacLabValidatorQuorum(subject: ValidatorQuorumSubject): DleLabValidatorQuorumV1 {
  const committee = labValidatorCommittee(subject.requestId)
  return {
    schema: LAB_VALIDATOR_QUORUM_SCHEMA,
    labOnly: true,
    hmacForgeable: true,
    eip712: false,
    notProductionSecp256k1: true,
    quorum: LAB_VALIDATOR_QUORUM,
    committeeSize: LAB_VALIDATOR_COUNT,
    committee,
    attestations: committee.map((validatorId) => ({
      validatorId,
      mac: signHmacLabValidatorAttestation(validatorId, subject),
      hmacForgeable: true,
      eip712: false,
    })),
  }
}

export function archiveValidatorQuorumAttestTyped(subject: ValidatorQuorumSubject): ArchiveValidatorQuorumAttestTyped {
  return {
    requestId: subject.requestId,
    valueHash: subject.valueHash,
    tipStateRoot: subject.tipStateRoot,
    bodyCommitment: subject.bodyCommitment,
  }
}

export function signLabValidatorAttestation(validatorId: Hex, subject: ValidatorQuorumSubject): Hex {
  return signArchiveValidatorQuorumAttest(validatorId, archiveValidatorQuorumAttestTyped(subject))
}

export function makeLabValidatorAttestation(
  validatorId: Hex,
  subject: ValidatorQuorumSubject,
): DleLabValidatorAttestationV1 {
  const signer = labSeatingAddress(validatorId)
  return {
    validatorId,
    signature: signLabValidatorAttestation(validatorId, subject),
    signer,
    eip712: true,
    hmacForgeable: false,
  }
}

export function buildLabValidatorQuorum(subject: ValidatorQuorumSubject): DleLabValidatorQuorumV1 {
  const committee = labValidatorCommittee(subject.requestId)
  return {
    schema: LAB_VALIDATOR_QUORUM_SCHEMA,
    labOnly: true,
    hmacForgeable: false,
    eip712: true,
    validatorQuorumEip712: true,
    notProductionSecp256k1: true,
    labDeterministicSeatingKey: true,
    notProductionOperatorKey: true,
    notL1Settled: true,
    quorum: LAB_VALIDATOR_QUORUM,
    committeeSize: LAB_VALIDATOR_COUNT,
    committee,
    attestations: committee.map((validatorId) => makeLabValidatorAttestation(validatorId, subject)),
  }
}

function isHmacValidatorAttestation(value: unknown): boolean {
  if (!isRecord(value)) return true
  if (value.hmacForgeable === true) return true
  if (typeof value.mac === 'string' && value.eip712 !== true) return true
  if (value.eip712 !== true) return true
  if (typeof value.signature !== 'string') return true
  return false
}

export function isHmacValidatorQuorum(value: unknown): boolean {
  if (!isRecord(value) || value.schema !== LAB_VALIDATOR_QUORUM_SCHEMA) return false
  if (value.hmacForgeable === true) return true
  if (value.eip712 !== true) return true
  if (!Array.isArray(value.attestations)) return true
  for (const row of value.attestations) {
    if (isHmacValidatorAttestation(row)) return true
  }
  return false
}

export function recoverLabValidatorAttestSigner(
  attestation: DleLabValidatorAttestationV1,
  subject: ValidatorQuorumSubject,
): string {
  if (typeof attestation.signature !== 'string') throw new Error(ERR_VALIDATOR_QUORUM_SIG)
  return recoverArchiveValidatorQuorumAttest(archiveValidatorQuorumAttestTyped(subject), attestation.signature)
}

export function verifyEip712LabValidatorAttestation(
  attestation: DleLabValidatorAttestationV1,
  subject: ValidatorQuorumSubject,
): boolean {
  if (attestation.eip712 !== true || attestation.hmacForgeable === true) return false
  if (typeof attestation.signature !== 'string' || typeof attestation.signer !== 'string') return false
  try {
    const recovered = getAddress(recoverLabValidatorAttestSigner(attestation, subject))
    const expected = getAddress(labSeatingAddress(attestation.validatorId))
    return recovered === expected && getAddress(attestation.signer) === expected
  } catch {
    return false
  }
}

function committeeMatchesRequest(
  quorum: DleLabValidatorQuorumV1,
  subject: ValidatorQuorumSubject,
): { ok: true; expected: Hex[] } | { ok: false; reason: string } {
  if (quorum.schema !== LAB_VALIDATOR_QUORUM_SCHEMA) {
    return { ok: false, reason: 'validator quorum schema must be DleLabValidatorQuorumV1' }
  }
  if (quorum.labOnly !== true || quorum.notProductionSecp256k1 !== true) {
    return { ok: false, reason: 'validator quorum must be labeled a lab stub' }
  }
  if (quorum.quorum !== LAB_VALIDATOR_QUORUM || quorum.committeeSize !== LAB_VALIDATOR_COUNT) {
    return { ok: false, reason: 'validator quorum must be 5-of-7' }
  }
  const expected = labValidatorCommittee(subject.requestId)
  if (quorum.committee.length !== LAB_VALIDATOR_COUNT) {
    return { ok: false, reason: 'validator committee must have 7 ids' }
  }
  for (let i = 0; i < expected.length; i += 1) {
    if (quorum.committee[i]?.toLowerCase() !== expected[i]) {
      return { ok: false, reason: 'validator committee is not derived from requestId' }
    }
  }
  return { ok: true, expected }
}

function verifyHmacLabValidatorQuorum(
  quorum: DleLabValidatorQuorumV1,
  subject: ValidatorQuorumSubject,
): { ok: true } | { ok: false; reason: string } {
  const bound = committeeMatchesRequest(quorum, subject)
  if (!bound.ok) return bound
  const seen = new Set<string>()
  let valid = 0
  for (const attestation of quorum.attestations) {
    const id = attestation.validatorId.toLowerCase()
    if (seen.has(id)) continue
    if (!bound.expected.includes(id as Hex)) continue
    if (!verifyHmacLabValidatorAttestation(attestation, subject)) continue
    seen.add(id)
    valid += 1
  }
  if (valid < LAB_VALIDATOR_QUORUM) {
    return { ok: false, reason: `validator quorum needs ${LAB_VALIDATOR_QUORUM} valid HMACs, got ${valid}` }
  }
  return { ok: true }
}

/** New accept / live verify. HMAC is rejected. */
export function verifyLabValidatorQuorum(
  quorum: DleLabValidatorQuorumV1,
  subject: ValidatorQuorumSubject,
): { ok: true } | { ok: false; reason: string } {
  if (quorum.schema !== LAB_VALIDATOR_QUORUM_SCHEMA) {
    return { ok: false, reason: 'validator quorum schema must be DleLabValidatorQuorumV1' }
  }
  if (isHmacValidatorQuorum(quorum) || quorum.eip712 !== true || quorum.hmacForgeable !== false) {
    return { ok: false, reason: ERR_VALIDATOR_QUORUM_HMAC_CUTOVER }
  }
  const bound = committeeMatchesRequest(quorum, subject)
  if (!bound.ok) return bound
  const seen = new Set<string>()
  let valid = 0
  for (const attestation of quorum.attestations) {
    const id = attestation.validatorId.toLowerCase()
    if (seen.has(id)) continue
    if (!bound.expected.includes(id as Hex)) continue
    if (isHmacValidatorAttestation(attestation)) {
      return { ok: false, reason: ERR_VALIDATOR_QUORUM_HMAC_CUTOVER }
    }
    if (!verifyEip712LabValidatorAttestation(attestation, subject)) {
      return { ok: false, reason: ERR_VALIDATOR_QUORUM_SIG }
    }
    seen.add(id)
    valid += 1
  }
  if (valid < LAB_VALIDATOR_QUORUM) {
    return { ok: false, reason: `validator quorum needs ${LAB_VALIDATOR_QUORUM} valid EIP-712 attests, got ${valid}` }
  }
  return { ok: true }
}

/** Disk keep-only: restore HMAC or EIP-712 quorums. Do not use for accept. */
export function verifyLabValidatorQuorumForRestore(
  quorum: DleLabValidatorQuorumV1,
  subject: ValidatorQuorumSubject,
): { ok: true } | { ok: false; reason: string } {
  const eip712 = verifyLabValidatorQuorum(quorum, subject)
  if (eip712.ok) return eip712
  return verifyHmacLabValidatorQuorum(quorum, subject)
}

export function parseLabValidatorQuorum(value: unknown): DleLabValidatorQuorumV1 | null {
  if (!isRecord(value) || value.schema !== LAB_VALIDATOR_QUORUM_SCHEMA) return null
  if (value.labOnly !== true || value.notProductionSecp256k1 !== true) return null
  if (value.quorum !== LAB_VALIDATOR_QUORUM || value.committeeSize !== LAB_VALIDATOR_COUNT) return null
  if (!Array.isArray(value.committee) || !value.committee.every(isHex32)) return null
  if (!Array.isArray(value.attestations)) return null
  const attestations: DleLabValidatorAttestationV1[] = []
  for (const row of value.attestations) {
    if (!isRecord(row) || !isHex32(row.validatorId)) return null
    const hasMac = typeof row.mac === 'string'
    const hasSig = typeof row.signature === 'string' && typeof row.signer === 'string'
    if (!hasMac && !hasSig) return null
    if (hasMac && !isHex32(row.mac)) return null
    const attestation: DleLabValidatorAttestationV1 = {
      validatorId: row.validatorId.toLowerCase() as Hex,
    }
    if (hasMac) attestation.mac = (row.mac as string).toLowerCase() as Hex
    if (hasSig) {
      attestation.signature = row.signature as Hex
      attestation.signer = row.signer as string
    }
    if (typeof row.eip712 === 'boolean') attestation.eip712 = row.eip712
    if (typeof row.hmacForgeable === 'boolean') attestation.hmacForgeable = row.hmacForgeable
    attestations.push(attestation)
  }
  const quorum: DleLabValidatorQuorumV1 = {
    schema: LAB_VALIDATOR_QUORUM_SCHEMA,
    labOnly: true,
    hmacForgeable: value.hmacForgeable === true,
    notProductionSecp256k1: true,
    quorum: LAB_VALIDATOR_QUORUM,
    committeeSize: LAB_VALIDATOR_COUNT,
    committee: value.committee.map((id) => id.toLowerCase() as Hex),
    attestations,
  }
  if (typeof value.eip712 === 'boolean') quorum.eip712 = value.eip712
  if (typeof value.validatorQuorumEip712 === 'boolean') quorum.validatorQuorumEip712 = value.validatorQuorumEip712
  if (typeof value.labDeterministicSeatingKey === 'boolean') {
    quorum.labDeterministicSeatingKey = value.labDeterministicSeatingKey
  }
  if (typeof value.notProductionOperatorKey === 'boolean') {
    quorum.notProductionOperatorKey = value.notProductionOperatorKey
  }
  if (typeof value.notL1Settled === 'boolean') quorum.notL1Settled = value.notL1Settled
  return quorum
}
