/** Laboratory new-chain request plane. Not L1 NFT mint. Not production DePIN. */

import {
  addressBytes,
  concatBytes,
  fromHex,
  keccak256,
  keccak256Utf8,
  uintBE,
  utf8,
  type Hex,
} from './bytes.js'
import { DLE_LAB_CHAIN_NFT_ID, HASH32_RE, normalizeChainNftId } from './hashLookup.js'

export const LAB_CLASS_ASSET = 1
export const LAB_CLASS_STORAGE = 2
export const LAB_CLASS_TRADE = 3

export const LAB_NEWCHAIN_REQUEST_SCHEMA = 'DleLabNewChainRequestV1' as const
export const LAB_NEWCHAIN_USER = '0xd1e0000000000000000000000000000000000001' as Hex
export const LAB_NEWCHAIN_NOTE =
  'Lab Mode A genesis replay. Not an L1 birth certificate, Treasury burn, Settlement escrow, or 30-day qualification.'

export type LabChainClassId = typeof LAB_CLASS_ASSET | typeof LAB_CLASS_STORAGE | typeof LAB_CLASS_TRADE
export type LabChainClassName = 'asset' | 'storage' | 'trade'

export interface DleLabNewChainRequestV1 {
  schema: typeof LAB_NEWCHAIN_REQUEST_SCHEMA
  labOnly: true
  notProductionDepin: true
  notL1Nft: true
  classId: LabChainClassId
  user: Hex
  nonce: string
  salt: Hex
  createdAt?: string
}

export interface DleLabGenesisCertificateV1 {
  schema: 'DleLabGenesisCertificateV1'
  labOnly: true
  notProductionDepin: true
  notL1Nft: true
  notArchiveCertificate: true
  note: typeof LAB_NEWCHAIN_NOTE
  requestId: Hex
  chainNftId: string
  classId: LabChainClassId
  className: LabChainClassName
  user: Hex
  valueHash: Hex
  tipStateRoot: Hex
  bodyCommitment: Hex
  height: '0x1'
  domainId: string
  acceptedAt: string
}

export interface DleLabNewChainRecordV1 {
  requestId: Hex
  chainNftId: string
  classId: LabChainClassId
  className: LabChainClassName
  user: Hex
  valueHash: Hex
  tipStateRoot: Hex
  bodyCommitment: Hex
  acceptedAt: string
  certificate: DleLabGenesisCertificateV1
  validatorQuorum?: unknown
  archiveCertificatePending?: boolean
  archiveCertificate?: unknown
  prevoteQc?: unknown
  genesisVotes?: unknown[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isHexAddress(value: unknown): value is Hex {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
}

function isHex32(value: unknown): value is Hex {
  return typeof value === 'string' && HASH32_RE.test(value)
}

export function classNameOf(classId: number): LabChainClassName | null {
  if (classId === LAB_CLASS_ASSET) return 'asset'
  if (classId === LAB_CLASS_STORAGE) return 'storage'
  if (classId === LAB_CLASS_TRADE) return 'trade'
  return null
}

export function isLabChainClassId(value: unknown): value is LabChainClassId {
  return value === LAB_CLASS_ASSET || value === LAB_CLASS_STORAGE || value === LAB_CLASS_TRADE
}

export function parseNewChainRequest(
  body: unknown,
): { ok: true; request: DleLabNewChainRequestV1 } | { ok: false; reason: string } {
  if (!isRecord(body) || body.schema !== LAB_NEWCHAIN_REQUEST_SCHEMA) {
    return { ok: false, reason: 'request schema must be DleLabNewChainRequestV1' }
  }
  if (body.labOnly !== true || body.notProductionDepin !== true || body.notL1Nft !== true) {
    return { ok: false, reason: 'request must be labeled lab-only and not an L1 NFT' }
  }
  if (!isLabChainClassId(body.classId)) {
    return { ok: false, reason: 'classId must be 1 (asset), 2 (storage), or 3 (trade)' }
  }
  if (!isHexAddress(body.user)) {
    return { ok: false, reason: 'user must be a 20-byte hex address' }
  }
  if (typeof body.nonce !== 'string' || !/^\d+$/.test(body.nonce)) {
    return { ok: false, reason: 'nonce must be a decimal string' }
  }
  if (!isHex32(body.salt)) {
    return { ok: false, reason: 'salt must be a 32-byte hash' }
  }
  try {
    if (BigInt(body.nonce) < 0n) return { ok: false, reason: 'nonce must be non-negative' }
  } catch {
    return { ok: false, reason: 'nonce must be a decimal string' }
  }
  const request: DleLabNewChainRequestV1 = {
    schema: LAB_NEWCHAIN_REQUEST_SCHEMA,
    labOnly: true,
    notProductionDepin: true,
    notL1Nft: true,
    classId: body.classId,
    user: body.user.toLowerCase() as Hex,
    nonce: BigInt(body.nonce).toString(10),
    salt: body.salt.toLowerCase() as Hex,
  }
  if (typeof body.createdAt === 'string' && body.createdAt !== '') {
    request.createdAt = body.createdAt
  }
  return { ok: true, request }
}

export function encodeNewChainRequest(request: DleLabNewChainRequestV1): Uint8Array {
  return concatBytes(
    utf8('dle.lab.newchain.request.v1'),
    uintBE(request.classId, 1),
    addressBytes(request.user),
    uintBE(BigInt(request.nonce), 8),
    fromHex(request.salt, 32),
  )
}

export function newChainRequestId(request: DleLabNewChainRequestV1): Hex {
  return keccak256(encodeNewChainRequest(request))
}

export function labChainNftIdFromRequestId(requestId: Hex): string {
  const digest = keccak256Utf8(`dle.lab.chainNft.v1|${requestId.toLowerCase()}`)
  let id = 1000n + (BigInt(digest) % 998_999_000n)
  if (id.toString(10) === DLE_LAB_CHAIN_NFT_ID) id += 1n
  const nft = normalizeChainNftId(id.toString(10))
  if (nft === null) throw new Error('lab chainNftId derivation failed')
  return nft
}

export function addressFromHash(hash: Hex): Hex {
  return `0x${hash.slice(-40)}` as Hex
}

export function makeNewChainRequest(input: {
  classId: LabChainClassId
  nonce: string | number | bigint
  salt: Hex
  user?: Hex
  createdAt?: string
}): DleLabNewChainRequestV1 {
  const request: DleLabNewChainRequestV1 = {
    schema: LAB_NEWCHAIN_REQUEST_SCHEMA,
    labOnly: true,
    notProductionDepin: true,
    notL1Nft: true,
    classId: input.classId,
    user: (input.user ?? LAB_NEWCHAIN_USER).toLowerCase() as Hex,
    nonce: BigInt(input.nonce).toString(10),
    salt: input.salt.toLowerCase() as Hex,
  }
  if (input.createdAt !== undefined && input.createdAt !== '') {
    request.createdAt = input.createdAt
  }
  return request
}
