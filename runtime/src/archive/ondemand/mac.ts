import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { getAddress } from 'ethers'
import {
  labSeatingAddress,
  recoverArchiveOnDemandAttest,
  signArchiveOnDemandAttest,
  type ArchiveOnDemandAttestTyped,
} from '../syncQualification/eip712.js'
import { concatBytes, fromHex, toHex, uintBE, utf8, type Hex } from '../../shared/bytes.js'

export const ERR_ONDEMAND_HMAC_CUTOVER = 'ERR_ONDEMAND_HMAC_CUTOVER'
export const ERR_ONDEMAND_ATTEST_SIG = 'ERR_ONDEMAND_ATTEST_SIG'

export interface PoolAttestUnsigned {
  domainId: string
  poolRoot: Hex
  epoch: number
  shardId: string
  roulette: Hex
}

export interface PoolAttest extends PoolAttestUnsigned {
  schema: 'DleLabPoolAttestV1'
  mac?: Hex
  signature?: Hex
  signer?: string
  eip712?: boolean
  hmacForgeable?: boolean
  ondemandEip712?: boolean
  labDeterministicSeatingKey?: boolean
  notProductionOperatorKey?: boolean
  notL1Settled?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function macKey(domainId: string): Buffer {
  return createHash('sha256').update(`dle.ondemand.lab.mac.v1|${domainId}`, 'utf8').digest()
}

export function attestCanonicalBytes(attest: PoolAttestUnsigned): Uint8Array {
  return concatBytes(
    utf8('dle.ondemand.lab.attest.v1'),
    fromHex(attest.poolRoot, 32),
    uintBE(attest.epoch, 8),
    utf8(attest.shardId),
    fromHex(attest.roulette, 32),
    utf8(attest.domainId),
  )
}

/** Legacy HMAC. Tests use this to prove P17 cutover. New attests must not use it. */
export function signHmacLabPoolAttest(attest: PoolAttestUnsigned): Hex {
  return toHex(createHmac('sha256', macKey(attest.domainId)).update(attestCanonicalBytes(attest)).digest())
}

export function makeHmacLabPoolAttest(attest: PoolAttestUnsigned): PoolAttest {
  return {
    schema: 'DleLabPoolAttestV1',
    ...attest,
    hmacForgeable: true,
    eip712: false,
    mac: signHmacLabPoolAttest(attest),
  }
}

export function isHmacOnDemandAttest(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (value.schema !== 'DleLabPoolAttestV1') return false
  if (value.hmacForgeable === true) return true
  if (typeof value.mac === 'string' && value.eip712 !== true) return true
  if (value.eip712 !== true) return true
  if (typeof value.signature !== 'string') return true
  return false
}

export function archiveOnDemandAttestTyped(attest: PoolAttestUnsigned): ArchiveOnDemandAttestTyped {
  return {
    poolRoot: attest.poolRoot,
    epoch: attest.epoch,
    shardId: attest.shardId,
    roulette: attest.roulette,
  }
}

export function signLabPoolAttest(attest: PoolAttestUnsigned): Hex {
  return signArchiveOnDemandAttest(attest.domainId, archiveOnDemandAttestTyped(attest))
}

export function makeLabPoolAttest(attest: PoolAttestUnsigned): PoolAttest {
  const signer = labSeatingAddress(attest.domainId)
  return {
    schema: 'DleLabPoolAttestV1',
    ...attest,
    eip712: true,
    hmacForgeable: false,
    ondemandEip712: true,
    labDeterministicSeatingKey: true,
    notProductionOperatorKey: true,
    notL1Settled: true,
    signer,
    signature: signLabPoolAttest(attest),
  }
}

export function recoverLabPoolAttestSigner(attest: PoolAttest): string {
  if (typeof attest.signature !== 'string') throw new Error(ERR_ONDEMAND_ATTEST_SIG)
  return recoverArchiveOnDemandAttest(archiveOnDemandAttestTyped(attest), attest.signature)
}

export function verifyEip712LabPoolAttest(attest: PoolAttest): boolean {
  if (attest.schema !== 'DleLabPoolAttestV1') return false
  if (attest.eip712 !== true || attest.hmacForgeable !== false) return false
  if (typeof attest.signature !== 'string' || typeof attest.signer !== 'string') return false
  try {
    const recovered = getAddress(recoverLabPoolAttestSigner(attest))
    const expected = getAddress(labSeatingAddress(attest.domainId))
    return recovered === expected && getAddress(attest.signer) === expected
  } catch {
    return false
  }
}

export function verifyHmacLabPoolAttest(attest: PoolAttest): boolean {
  if (typeof attest.mac !== 'string') return false
  const expected = fromHex(signHmacLabPoolAttest(attest), 32)
  let actual: Uint8Array
  try {
    actual = fromHex(attest.mac, 32)
  } catch {
    return false
  }
  if (actual.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
}

/** New ingest / matching of live attests. HMAC is rejected. */
export function verifyLabPoolAttest(attest: PoolAttest): boolean {
  return verifyEip712LabPoolAttest(attest)
}

/** Disk keep-only: restore HMAC or EIP-712 attests. Do not use for ingest. */
export function verifyLabPoolAttestForRestore(attest: PoolAttest): boolean {
  return verifyEip712LabPoolAttest(attest) || verifyHmacLabPoolAttest(attest)
}

export function parseAttest(value: unknown): PoolAttest | null {
  if (!isRecord(value) || value.schema !== 'DleLabPoolAttestV1') return null
  if (typeof value.domainId !== 'string') return null
  if (typeof value.epoch !== 'number' || typeof value.shardId !== 'string') return null
  if (typeof value.poolRoot !== 'string' || typeof value.roulette !== 'string') return null
  const hasMac = typeof value.mac === 'string'
  const hasSig = typeof value.signature === 'string' && typeof value.signer === 'string'
  if (!hasMac && !hasSig) return null
  const attest: PoolAttest = {
    schema: 'DleLabPoolAttestV1',
    domainId: value.domainId,
    poolRoot: value.poolRoot as Hex,
    epoch: value.epoch,
    shardId: value.shardId,
    roulette: value.roulette as Hex,
  }
  if (typeof value.eip712 === 'boolean') attest.eip712 = value.eip712
  if (typeof value.hmacForgeable === 'boolean') attest.hmacForgeable = value.hmacForgeable
  if (typeof value.ondemandEip712 === 'boolean') attest.ondemandEip712 = value.ondemandEip712
  if (typeof value.labDeterministicSeatingKey === 'boolean') {
    attest.labDeterministicSeatingKey = value.labDeterministicSeatingKey
  }
  if (typeof value.notProductionOperatorKey === 'boolean') {
    attest.notProductionOperatorKey = value.notProductionOperatorKey
  }
  if (typeof value.notL1Settled === 'boolean') attest.notL1Settled = value.notL1Settled
  if (hasMac) attest.mac = value.mac as Hex
  if (hasSig) {
    attest.signature = value.signature as Hex
    attest.signer = value.signer
  }
  return attest
}
