/**
 * Explorer-local mirror of DLE lab new-chain request hashing / shapes.
 * Must stay aligned with runtime/src/shared/newchain.ts.
 * Do not import from runtime (src-subprojects-are-independent).
 */
import { concat, getBytes, hexlify, keccak256, toUtf8Bytes, zeroPadValue } from 'ethers'

export const LAB_CLASS_ASSET = 1 as const
export const LAB_CLASS_STORAGE = 2 as const
export const LAB_CLASS_TRADE = 3 as const

export type LabChainClassId = typeof LAB_CLASS_ASSET | typeof LAB_CLASS_STORAGE | typeof LAB_CLASS_TRADE
export type LabChainClassName = 'asset' | 'storage' | 'trade'

export const LAB_NEWCHAIN_REQUEST_SCHEMA = 'DleLabNewChainRequestV1' as const

export const LAB_NEWCHAIN_NOTE =
  'Lab Mode A genesis replay. Not an L1 birth certificate, Treasury burn, Settlement escrow, or 30-day qualification.'

export type Hex = `0x${string}`

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

function utf8(value: string): Uint8Array {
  return getBytes(hexlify(toUtf8Bytes(value)))
}

function addressBytes(value: string): Uint8Array {
  const hex = value.startsWith('0x') ? value.slice(2) : value
  if (hex.length !== 40) throw new Error('address must be 20 bytes')
  return getBytes(`0x${hex.toLowerCase()}`)
}

function fromHex32(value: string): Uint8Array {
  return getBytes(zeroPadValue(value, 32))
}

function uintBE(value: bigint, bytes: number): Uint8Array {
  const hex = value.toString(16).padStart(bytes * 2, '0')
  if (hex.length > bytes * 2) throw new Error('uintBE overflow')
  return getBytes(`0x${hex}`)
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

export function makeNewChainRequest(input: {
  classId: LabChainClassId
  nonce: string | number | bigint
  salt: Hex
  user: Hex
  createdAt?: string
}): DleLabNewChainRequestV1 {
  const request: DleLabNewChainRequestV1 = {
    schema: LAB_NEWCHAIN_REQUEST_SCHEMA,
    labOnly: true,
    notProductionDepin: true,
    notL1Nft: true,
    classId: input.classId,
    user: input.user.toLowerCase() as Hex,
    nonce: BigInt(input.nonce).toString(10),
    salt: input.salt.toLowerCase() as Hex,
  }
  if (input.createdAt !== undefined && input.createdAt !== '') {
    request.createdAt = input.createdAt
  }
  return request
}

export function encodeNewChainRequest(request: DleLabNewChainRequestV1): Uint8Array {
  // ethers.concat returns hex string; keep Uint8Array to mirror runtime/shared/newchain.
  return getBytes(
    concat([
      utf8('dle.lab.newchain.request.v1'),
      uintBE(BigInt(request.classId), 1),
      addressBytes(request.user),
      uintBE(BigInt(request.nonce), 8),
      fromHex32(request.salt),
    ]),
  )
}

export function newChainRequestId(request: DleLabNewChainRequestV1): Hex {
  return keccak256(encodeNewChainRequest(request)) as Hex
}

/** Lab hashed chainNftId — never NFT 42 tip. Not an L1 birth certificate. */
export function labChainNftIdFromRequestId(requestId: Hex): string {
  const digest = keccak256(toUtf8Bytes(`dle.lab.chainNft.v1|${requestId.toLowerCase()}`))
  let id = 1000n + (BigInt(digest) % 998_999_000n)
  if (id.toString(10) === '42') id += 1n
  return id.toString(10)
}

export function randomSaltHex(): Hex {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return hexlify(bytes) as Hex
}

/** Optional ownership proof message — Archive does not require it; used for wallet-sign smoke. */
export function labNewchainOwnershipMessage(request: DleLabNewChainRequestV1): string {
  return [
    'DLE lab new-chain request (not L1 NFT)',
    `schema=${request.schema}`,
    `classId=${request.classId}`,
    `user=${request.user.toLowerCase()}`,
    `nonce=${request.nonce}`,
    `salt=${request.salt.toLowerCase()}`,
  ].join('\n')
}

/** Row from trusted `GET /newchain/chains` (Mode A lab owner = `user`). */
export type LabNewChainListItem = {
  requestId: Hex
  chainNftId: string
  classId: LabChainClassId
  className: LabChainClassName
  user: Hex
  acceptedAt: string
  archiveCertificatePending?: boolean
  hasArchiveCertificate: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isHexAddress(value: unknown): value is Hex {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
}

function isHex32(value: unknown): value is Hex {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)
}

/** Parse trusted list body; invalid rows skipped. Failure → empty (caller keeps last trusted UI). */
export function parseLabNewChainList(body: unknown): LabNewChainListItem[] {
  if (!isRecord(body) || !Array.isArray(body.chains)) return []
  const out: LabNewChainListItem[] = []
  for (const row of body.chains) {
    if (!isRecord(row)) continue
    if (!isHex32(row.requestId) || !isHexAddress(row.user)) continue
    if (!isLabChainClassId(row.classId)) continue
    const className = classNameOf(row.classId)
    if (className === null) continue
    if (typeof row.chainNftId !== 'string' || !/^\d+$/.test(row.chainNftId)) continue
    if (typeof row.acceptedAt !== 'string' || row.acceptedAt === '') continue
    out.push({
      requestId: row.requestId.toLowerCase() as Hex,
      chainNftId: row.chainNftId,
      classId: row.classId,
      className,
      user: row.user.toLowerCase() as Hex,
      acceptedAt: row.acceptedAt,
      archiveCertificatePending: row.archiveCertificatePending === true,
      hasArchiveCertificate: row.archiveCertificate !== undefined && row.archiveCertificate !== null,
    })
  }
  return out.sort((a, b) => b.acceptedAt.localeCompare(a.acceptedAt))
}

/** Lab Mode A owner = record `user` (requesting wallet). Not L1 `ownerOf`. */
export function chainsOwnedBy(chains: LabNewChainListItem[], owner: string | null | undefined): LabNewChainListItem[] {
  if (!owner || !isHexAddress(owner)) return []
  const key = owner.toLowerCase()
  return chains.filter((c) => c.user === key)
}
