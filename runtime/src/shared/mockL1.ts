/**
 * Mock-L1 chain registration adapter (parallel to lab `notL1Nft` newchain).
 * Verifies a real local ERC-1155 `tokenId` binding — never upgrades lab requests.
 */

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

export const MOCK_L1_ONLY = true as const
export const MOCK_L1_REGISTRATION_SCHEMA = 'MockL1ChainRegistrationV1' as const
export const MOCK_L1_NOTE =
  'Mock-L1 only. Local Hardhat/Anvil ERC-1155 chain NFT. Not CoNET mainnet, not lab notL1Nft, not production DePIN.'

export const CHAIN_CLASS_ASSET = 1
export const CHAIN_CLASS_STORAGE = 2
export const CHAIN_CLASS_TRADE = 3

export const FEE_BPS = 1n
export const FEE_SCANNER_SHARE_BPS = 5_000n
export const FEE_COMMITTEE_SHARE_BPS = 5_000n

export type MockL1ChainClassId =
  | typeof CHAIN_CLASS_ASSET
  | typeof CHAIN_CLASS_STORAGE
  | typeof CHAIN_CLASS_TRADE

export type MockL1ChainClassName = 'asset' | 'storage' | 'trade'

export interface MockL1BoundView {
  live: boolean
  mockL1Only: true
  chainId: number
  registry: Hex
  tokenId: string
  chainClass: MockL1ChainClassId
  chainOwner: Hex
  archiveGroupId: string
  assignmentStatus: number
  genesisAcHash: Hex
}

export interface MockL1ChainRegistrationV1 {
  schema: typeof MOCK_L1_REGISTRATION_SCHEMA
  mockL1Only: true
  notProductionDepin: true
  /** Explicitly not the lab hashed chainNftId path. */
  notLabNotL1Nft: true
  classId: MockL1ChainClassId
  user: Hex
  tokenId: string
  registry: Hex
  chainId: number
  bound: MockL1BoundView
  requestCommitment: Hex
  createdAt?: string
}

export interface MockL1GenesisCertificateV1 {
  schema: 'MockL1GenesisCertificateV1'
  mockL1Only: true
  notProductionDepin: true
  notLabNotL1Nft: true
  note: typeof MOCK_L1_NOTE
  requestCommitment: Hex
  chainNftId: string
  classId: MockL1ChainClassId
  className: MockL1ChainClassName
  user: Hex
  registry: Hex
  chainId: number
  valueHash: Hex
  tipStateRoot: Hex
  bodyCommitment: Hex
  height: '0x1'
  acceptedAt: string
}

