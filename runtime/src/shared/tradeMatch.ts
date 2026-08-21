/**
 * Mock-L1 trade order pool / match candidate / certificate wire types.
 * WaitingPool / on-demand hook must NOT be used as this ingress.
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
import { mockL1FeePolicyHash, computeFeeSplit } from './mockL1.js'

export const TRADE_ORDER_SCHEMA = 'MockL1TradeOrderV1' as const
export const MATCH_CANDIDATE_SCHEMA = 'MockL1MatchCandidateV1' as const
export const TRADE_MATCH_CERT_SCHEMA = 'TradeMatchCertificateV1' as const

export const ORDER_SIDE_SELL = 'sell' as const
export const ORDER_SIDE_BUY = 'buy' as const

export type OrderSide = typeof ORDER_SIDE_SELL | typeof ORDER_SIDE_BUY

export interface MockL1TradeOrderV1 {
  schema: typeof TRADE_ORDER_SCHEMA
  mockL1Only: true
  side: OrderSide
  chainNftId: string
  maker: Hex
  subjectNftContract: Hex
  subjectNftId: string
  quoteAsset: Hex
  /** Sell = ask; Buy = bid. Decimal string (wei). */
  price: string
  amount: string
  nonce: string
  deadline: string
  feePolicyHash: Hex
  signature: Hex
  orderHash: Hex
  createdAt: string
  cancelled?: boolean
}

export interface MockL1MatchCandidateV1 {
  schema: typeof MATCH_CANDIDATE_SCHEMA
  mockL1Only: true
  scanner: Hex
  sellOrderHash: Hex
  buyOrderHash: Hex
  chainNftId: string
  subjectNftContract: Hex
  subjectNftId: string
  quoteAsset: Hex
  clearingPrice: string
  feePolicyHash: Hex
  candidateHash: Hex
  submittedAt: string
}

