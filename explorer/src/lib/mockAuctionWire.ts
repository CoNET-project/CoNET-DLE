/**
 * Explorer-local mirror of DLE mock-L1 order / candidate hashing.
 * Must stay bitwise-aligned with runtime/src/shared/tradeMatch.ts + mockL1.ts.
 * Do not import from runtime (src-subprojects-are-independent).
 */
import { concat, getBytes, hexlify, keccak256, toUtf8Bytes, zeroPadValue } from 'ethers'

export const ORDER_SIDE_SELL = 'sell' as const
export const ORDER_SIDE_BUY = 'buy' as const
export type OrderSide = typeof ORDER_SIDE_SELL | typeof ORDER_SIDE_BUY

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

function keccakBytes(...parts: Uint8Array[]): `0x${string}` {
  return keccak256(concat(parts.map((p) => hexlify(p)))) as `0x${string}`
}

/** Canonical 1 bps fee policy commitment (scanner 50% / committee 50%). */
export function mockL1FeePolicyHashLocal(): `0x${string}` {
  return keccak256(toUtf8Bytes('dle.mockL1.fee.v1|1bps|scanner50|committee50')) as `0x${string}`
}

export function tradeOrderHashLocal(fields: {
  side: OrderSide
  chainNftId: string
  maker: string
  subjectNftContract: string
  subjectNftId: string
  quoteAsset: string
  price: string
  amount: string
  nonce: string
  deadline: string
  feePolicyHash: string
}): `0x${string}` {
  return keccakBytes(
    utf8('dle.mockL1.order.v1'),
    utf8(fields.side),
    utf8(fields.chainNftId),
    addressBytes(fields.maker),
    addressBytes(fields.subjectNftContract),
    uintBE(BigInt(fields.subjectNftId), 32),
    addressBytes(fields.quoteAsset),
    uintBE(BigInt(fields.price), 32),
    uintBE(BigInt(fields.amount), 32),
    uintBE(BigInt(fields.nonce), 32),
    uintBE(BigInt(fields.deadline), 8),
    fromHex32(fields.feePolicyHash),
  )
}

export function matchCandidateHashLocal(fields: {
  scanner: string
  sellOrderHash: string
  buyOrderHash: string
  clearingPrice: string
}): `0x${string}` {
  return keccakBytes(
    utf8('dle.mockL1.candidate.v1'),
    addressBytes(fields.scanner),
    fromHex32(fields.sellOrderHash),
    fromHex32(fields.buyOrderHash),
    uintBE(BigInt(fields.clearingPrice), 32),
  )
}

export function buildUnsignedTradeOrder(input: {
  side: OrderSide
  chainNftId: string
  maker: string
  subjectNftContract: string
  subjectNftId: string
  quoteAsset: string
  price: string
  amount: string
  nonce: string
  deadline: string
  feePolicyHash?: string
}) {
  const feePolicyHash = (input.feePolicyHash ?? mockL1FeePolicyHashLocal()).toLowerCase()
  const maker = input.maker.toLowerCase()
  const subjectNftContract = input.subjectNftContract.toLowerCase()
  const quoteAsset = input.quoteAsset.toLowerCase()
  const orderHash = tradeOrderHashLocal({
    side: input.side,
    chainNftId: input.chainNftId,
    maker,
    subjectNftContract,
    subjectNftId: input.subjectNftId,
    quoteAsset,
    price: input.price,
    amount: input.amount,
    nonce: input.nonce,
    deadline: input.deadline,
    feePolicyHash,
  })
  return {
    schema: 'MockL1TradeOrderV1' as const,
    mockL1Only: true as const,
    side: input.side,
    chainNftId: input.chainNftId,
    maker,
    subjectNftContract,
    subjectNftId: input.subjectNftId,
    quoteAsset,
    price: input.price,
    amount: input.amount,
    nonce: input.nonce,
    deadline: input.deadline,
    feePolicyHash,
    orderHash,
    createdAt: new Date().toISOString(),
  }
}

export function orderPersonalSignMessage(orderHash: string): string {
  return `DLE mock-L1 trade order\n${orderHash}`
}

export function certPersonalSignMessage(certificateHash: string): string {
  return `DLE mock-L1 trade match certificate\n${certificateHash}`
}