export interface MockL1ChainRecordV1 {
  requestCommitment: Hex
  chainNftId: string
  classId: MockL1ChainClassId
  className: MockL1ChainClassName
  user: Hex
  registry: Hex
  chainId: number
  valueHash: Hex
  tipStateRoot: Hex
  bodyCommitment: Hex
  acceptedAt: string
  certificate: MockL1GenesisCertificateV1
  bound: MockL1BoundView
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

export function mockL1ClassNameOf(classId: number): MockL1ChainClassName | null {
  if (classId === CHAIN_CLASS_ASSET) return 'asset'
  if (classId === CHAIN_CLASS_STORAGE) return 'storage'
  if (classId === CHAIN_CLASS_TRADE) return 'trade'
  return null
}

export function isMockL1ChainClassId(value: unknown): value is MockL1ChainClassId {
  return value === CHAIN_CLASS_ASSET || value === CHAIN_CLASS_STORAGE || value === CHAIN_CLASS_TRADE
}

/** Canonical 1 bps fee policy commitment (scanner 50% / committee 50%). */
export function mockL1FeePolicyHash(): Hex {
  return keccak256Utf8('dle.mockL1.fee.v1|1bps|scanner50|committee50')
}

export function computeFeeSplit(clearingAmount: bigint): {
  feeAmount: bigint
  scannerReward: bigint
  committeeReward: bigint
} {
  const feeAmount = clearingAmount / 10_000n
  const scannerReward = feeAmount / 2n
  const committeeReward = feeAmount - scannerReward
  return { feeAmount, scannerReward, committeeReward }
}

export function mockL1RequestCommitment(input: {
  classId: MockL1ChainClassId
  user: Hex
  tokenId: string
  registry: Hex
  chainId: number
}): Hex {
  return keccak256(
    concatBytes(
      utf8('dle.mockL1.request.v1'),
      uintBE(BigInt(input.classId), 1),
      addressBytes(input.user),
      uintBE(BigInt(input.tokenId), 32),
      addressBytes(input.registry),
      uintBE(BigInt(input.chainId), 8),
    ),
  )
}

export function parseMockL1BoundView(
  raw: unknown,
): { ok: true; view: MockL1BoundView } | { ok: false; reason: string } {
  if (!isRecord(raw)) return { ok: false, reason: 'bound view must be an object' }
  if (raw.live !== true || raw.mockL1Only !== true) {
    return { ok: false, reason: 'bound view must be live mockL1Only' }
  }
  if (typeof raw.chainId !== 'number' || !Number.isInteger(raw.chainId) || raw.chainId <= 0) {
    return { ok: false, reason: 'bound.chainId must be a positive integer' }
  }
  if (!isHexAddress(raw.registry)) return { ok: false, reason: 'bound.registry must be an address' }
  if (typeof raw.tokenId !== 'string' || !/^\d+$/.test(raw.tokenId)) {
    return { ok: false, reason: 'bound.tokenId must be a decimal string' }
  }
  if (!isMockL1ChainClassId(raw.chainClass)) {
    return { ok: false, reason: 'bound.chainClass must be 1, 2, or 3' }
  }
  if (!isHexAddress(raw.chainOwner)) return { ok: false, reason: 'bound.chainOwner must be an address' }
  if (typeof raw.archiveGroupId !== 'string' || raw.archiveGroupId.length === 0) {
    return { ok: false, reason: 'bound.archiveGroupId required' }
  }
  if (typeof raw.assignmentStatus !== 'number' || raw.assignmentStatus !== 2) {
    return { ok: false, reason: 'bound.assignmentStatus must be BOUND (2)' }
  }
  if (!isHex32(raw.genesisAcHash)) return { ok: false, reason: 'bound.genesisAcHash must be bytes32' }
  return {
    ok: true,
    view: {
      live: true,
      mockL1Only: true,
      chainId: raw.chainId,
      registry: raw.registry.toLowerCase() as Hex,
      tokenId: raw.tokenId,
      chainClass: raw.chainClass,
      chainOwner: raw.chainOwner.toLowerCase() as Hex,
      archiveGroupId: raw.archiveGroupId,
      assignmentStatus: 2,
      genesisAcHash: raw.genesisAcHash.toLowerCase() as Hex,
    },
  }
}

export function parseMockL1Registration(
  body: unknown,
): { ok: true; request: MockL1ChainRegistrationV1 } | { ok: false; reason: string } {
  if (!isRecord(body) || body.schema !== MOCK_L1_REGISTRATION_SCHEMA) {
    return { ok: false, reason: 'schema must be MockL1ChainRegistrationV1' }
  }
  if (body.mockL1Only !== true || body.notProductionDepin !== true || body.notLabNotL1Nft !== true) {
    return { ok: false, reason: 'must be labeled mockL1Only / notProductionDepin / notLabNotL1Nft' }
  }
  if (body.notL1Nft === true) {
    return { ok: false, reason: 'lab notL1Nft requests cannot be upgraded to MockL1 registration' }
  }
  if (!isMockL1ChainClassId(body.classId)) {
    return { ok: false, reason: 'classId must be 1 (asset), 2 (storage), or 3 (trade)' }
  }
  if (!isHexAddress(body.user)) return { ok: false, reason: 'user must be an address' }
  if (typeof body.tokenId !== 'string' || !/^\d+$/.test(body.tokenId)) {
    return { ok: false, reason: 'tokenId must be a decimal string' }
  }
  if (!isHexAddress(body.registry)) return { ok: false, reason: 'registry must be an address' }
  if (typeof body.chainId !== 'number' || !Number.isInteger(body.chainId) || body.chainId <= 0) {
    return { ok: false, reason: 'chainId must be a positive integer' }
  }
  const bound = parseMockL1BoundView(body.bound)
  if (!bound.ok) return bound
  if (bound.view.tokenId !== body.tokenId) {
    return { ok: false, reason: 'bound.tokenId must equal registration tokenId' }
  }
  if (bound.view.chainClass !== body.classId) {
    return { ok: false, reason: 'bound.chainClass must equal registration classId' }
  }
  if (bound.view.registry.toLowerCase() !== body.registry.toLowerCase()) {
    return { ok: false, reason: 'bound.registry must equal registration registry' }
  }
  if (bound.view.chainId !== body.chainId) {
    return { ok: false, reason: 'bound.chainId must equal registration chainId' }
  }
  if (bound.view.chainOwner.toLowerCase() !== body.user.toLowerCase()) {
    return { ok: false, reason: 'bound.chainOwner must equal registration user' }
  }
  const expected = mockL1RequestCommitment({
    classId: body.classId,
    user: body.user.toLowerCase() as Hex,
    tokenId: body.tokenId,
    registry: body.registry.toLowerCase() as Hex,
    chainId: body.chainId,
  })
  if (!isHex32(body.requestCommitment)) {
    return { ok: false, reason: 'requestCommitment must be bytes32' }
  }
  if (body.requestCommitment.toLowerCase() !== expected.toLowerCase()) {
    return { ok: false, reason: 'requestCommitment mismatch' }
  }
  return {
    ok: true,
    request: {
      schema: MOCK_L1_REGISTRATION_SCHEMA,
      mockL1Only: true,
      notProductionDepin: true,
      notLabNotL1Nft: true,
      classId: body.classId,
      user: body.user.toLowerCase() as Hex,
      tokenId: body.tokenId,
      registry: body.registry.toLowerCase() as Hex,
      chainId: body.chainId,
      bound: bound.view,
      requestCommitment: expected,
      ...(typeof body.createdAt === 'string' ? { createdAt: body.createdAt } : {}),
    },
  }
}

export function makeMockL1Registration(input: {
  classId: MockL1ChainClassId
  user: Hex
  tokenId: string
  registry: Hex
  chainId: number
  archiveGroupId: string
  genesisAcHash: Hex
}): MockL1ChainRegistrationV1 {
  const user = input.user.toLowerCase() as Hex
  const registry = input.registry.toLowerCase() as Hex
  const bound: MockL1BoundView = {
    live: true,
    mockL1Only: true,
    chainId: input.chainId,
    registry,
    tokenId: input.tokenId,
    chainClass: input.classId,
    chainOwner: user,
    archiveGroupId: input.archiveGroupId,
    assignmentStatus: 2,
    genesisAcHash: input.genesisAcHash.toLowerCase() as Hex,
  }
  return {
    schema: MOCK_L1_REGISTRATION_SCHEMA,
    mockL1Only: true,
    notProductionDepin: true,
    notLabNotL1Nft: true,
    classId: input.classId,
    user,
    tokenId: input.tokenId,
    registry,
    chainId: input.chainId,
    bound,
    requestCommitment: mockL1RequestCommitment({
      classId: input.classId,
      user,
      tokenId: input.tokenId,
      registry,
      chainId: input.chainId,
    }),
    createdAt: new Date().toISOString(),
  }
}

export function mockL1GenesisHashes(input: {
  tokenId: string
  classId: MockL1ChainClassId
  user: Hex
  requestCommitment: Hex
}): { tipStateRoot: Hex; valueHash: Hex; bodyCommitment: Hex } {
  const body = concatBytes(
    utf8('dle.mockL1.genesis.v1'),
    fromHex(input.requestCommitment, 32),
    uintBE(BigInt(input.tokenId), 32),
    uintBE(BigInt(input.classId), 1),
    addressBytes(input.user),
  )
  const tipStateRoot = keccak256(concatBytes(utf8('dle.mockL1.tip.v1'), body))
  const bodyCommitment = keccak256(body)
  const valueHash = keccak256(
    concatBytes(utf8('dle.mockL1.value.v1'), fromHex(tipStateRoot, 32), fromHex(bodyCommitment, 32)),
  )
  return { tipStateRoot, valueHash, bodyCommitment }
}