export interface TradeMatchCertificateV1 {
  schema: typeof TRADE_MATCH_CERT_SCHEMA
  mockL1Only: true
  notProductionBeacon: true
  notProductionDepin: true
  candidateHash: Hex
  sellOrderHash: Hex
  buyOrderHash: Hex
  chainNftId: string
  scanner: Hex
  committee: Hex[]
  standbys: Hex[]
  clearingPrice: string
  feeBps: 1
  feeAmount: string
  scannerReward: string
  committeeReward: string
  feePolicyHash: Hex
  settlementCalldataHash: Hex
  selectionLogRef: Hex
  beaconSource: 'labInstantKeccakAfterFreeze'
  certificateHash: Hex
  quorum: number
  signers: Hex[]
  signatures: Hex[]
  certifiedAt: string
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

function isDec(value: unknown): value is string {
  return typeof value === 'string' && /^\d+$/.test(value)
}

/** Unsigned order (signature filled by client before POST /trade/submit). */
export function makeUnsignedTradeOrder(input: {
  side: OrderSide
  chainNftId: string
  maker: Hex
  subjectNftContract: Hex
  subjectNftId: string
  quoteAsset: Hex
  price: string
  amount: string
  nonce: string
  deadline: string
  feePolicyHash?: Hex
}): Omit<MockL1TradeOrderV1, 'signature'> & { signature?: Hex } {
  const feePolicyHash = (input.feePolicyHash ?? mockL1FeePolicyHash()).toLowerCase() as Hex
  const orderHash = tradeOrderHash({
    side: input.side,
    chainNftId: input.chainNftId,
    maker: input.maker.toLowerCase() as Hex,
    subjectNftContract: input.subjectNftContract.toLowerCase() as Hex,
    subjectNftId: input.subjectNftId,
    quoteAsset: input.quoteAsset.toLowerCase() as Hex,
    price: input.price,
    amount: input.amount,
    nonce: input.nonce,
    deadline: input.deadline,
    feePolicyHash,
  })
  return {
    schema: TRADE_ORDER_SCHEMA,
    mockL1Only: true,
    side: input.side,
    chainNftId: input.chainNftId,
    maker: input.maker.toLowerCase() as Hex,
    subjectNftContract: input.subjectNftContract.toLowerCase() as Hex,
    subjectNftId: input.subjectNftId,
    quoteAsset: input.quoteAsset.toLowerCase() as Hex,
    price: input.price,
    amount: input.amount,
    nonce: input.nonce,
    deadline: input.deadline,
    feePolicyHash,
    orderHash,
    createdAt: new Date().toISOString(),
  }
}

export function tradeOrderHash(fields: {
  side: OrderSide
  chainNftId: string
  maker: Hex
  subjectNftContract: Hex
  subjectNftId: string
  quoteAsset: Hex
  price: string
  amount: string
  nonce: string
  deadline: string
  feePolicyHash: Hex
}): Hex {
  return keccak256(
    concatBytes(
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
      fromHex(fields.feePolicyHash, 32),
    ),
  )
}

export function matchCandidateHash(fields: {
  scanner: Hex
  sellOrderHash: Hex
  buyOrderHash: Hex
  clearingPrice: string
}): Hex {
  return keccak256(
    concatBytes(
      utf8('dle.mockL1.candidate.v1'),
      addressBytes(fields.scanner),
      fromHex(fields.sellOrderHash, 32),
      fromHex(fields.buyOrderHash, 32),
      uintBE(BigInt(fields.clearingPrice), 32),
    ),
  )
}

export function settlementCalldataHash(fields: {
  certificateAuthorityHint: Hex
  orderHash: Hex
  buyer: Hex
  clearingPrice: string
  scanner: Hex
  committee: readonly Hex[]
}): Hex {
  const committeePacked = concatBytes(...fields.committee.map((a) => addressBytes(a)))
  return keccak256(
    concatBytes(
      utf8('dle.mockL1.settle.v1'),
      addressBytes(fields.certificateAuthorityHint),
      fromHex(fields.orderHash, 32),
      addressBytes(fields.buyer),
      uintBE(BigInt(fields.clearingPrice), 32),
      addressBytes(fields.scanner),
      committeePacked,
    ),
  )
}

export function tradeMatchCertificateHash(
  cert: Omit<TradeMatchCertificateV1, 'certificateHash' | 'signatures' | 'signers' | 'certifiedAt'>,
): Hex {
  return keccak256(
    concatBytes(
      utf8('dle.mockL1.cert.v1'),
      fromHex(cert.candidateHash, 32),
      fromHex(cert.sellOrderHash, 32),
      fromHex(cert.buyOrderHash, 32),
      addressBytes(cert.scanner),
      uintBE(BigInt(cert.clearingPrice), 32),
      fromHex(cert.settlementCalldataHash, 32),
      fromHex(cert.selectionLogRef, 32),
    ),
  )
}

export function parseTradeOrder(
  body: unknown,
): { ok: true; order: MockL1TradeOrderV1 } | { ok: false; reason: string } {
  if (!isRecord(body) || body.schema !== TRADE_ORDER_SCHEMA) {
    return { ok: false, reason: 'schema must be MockL1TradeOrderV1' }
  }
  if (body.mockL1Only !== true) return { ok: false, reason: 'order must be mockL1Only' }
  if (body.side !== ORDER_SIDE_SELL && body.side !== ORDER_SIDE_BUY) {
    return { ok: false, reason: 'side must be sell or buy' }
  }
  if (typeof body.chainNftId !== 'string' || body.chainNftId.length === 0) {
    return { ok: false, reason: 'chainNftId required' }
  }
  for (const key of ['maker', 'subjectNftContract', 'quoteAsset'] as const) {
    if (!isHexAddress(body[key])) return { ok: false, reason: `${key} must be an address` }
  }
  for (const key of ['subjectNftId', 'price', 'amount', 'nonce', 'deadline'] as const) {
    if (!isDec(body[key])) return { ok: false, reason: `${key} must be a decimal string` }
  }
  if (!isHex32(body.feePolicyHash)) return { ok: false, reason: 'feePolicyHash must be bytes32' }
  if (body.feePolicyHash.toLowerCase() !== mockL1FeePolicyHash().toLowerCase()) {
    return { ok: false, reason: 'feePolicyHash must equal canonical 1bps 50/50 policy' }
  }
  if (!(typeof body.signature === 'string' && /^0x[0-9a-fA-F]+$/.test(body.signature))) {
    return { ok: false, reason: 'signature required' }
  }
  const expected = tradeOrderHash({
    side: body.side,
    chainNftId: body.chainNftId,
    maker: (body.maker as string).toLowerCase() as Hex,
    subjectNftContract: (body.subjectNftContract as string).toLowerCase() as Hex,
    subjectNftId: body.subjectNftId as string,
    quoteAsset: (body.quoteAsset as string).toLowerCase() as Hex,
    price: body.price as string,
    amount: body.amount as string,
    nonce: body.nonce as string,
    deadline: body.deadline as string,
    feePolicyHash: (body.feePolicyHash as string).toLowerCase() as Hex,
  })
  if (isHex32(body.orderHash) && body.orderHash.toLowerCase() !== expected.toLowerCase()) {
    return { ok: false, reason: 'orderHash mismatch' }
  }
  return {
    ok: true,
    order: {
      schema: TRADE_ORDER_SCHEMA,
      mockL1Only: true,
      side: body.side,
      chainNftId: body.chainNftId,
      maker: (body.maker as string).toLowerCase() as Hex,
      subjectNftContract: (body.subjectNftContract as string).toLowerCase() as Hex,
      subjectNftId: body.subjectNftId as string,
      quoteAsset: (body.quoteAsset as string).toLowerCase() as Hex,
      price: body.price as string,
      amount: body.amount as string,
      nonce: body.nonce as string,
      deadline: body.deadline as string,
      feePolicyHash: (body.feePolicyHash as string).toLowerCase() as Hex,
      signature: body.signature as Hex,
      orderHash: expected,
      createdAt: typeof body.createdAt === 'string' ? body.createdAt : new Date().toISOString(),
      cancelled: body.cancelled === true,
    },
  }
}

export function parseMatchCandidate(
  body: unknown,
): { ok: true; candidate: MockL1MatchCandidateV1 } | { ok: false; reason: string } {
  if (!isRecord(body) || body.schema !== MATCH_CANDIDATE_SCHEMA) {
    return { ok: false, reason: 'schema must be MockL1MatchCandidateV1' }
  }
  if (body.mockL1Only !== true) return { ok: false, reason: 'candidate must be mockL1Only' }
  if (!isHexAddress(body.scanner)) return { ok: false, reason: 'scanner must be an address' }
  if (!isHex32(body.sellOrderHash) || !isHex32(body.buyOrderHash)) {
    return { ok: false, reason: 'sell/buy order hashes required' }
  }
  if (typeof body.chainNftId !== 'string') return { ok: false, reason: 'chainNftId required' }
  if (!isHexAddress(body.subjectNftContract) || !isHexAddress(body.quoteAsset)) {
    return { ok: false, reason: 'subject/quote addresses required' }
  }
  if (!isDec(body.subjectNftId) || !isDec(body.clearingPrice)) {
    return { ok: false, reason: 'subjectNftId/clearingPrice must be decimal' }
  }
  if (!isHex32(body.feePolicyHash)) return { ok: false, reason: 'feePolicyHash required' }
  const expected = matchCandidateHash({
    scanner: (body.scanner as string).toLowerCase() as Hex,
    sellOrderHash: (body.sellOrderHash as string).toLowerCase() as Hex,
    buyOrderHash: (body.buyOrderHash as string).toLowerCase() as Hex,
    clearingPrice: body.clearingPrice as string,
  })
  if (isHex32(body.candidateHash) && body.candidateHash.toLowerCase() !== expected.toLowerCase()) {
    return { ok: false, reason: 'candidateHash mismatch' }
  }
  return {
    ok: true,
    candidate: {
      schema: MATCH_CANDIDATE_SCHEMA,
      mockL1Only: true,
      scanner: (body.scanner as string).toLowerCase() as Hex,
      sellOrderHash: (body.sellOrderHash as string).toLowerCase() as Hex,
      buyOrderHash: (body.buyOrderHash as string).toLowerCase() as Hex,
      chainNftId: body.chainNftId as string,
      subjectNftContract: (body.subjectNftContract as string).toLowerCase() as Hex,
      subjectNftId: body.subjectNftId as string,
      quoteAsset: (body.quoteAsset as string).toLowerCase() as Hex,
      clearingPrice: body.clearingPrice as string,
      feePolicyHash: (body.feePolicyHash as string).toLowerCase() as Hex,
      candidateHash: expected,
      submittedAt: typeof body.submittedAt === 'string' ? body.submittedAt : new Date().toISOString(),
    },
  }
}

/** Price match: bid >= ask; same NFT + same ERC-20; neither cancelled/expired. */
export function ordersPriceMatch(sell: MockL1TradeOrderV1, buy: MockL1TradeOrderV1, nowSec: bigint): boolean {
  if (sell.cancelled || buy.cancelled) return false
  if (sell.side !== ORDER_SIDE_SELL || buy.side !== ORDER_SIDE_BUY) return false
  if (sell.chainNftId !== buy.chainNftId) return false
  if (sell.subjectNftContract.toLowerCase() !== buy.subjectNftContract.toLowerCase()) return false
  if (sell.subjectNftId !== buy.subjectNftId) return false
  if (sell.quoteAsset.toLowerCase() !== buy.quoteAsset.toLowerCase()) return false
  if (BigInt(sell.deadline) < nowSec || BigInt(buy.deadline) < nowSec) return false
  return BigInt(buy.price) >= BigInt(sell.price)
}

/**
 * Deterministic tie-break: earliest createdAt, then lexicographically smaller orderHash.
 * Returns sell+buy pairs that match; clearing price = sell ask.
 */
export function findBestMatch(
  orders: readonly MockL1TradeOrderV1[],
  nowSec: bigint,
): { sell: MockL1TradeOrderV1; buy: MockL1TradeOrderV1; clearingPrice: string } | null {
  const sells = orders
    .filter((o) => o.side === ORDER_SIDE_SELL && !o.cancelled)
    .slice()
    .sort(compareOrderPriority)
  const buys = orders
    .filter((o) => o.side === ORDER_SIDE_BUY && !o.cancelled)
    .slice()
    .sort(compareOrderPriority)
  for (const sell of sells) {
    for (const buy of buys) {
      if (!ordersPriceMatch(sell, buy, nowSec)) continue
      return { sell, buy, clearingPrice: sell.price }
    }
  }
  return null
}

function compareOrderPriority(a: MockL1TradeOrderV1, b: MockL1TradeOrderV1): number {
  const ta = Date.parse(a.createdAt)
  const tb = Date.parse(b.createdAt)
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb
  return a.orderHash.toLowerCase() < b.orderHash.toLowerCase()
    ? -1
    : a.orderHash.toLowerCase() > b.orderHash.toLowerCase()
      ? 1
      : 0
}

export function buildFeeAmounts(clearingPrice: string): {
  feeAmount: string
  scannerReward: string
  committeeReward: string
} {
  const split = computeFeeSplit(BigInt(clearingPrice))
  return {
    feeAmount: split.feeAmount.toString(),
    scannerReward: split.scannerReward.toString(),
    committeeReward: split.committeeReward.toString(),
  }
}

export function selectionLogRefOf(candidateHash: Hex, poolRoot: Hex, beacon: Hex): Hex {
  return keccak256(
    concatBytes(
      utf8('dle.mockL1.selection.v1'),
      fromHex(candidateHash, 32),
      fromHex(poolRoot, 32),
      fromHex(beacon, 32),
    ),
  )
}

export function orderPersonalSignMessage(orderHash: Hex): string {
  return `DLE mock-L1 trade order\n${orderHash}`
}

export function certPersonalSignMessage(certificateHash: Hex): string {
  return `DLE mock-L1 trade match certificate\n${certificateHash}`
}
