/**
 * Mock-L1 trade EventIngress / order pool / scanner candidate / archive check /
 * freeze-then-draw committee → TradeMatchCertificateV1.
 *
 * WaitingPool / POST /ondemand/hook MUST NOT be used as this ingress.
 */

import { Wallet, recoverAddress, hashMessage } from 'ethers'
import {
  drawCommittee,
  labBeaconAfterFreeze,
  ondemandFreezeHex,
  poolRootOf,
} from '../../shared/ondemand/index.js'
import type { Hex } from '../../shared/bytes.js'
import { mockL1FeePolicyHash } from '../../shared/mockL1.js'
import { mockL1CustodyEnv, verifyMockL1Custody } from '../../shared/mockL1Custody.js'
import { listMockL1Auction, mockL1SettleEnv, settleMockL1Auction } from '../../shared/mockL1Settle.js'
import {
  MATCH_CANDIDATE_SCHEMA,
  ORDER_SIDE_BUY,
  ORDER_SIDE_SELL,
  TRADE_MATCH_CERT_SCHEMA,
  TRADE_ORDER_SCHEMA,
  buildFeeAmounts,
  certPersonalSignMessage,
  findBestMatch,
  matchCandidateHash,
  orderPersonalSignMessage,
  ordersPriceMatch,
  parseMatchCandidate,
  parseTradeOrder,
  selectionLogRefOf,
  settlementCalldataHash,
  tradeMatchCertificateHash,
  type MockL1MatchCandidateV1,
  type MockL1TradeOrderV1,
  type TradeMatchCertificateV1,
} from '../../shared/tradeMatch.js'
import {
  EVENT_TRADE_MATCH_CERTIFIED,
  EVENT_TRADE_MATCH_PROPOSED,
  EVENT_TRADE_SETTLED,
  EVENT_TRADE_SETTLEMENT_FAILED,
  EVENT_TRADE_SETTLEMENT_SUBMITTED,
  TRADE_CLASS_ID,
  TRADE_STATE_MATCH_CERTIFIED,
  TRADE_STATE_MATCH_PROPOSED,
  TRADE_STATE_OPEN,
  TRADE_STATE_SETTLED,
  TRADE_STATE_SETTLEMENT_FAILED,
  TRADE_STATE_SETTLEMENT_SUBMITTED,
  type TradeMatchEvent,
  type TradeOpenedFields,
  type TradeParent,
} from '../bft/types.js'
import { computeTradeTipStateRoot, replayTradeMatchModeA } from '../bft/modeA.js'
import type { ArchiveStore } from '../store.js'

export type TradeMatchPhase =
  | 'open'
  | 'candidate'
  | 'archive_rejected'
  | 'match_proposed'
  | 'match_certified'
  | 'settlement_submitted'
  | 'settled'
  | 'settlement_failed'

export interface TradeMatchRecordV1 {
  candidateHash: Hex
  phase: TradeMatchPhase
  candidate: MockL1MatchCandidateV1
  sell: MockL1TradeOrderV1
  buy: MockL1TradeOrderV1
  rejectReason?: string
  freezeHex?: Hex
  poolRoot?: Hex
  beacon?: Hex
  committee?: Hex[]
  standbys?: Hex[]
  certificate?: TradeMatchCertificateV1
  /** Mode A tip after last accepted match/settlement transition. */
  tipStateRoot?: Hex
  valueHash?: Hex
  l2Nonce?: string
  /** Seller `list()` escrow tx (required before on-chain settle). */
  listTxHash?: Hex
  listError?: string
  settlementTxHash?: Hex
  settlementError?: string
  updatedAt: string
}

export interface TradeEngineOptions {
  domainId: string
  store: ArchiveStore
  /** Checker pool addresses (must be ≥ 9 for 7+2). Defaults to lab seed. */
  checkerPool?: readonly string[]
  certificateAuthorityHint?: Hex
  nowSec?: () => bigint
  /**
   * When set (or via MOCK_L1_RPC_URL + MOCK_L1_SETTLEMENT), Archive verifies
   * L1 custody with eth_call and ignores client-asserted custody flags.
   */
  l1RpcUrl?: string
  l1SettlementAddress?: Hex
  /** Test hook — overrides RPC / client flags. */
  verifyL1Custody?: (args: {
    sell: MockL1TradeOrderV1
    buy: MockL1TradeOrderV1
    clearingPrice: string
  }) => Promise<{ ok: true } | { ok: false; reason: string }>
  /**
   * When set (or via MOCK_L1_AUTHORITY_PRIVATE_KEY + MOCK_L1_SETTLE_ONCHAIN),
   * Archive may broadcast MockDleAuctionSettlement.settle as certificateAuthority.
   */
  l1AuthorityPrivateKey?: string
  /** Test hook — overrides on-chain settle broadcast. */
  submitL1SettlementTx?: (args: {
    certificateHash: Hex
    sellerOrderHash: Hex
    buyer: Hex
    clearingAmount: string
    scanner: Hex
    committee: readonly Hex[]
  }) => Promise<{ ok: true; txHash: Hex } | { ok: false; reason: string }>
  /**
   * Test hook — overrides seller `list()` escrow broadcast.
   * Production path uses MOCK_L1_RPC + settlement + request-scoped sellerPrivateKey (lab only).
   */
  submitL1ListTx?: (args: {
    sellerOrderHash: Hex
    subjectNft: Hex
    subjectNftId: string
    quoteAsset: Hex
    askAmount: string
    deadline: string
    seller: Hex
  }) => Promise<{ ok: true; txHash: Hex } | { ok: false; reason: string }>
}

export type TradePostResult = { status: number; body: unknown }

export interface TradeEngine {
  health(): Record<string, unknown>
  get(pathname: string): Record<string, unknown> | undefined
  post(
    pathname: string,
    body: unknown,
  ): TradePostResult | undefined | Promise<TradePostResult | undefined>
}

interface PersistedState {
  schema: 'MockL1TradeStateV1'
  mockL1Only: true
  notWaitingPoolIngress: true
  orders: MockL1TradeOrderV1[]
  matches: TradeMatchRecordV1[]
}

const DEFAULT_CHECKERS = [
  '0x1111111111111111111111111111111111111111',
  '0x2222222222222222222222222222222222222222',
  '0x3333333333333333333333333333333333333333',
  '0x4444444444444444444444444444444444444444',
  '0x5555555555555555555555555555555555555555',
  '0x6666666666666666666666666666666666666666',
  '0x7777777777777777777777777777777777777777',
  '0x8888888888888888888888888888888888888888',
  '0x9999999999999999999999999999999999999999',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function recoverPersonal(message: string, signature: string): string | null {
  try {
    return recoverAddress(hashMessage(message), signature).toLowerCase()
  } catch {
    return null
  }
}

export function createTradeEngine(options: TradeEngineOptions): TradeEngine {
  const orders = new Map<string, MockL1TradeOrderV1>()
  const matches = new Map<string, TradeMatchRecordV1>()
  const checkers = options.checkerPool ?? DEFAULT_CHECKERS
  const authorityHint = (options.certificateAuthorityHint ??
    ('0x0000000000000000000000000000000000000001' as Hex)).toLowerCase() as Hex
  const nowSec = options.nowSec ?? (() => BigInt(Math.floor(Date.now() / 1000)))
  const envCustody = mockL1CustodyEnv()
  const envSettle = mockL1SettleEnv()
  const l1RpcUrl = options.l1RpcUrl ?? envCustody.rpcUrl ?? envSettle.rpcUrl
  const l1Settlement = options.l1SettlementAddress ?? envCustody.settlement ?? envSettle.settlement
  const l1AuthorityPk = options.l1AuthorityPrivateKey ?? envSettle.authorityPrivateKey
  const rpcCustodyConfigured = Boolean(l1RpcUrl && l1Settlement) || options.verifyL1Custody !== undefined
  const onChainSettleConfigured =
    options.submitL1SettlementTx !== undefined ||
    Boolean(l1RpcUrl && l1Settlement && l1AuthorityPk)
  const listConfigured =
    options.submitL1ListTx !== undefined || Boolean(l1RpcUrl && l1Settlement)

  function persist(): void {
    const state: PersistedState = {
      schema: 'MockL1TradeStateV1',
      mockL1Only: true,
      notWaitingPoolIngress: true,
      orders: [...orders.values()],
      matches: [...matches.values()],
    }
    options.store.persistTradeState(state)
  }

  const loaded = options.store.loadTradeState()
  if (isRecord(loaded) && loaded.schema === 'MockL1TradeStateV1') {
    if (Array.isArray(loaded.orders)) {
      for (const row of loaded.orders) {
        const parsed = parseTradeOrder(row)
        if (parsed.ok) orders.set(parsed.order.orderHash.toLowerCase(), parsed.order)
      }
    }
    if (Array.isArray(loaded.matches)) {
      for (const row of loaded.matches) {
        if (!isRecord(row) || typeof row.candidateHash !== 'string') continue
        matches.set(row.candidateHash.toLowerCase(), row as unknown as TradeMatchRecordV1)
      }
    }
  }

  function ordersList(): Record<string, unknown> {
    return {
      schema: 'MockL1TradeOrderListV1',
      mockL1Only: true,
      notWaitingPoolIngress: true,
      count: orders.size,
      orders: [...orders.values()],
    }
  }

  function matchesList(): Record<string, unknown> {
    return {
      schema: 'MockL1TradeMatchListV1',
      mockL1Only: true,
      notWaitingPoolIngress: true,
      count: matches.size,
      matches: [...matches.values()],
    }
  }

  function health(): Record<string, unknown> {
    const byPhase: Record<string, number> = {}
    for (const m of matches.values()) {
      byPhase[m.phase] = (byPhase[m.phase] ?? 0) + 1
    }
    return {
      tradeMockL1Only: true,
      tradeNotWaitingPoolIngress: true,
      tradeNotProductionBeacon: true,
      tradeNotProductionDepin: true,
      tradeRpcCustodyConfigured: rpcCustodyConfigured,
      tradeRpcCustodyMode: options.verifyL1Custody !== undefined
        ? 'hook'
        : l1RpcUrl && l1Settlement
          ? 'eth_call'
          : 'client_assert_fallback',
      tradeOnChainSettleConfigured: onChainSettleConfigured,
      tradeOnChainSettleMode: options.submitL1SettlementTx !== undefined
        ? 'hook'
        : onChainSettleConfigured
          ? 'rpc'
          : 'off',
      /** Seller can list into escrow when RPC+settlement (or list hook) is set. */
      tradeListConfigured: listConfigured,
      tradeListMode: options.submitL1ListTx !== undefined
        ? 'hook'
        : listConfigured
          ? 'rpc'
          : 'off',
      /** Settlement address when configured — never private keys. */
      tradeMockL1Settlement: l1Settlement ?? null,
      tradeOrderCount: orders.size,
      tradeMatchCount: matches.size,
      tradeByPhase: byPhase,
      tradeFeeBps: 1,
      tradeFeeSplit: 'scanner50/committee50',
    }
  }

  function submitOrder(body: unknown): { status: number; body: Record<string, unknown> } {
    const parsed = parseTradeOrder(body)
    if (!parsed.ok) return { status: 400, body: { ok: false, error: parsed.reason } }
    const recovered = recoverPersonal(
      orderPersonalSignMessage(parsed.order.orderHash),
      parsed.order.signature,
    )
    if (recovered === null || recovered !== parsed.order.maker.toLowerCase()) {
      return { status: 400, body: { ok: false, error: 'order signature recover mismatch' } }
    }
    if (BigInt(parsed.order.deadline) < nowSec()) {
      return { status: 400, body: { ok: false, error: 'order deadline expired' } }
    }
    const key = parsed.order.orderHash.toLowerCase()
    const existing = orders.get(key)
    if (existing !== undefined) {
      return { status: 200, body: { ok: true, duplicate: true, order: existing } }
    }
    orders.set(key, parsed.order)
    persist()
    options.store.appendWal({ type: 'trade-submit', orderHash: parsed.order.orderHash, side: parsed.order.side })
    return { status: 200, body: { ok: true, duplicate: false, order: parsed.order } }
  }

  function cancelOrder(body: unknown): { status: number; body: Record<string, unknown> } {
    if (!isRecord(body) || typeof body.orderHash !== 'string') {
      return { status: 400, body: { ok: false, error: 'orderHash required' } }
    }
    const order = orders.get(body.orderHash.toLowerCase())
    if (order === undefined) return { status: 404, body: { ok: false, error: 'order not found' } }
    if (typeof body.signature !== 'string') {
      return { status: 400, body: { ok: false, error: 'signature required' } }
    }
    const recovered = recoverPersonal(orderPersonalSignMessage(order.orderHash), body.signature)
    if (recovered === null || recovered !== order.maker.toLowerCase()) {
      return { status: 400, body: { ok: false, error: 'cancel signature mismatch' } }
    }
    order.cancelled = true
    persist()
    options.store.appendWal({ type: 'trade-cancel', orderHash: order.orderHash })
    return { status: 200, body: { ok: true, order } }
  }

  function scan(body: unknown): { status: number; body: Record<string, unknown> } {
    const scanner =
      isRecord(body) && typeof body.scanner === 'string'
        ? body.scanner.toLowerCase()
        : '0x00000000000000000000000000000000000000aa'
    const best = findBestMatch([...orders.values()], nowSec())
    if (best === null) {
      return { status: 200, body: { ok: true, match: null, reason: 'no price-compatible open orders' } }
    }
    const candidate: MockL1MatchCandidateV1 = {
      schema: MATCH_CANDIDATE_SCHEMA,
      mockL1Only: true,
      scanner: scanner as Hex,
      sellOrderHash: best.sell.orderHash,
      buyOrderHash: best.buy.orderHash,
      chainNftId: best.sell.chainNftId,
      subjectNftContract: best.sell.subjectNftContract,
      subjectNftId: best.sell.subjectNftId,
      quoteAsset: best.sell.quoteAsset,
      clearingPrice: best.clearingPrice,
      feePolicyHash: mockL1FeePolicyHash(),
      candidateHash: matchCandidateHash({
        scanner: scanner as Hex,
        sellOrderHash: best.sell.orderHash,
        buyOrderHash: best.buy.orderHash,
        clearingPrice: best.clearingPrice,
      }),
      submittedAt: new Date().toISOString(),
    }
    return { status: 200, body: { ok: true, match: candidate, sell: best.sell, buy: best.buy } }
  }

  function submitCandidate(body: unknown): { status: number; body: Record<string, unknown> } {
    const parsed = parseMatchCandidate(body)
    if (!parsed.ok) return { status: 400, body: { ok: false, error: parsed.reason } }
    const sell = orders.get(parsed.candidate.sellOrderHash.toLowerCase())
    const buy = orders.get(parsed.candidate.buyOrderHash.toLowerCase())
    if (sell === undefined || buy === undefined) {
      return { status: 400, body: { ok: false, error: 'referenced orders missing from pool' } }
    }
    const key = parsed.candidate.candidateHash.toLowerCase()
    const existing = matches.get(key)
    if (existing !== undefined) {
      return { status: 200, body: { ok: true, duplicate: true, match: existing } }
    }
    const record: TradeMatchRecordV1 = {
      candidateHash: parsed.candidate.candidateHash,
      phase: 'candidate',
      candidate: parsed.candidate,
      sell,
      buy,
      updatedAt: new Date().toISOString(),
    }
    matches.set(key, record)
    persist()
    options.store.appendWal({ type: 'trade-candidate', candidateHash: record.candidateHash })
    return { status: 200, body: { ok: true, duplicate: false, match: record } }
  }

  function orderAsOpenedFields(sell: MockL1TradeOrderV1): TradeOpenedFields {
    return {
      sellerOrderHash: sell.orderHash,
      subjectNftContract: sell.subjectNftContract,
      subjectNftId: `0x${BigInt(sell.subjectNftId).toString(16).padStart(64, '0')}` as Hex,
      seller: sell.maker,
      quoteAsset: sell.quoteAsset,
      quoteAmount: BigInt(sell.price),
      buyerConstraint: '0x0000000000000000000000000000000000000000' as Hex,
      feePolicyHash: sell.feePolicyHash,
      deadline: BigInt(sell.deadline),
      sellerNonce: BigInt(sell.nonce),
    }
  }

  function parentFromRecord(record: TradeMatchRecordV1): TradeParent {
    const state =
      record.phase === 'match_proposed'
        ? TRADE_STATE_MATCH_PROPOSED
        : record.phase === 'match_certified'
          ? TRADE_STATE_MATCH_CERTIFIED
          : record.phase === 'settlement_submitted'
            ? TRADE_STATE_SETTLEMENT_SUBMITTED
            : record.phase === 'settled'
              ? TRADE_STATE_SETTLED
              : record.phase === 'settlement_failed'
                ? TRADE_STATE_SETTLEMENT_FAILED
                : TRADE_STATE_OPEN
    return {
      state,
      nonce: BigInt(record.l2Nonce ?? '0'),
      tipStateRoot: (record.tipStateRoot ??
        '0x0000000000000000000000000000000000000000000000000000000000000000') as Hex,
    }
  }

  function applyMatchTransition(
    record: TradeMatchRecordV1,
    eventType: number,
  ): { ok: true } | { ok: false; error: string } {
    const cert = record.certificate
    if (cert === undefined) return { ok: false, error: 'certificate missing' }
    const order = orderAsOpenedFields(record.sell)
    const parent = parentFromRecord(record)
    const event: TradeMatchEvent = {
      version: 1,
      classId: TRADE_CLASS_ID,
      eventType,
      tipId: record.candidateHash,
      nonce: parent.nonce + 1n,
      candidateHash: record.candidateHash,
      certificateHash: cert.certificateHash,
      sellOrderHash: record.sell.orderHash,
      buyOrderHash: record.buy.orderHash,
      scanner: record.candidate.scanner,
      clearingPrice: BigInt(cert.clearingPrice),
      feeAmount: BigInt(cert.feeAmount),
      scannerReward: BigInt(cert.scannerReward),
      committeeReward: BigInt(cert.committeeReward),
      feePolicyHash: cert.feePolicyHash,
      settlementCalldataHash: cert.settlementCalldataHash,
      quorum: cert.quorum,
      signerCount: Math.max(cert.signers.length, cert.quorum),
    }
    const replay = replayTradeMatchModeA({
      parent,
      order,
      event,
      buyer: record.buy.maker,
      alreadySettledCertificate: record.phase === 'settled',
    })
    if (!replay.ok) return { ok: false, error: `${replay.code}:${replay.reason}` }
    record.tipStateRoot = replay.tipStateRoot
    record.valueHash = replay.valueHash
    record.l2Nonce = replay.nonce.toString()
    return { ok: true }
  }

  async function archiveCheck(body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
    if (!isRecord(body) || typeof body.candidateHash !== 'string') {
      return { status: 400, body: { ok: false, error: 'candidateHash required' } }
    }
    const record = matches.get(body.candidateHash.toLowerCase())
    if (record === undefined) return { status: 404, body: { ok: false, error: 'candidate not found' } }
    if (record.phase !== 'candidate' && record.phase !== 'archive_rejected') {
      return { status: 200, body: { ok: true, duplicate: true, match: record } }
    }

    const sell = orders.get(record.sell.orderHash.toLowerCase()) ?? record.sell
    const buy = orders.get(record.buy.orderHash.toLowerCase()) ?? record.buy
    const reject = (reason: string) => {
      record.phase = 'archive_rejected'
      record.rejectReason = reason
      record.updatedAt = new Date().toISOString()
      persist()
      options.store.appendWal({ type: 'trade-archive-reject', candidateHash: record.candidateHash, reason })
      return { status: 400, body: { ok: false, error: reason, match: record } }
    }

    if (sell.cancelled || buy.cancelled) return reject('order cancelled')
    if (!ordersPriceMatch(sell, buy, nowSec())) return reject('price/asset/deadline mismatch')
    if (sell.side !== ORDER_SIDE_SELL || buy.side !== ORDER_SIDE_BUY) return reject('side mismatch')
    if (record.candidate.clearingPrice !== sell.price) return reject('clearingPrice must equal sell ask')
    if (record.candidate.feePolicyHash.toLowerCase() !== mockL1FeePolicyHash().toLowerCase()) {
      return reject('fee policy mismatch')
    }

    if (rpcCustodyConfigured) {
      const verified =
        options.verifyL1Custody !== undefined
          ? await options.verifyL1Custody({
              sell,
              buy,
              clearingPrice: record.candidate.clearingPrice,
            })
          : await verifyMockL1Custody({
              rpcUrl: l1RpcUrl!,
              settlement: l1Settlement!,
              seller: sell.maker,
              subjectNftContract: sell.subjectNftContract,
              subjectNftId: sell.subjectNftId,
              buyer: buy.maker,
              quoteAsset: buy.quoteAsset,
              clearingPrice: record.candidate.clearingPrice,
            })
      if (!verified.ok) return reject(verified.reason)
    } else {
      // Lab-only fallback when no local RPC is wired: require explicit client
      // assertions. Prefer MOCK_L1_RPC_URL + MOCK_L1_SETTLEMENT in demos.
      const custodyOk = body.l1EscrowCustody === true
      if (!custodyOk) return reject('L1 escrow custody not confirmed')
      const balanceOk = body.buyerBalanceOk !== false
      const allowanceOk = body.buyerAllowanceOk !== false
      if (!balanceOk || !allowanceOk) return reject('buyer balance/allowance check failed')
    }

    // Freeze then draw — lab beacon only (not production CL RANDAO).
    const poolRoot = poolRootOf(checkers)
    const freezeHex = ondemandFreezeHex({
      poolRoot,
      epoch: 1,
      shardId: 'mock-l1-trade',
      groupId: options.domainId,
    })
    const beacon = labBeaconAfterFreeze(poolRoot, 1, 'mock-l1-trade')
    const draw = drawCommittee({
      miners: [...checkers],
      epoch: 1,
      shardId: 'mock-l1-trade',
      beacon,
    })
    const fees = buildFeeAmounts(record.candidate.clearingPrice)
    const settleHash = settlementCalldataHash({
      certificateAuthorityHint: authorityHint,
      orderHash: sell.orderHash,
      buyer: buy.maker,
      clearingPrice: record.candidate.clearingPrice,
      scanner: record.candidate.scanner,
      committee: draw.committee,
    })
    const selectionLogRef = selectionLogRefOf(record.candidateHash, poolRoot, beacon)
    const unsigned = {
      schema: TRADE_MATCH_CERT_SCHEMA,
      mockL1Only: true as const,
      notProductionBeacon: true as const,
      notProductionDepin: true as const,
      candidateHash: record.candidateHash,
      sellOrderHash: sell.orderHash,
      buyOrderHash: buy.orderHash,
      chainNftId: sell.chainNftId,
      scanner: record.candidate.scanner,
      committee: draw.committee,
      standbys: draw.standbys,
      clearingPrice: record.candidate.clearingPrice,
      feeBps: 1 as const,
      feeAmount: fees.feeAmount,
      scannerReward: fees.scannerReward,
      committeeReward: fees.committeeReward,
      feePolicyHash: mockL1FeePolicyHash(),
      settlementCalldataHash: settleHash,
      selectionLogRef,
      beaconSource: 'labInstantKeccakAfterFreeze' as const,
      quorum: 5,
    }
    const certificateHash = tradeMatchCertificateHash(unsigned)
    const certificate: TradeMatchCertificateV1 = {
      ...unsigned,
      certificateHash,
      signers: [],
      signatures: [],
      certifiedAt: '',
    }
    record.certificate = certificate
    record.sell = sell
    record.buy = buy
    delete record.rejectReason
    record.freezeHex = freezeHex
    record.poolRoot = poolRoot
    record.beacon = beacon
    record.committee = draw.committee
    record.standbys = draw.standbys
    // Seed Open tip so MatchProposed can advance Mode A from Open.
    if (record.l2Nonce === undefined) {
      record.l2Nonce = '0'
      record.tipStateRoot = computeTradeTipStateRoot({
        state: TRADE_STATE_OPEN,
        nonce: 0n,
        order: orderAsOpenedFields(sell),
      })
    }
    const proposed = applyMatchTransition(record, EVENT_TRADE_MATCH_PROPOSED)
    if (!proposed.ok) {
      return { status: 400, body: { ok: false, error: proposed.error, match: record } }
    }
    record.phase = 'match_proposed'
    record.updatedAt = new Date().toISOString()
    persist()
    options.store.appendWal({
      type: 'trade-match-proposed',
      candidateHash: record.candidateHash,
      certificateHash,
      tipStateRoot: record.tipStateRoot,
      committee: draw.committee,
    })
    return { status: 200, body: { ok: true, match: record } }
  }

  function attest(body: unknown): { status: number; body: Record<string, unknown> } {
    if (!isRecord(body) || typeof body.candidateHash !== 'string') {
      return { status: 400, body: { ok: false, error: 'candidateHash required' } }
    }
    if (typeof body.signature !== 'string' || typeof body.signer !== 'string') {
      return { status: 400, body: { ok: false, error: 'signer + signature required' } }
    }
    const record = matches.get(body.candidateHash.toLowerCase())
    if (record === undefined || record.certificate === undefined) {
      return { status: 404, body: { ok: false, error: 'proposed match not found' } }
    }
    if (record.phase !== 'match_proposed' && record.phase !== 'match_certified') {
      return { status: 400, body: { ok: false, error: `cannot attest in phase ${record.phase}` } }
    }
    const cert = record.certificate
    const signer = body.signer.toLowerCase() as Hex
    if (!cert.committee.map((a) => a.toLowerCase()).includes(signer)) {
      return { status: 400, body: { ok: false, error: 'signer not on committee' } }
    }
    const recovered = recoverPersonal(certPersonalSignMessage(cert.certificateHash), body.signature)
    if (recovered === null || recovered !== signer) {
      return { status: 400, body: { ok: false, error: 'attest signature mismatch' } }
    }
    const idx = cert.signers.findIndex((s) => s.toLowerCase() === signer)
    if (idx >= 0) {
      return { status: 200, body: { ok: true, duplicate: true, match: record } }
    }
    cert.signers.push(signer)
    cert.signatures.push(body.signature as Hex)
    if (cert.signers.length >= cert.quorum) {
      cert.certifiedAt = new Date().toISOString()
      const transition = applyMatchTransition(record, EVENT_TRADE_MATCH_CERTIFIED)
      if (!transition.ok) {
        cert.signers.pop()
        cert.signatures.pop()
        return { status: 400, body: { ok: false, error: transition.error } }
      }
      record.phase = 'match_certified'
      options.store.appendWal({
        type: 'trade-match-certified',
        candidateHash: record.candidateHash,
        certificateHash: cert.certificateHash,
        tipStateRoot: record.tipStateRoot,
        quorum: cert.quorum,
      })
    }
    record.updatedAt = new Date().toISOString()
    persist()
    return { status: 200, body: { ok: true, match: record } }
  }

  /**
   * Seller escrows NFT via MockDleAuctionSettlement.list (required before settle).
   * Lab-only: request may carry sellerPrivateKey (session key from Explorer); never persisted.
   */
  async function listEscrow(body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
    if (!isRecord(body) || typeof body.candidateHash !== 'string') {
      return { status: 400, body: { ok: false, error: 'candidateHash required' } }
    }
    if (typeof body.sellerPrivateKey !== 'string' || !body.sellerPrivateKey.trim()) {
      return {
        status: 400,
        body: {
          ok: false,
          error: 'sellerPrivateKey required (lab session key; not stored on Archive)',
        },
      }
    }
    const record = matches.get(body.candidateHash.toLowerCase())
    if (record === undefined) return { status: 404, body: { ok: false, error: 'match not found' } }

    let sellerWallet: Wallet
    try {
      sellerWallet = new Wallet(body.sellerPrivateKey.trim())
    } catch {
      return { status: 400, body: { ok: false, error: 'invalid sellerPrivateKey' } }
    }
    if (sellerWallet.address.toLowerCase() !== record.sell.maker.toLowerCase()) {
      return {
        status: 400,
        body: { ok: false, error: 'sellerPrivateKey does not match sell order maker' },
      }
    }

    const onChain =
      options.submitL1ListTx !== undefined
        ? await options.submitL1ListTx({
            sellerOrderHash: record.sell.orderHash,
            subjectNft: record.sell.subjectNftContract,
            subjectNftId: record.sell.subjectNftId,
            quoteAsset: record.sell.quoteAsset,
            askAmount: record.sell.price,
            deadline: record.sell.deadline,
            seller: record.sell.maker,
          })
        : l1RpcUrl && l1Settlement
          ? await listMockL1Auction({
              rpcUrl: l1RpcUrl,
              settlement: l1Settlement,
              sellerPrivateKey: body.sellerPrivateKey.trim(),
              sellerOrderHash: record.sell.orderHash,
              subjectNft: record.sell.subjectNftContract,
              subjectNftId: record.sell.subjectNftId,
              quoteAsset: record.sell.quoteAsset,
              askAmount: record.sell.price,
              deadline: record.sell.deadline,
            })
          : {
              ok: false as const,
              reason: 'list not configured (need MOCK_L1_RPC_URL + MOCK_L1_SETTLEMENT)',
            }

    if (!onChain.ok) {
      record.listError = onChain.reason
      record.updatedAt = new Date().toISOString()
      persist()
      return { status: 400, body: { ok: false, error: onChain.reason, match: record } }
    }

    record.listTxHash = onChain.txHash
    record.listError = undefined
    record.updatedAt = new Date().toISOString()
    persist()
    options.store.appendWal({
      type: 'trade-list',
      candidateHash: record.candidateHash,
      listTxHash: record.listTxHash,
    })
    return {
      status: 200,
      body: { ok: true, match: record, onChain: true, mockL1Only: true, listTxHash: record.listTxHash },
    }
  }

  async function settleStatus(body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
    if (!isRecord(body) || typeof body.candidateHash !== 'string') {
      return { status: 400, body: { ok: false, error: 'candidateHash required' } }
    }
    const record = matches.get(body.candidateHash.toLowerCase())
    if (record === undefined) return { status: 404, body: { ok: false, error: 'match not found' } }
    if (record.phase !== 'match_certified' && record.phase !== 'settlement_submitted') {
      return { status: 400, body: { ok: false, error: 'certificate not ready for settlement' } }
    }
    const outcome = typeof body.outcome === 'string' ? body.outcome : 'submitted'
    if (outcome !== 'submitted' && outcome !== 'settled' && outcome !== 'failed') {
      return { status: 400, body: { ok: false, error: 'outcome must be submitted|settled|failed' } }
    }

    const executeOnChain =
      body.executeOnChain === true || envSettle.settleOnChain || options.submitL1SettlementTx !== undefined

    if (
      executeOnChain &&
      outcome !== 'failed' &&
      record.phase === 'match_certified' &&
      record.certificate !== undefined
    ) {
      const cert = record.certificate
      const committee =
        cert.signers.length > 0
          ? cert.signers
          : (cert.committee ?? record.committee ?? [])
      const onChain =
        options.submitL1SettlementTx !== undefined
          ? await options.submitL1SettlementTx({
              certificateHash: cert.certificateHash,
              sellerOrderHash: record.sell.orderHash,
              buyer: record.buy.maker,
              clearingAmount: record.candidate.clearingPrice,
              scanner: record.candidate.scanner,
              committee,
            })
          : l1RpcUrl && l1Settlement && l1AuthorityPk
            ? await settleMockL1Auction({
                rpcUrl: l1RpcUrl,
                settlement: l1Settlement,
                authorityPrivateKey: l1AuthorityPk,
                certificateHash: cert.certificateHash,
                sellerOrderHash: record.sell.orderHash,
                buyer: record.buy.maker,
                clearingAmount: record.candidate.clearingPrice,
                scanner: record.candidate.scanner,
                committee,
              })
            : { ok: false as const, reason: 'on-chain settle not configured (need MOCK_L1_RPC_URL + MOCK_L1_SETTLEMENT + MOCK_L1_AUTHORITY_PRIVATE_KEY)' }

      if (!onChain.ok) {
        const failTransition = applyMatchTransition(record, EVENT_TRADE_SETTLEMENT_FAILED)
        if (failTransition.ok) {
          record.phase = 'settlement_failed'
          record.settlementError = onChain.reason
          record.updatedAt = new Date().toISOString()
          persist()
          options.store.appendWal({
            type: 'trade-settlement',
            candidateHash: record.candidateHash,
            phase: record.phase,
            tipStateRoot: record.tipStateRoot,
            valueHash: record.valueHash,
          })
        }
        return { status: 400, body: { ok: false, error: onChain.reason, match: record } }
      }
      record.settlementTxHash = onChain.txHash
      // Mode A: certified → submitted → settled when caller asked for settled.
      const submitted = applyMatchTransition(record, EVENT_TRADE_SETTLEMENT_SUBMITTED)
      if (!submitted.ok) return { status: 400, body: { ok: false, error: submitted.error } }
      record.phase = 'settlement_submitted'
      if (outcome === 'settled') {
        const settled = applyMatchTransition(record, EVENT_TRADE_SETTLED)
        if (!settled.ok) return { status: 400, body: { ok: false, error: settled.error } }
        record.phase = 'settled'
        record.sell.cancelled = true
        record.buy.cancelled = true
        orders.set(record.sell.orderHash.toLowerCase(), record.sell)
        orders.set(record.buy.orderHash.toLowerCase(), record.buy)
      }
      record.updatedAt = new Date().toISOString()
      persist()
      options.store.appendWal({
        type: 'trade-settlement',
        candidateHash: record.candidateHash,
        phase: record.phase,
        tipStateRoot: record.tipStateRoot,
        valueHash: record.valueHash,
        settlementTxHash: record.settlementTxHash,
      })
      return { status: 200, body: { ok: true, match: record, onChain: true, mockL1Only: true } }
    }

    const eventType =
      outcome === 'submitted'
        ? EVENT_TRADE_SETTLEMENT_SUBMITTED
        : outcome === 'settled'
          ? EVENT_TRADE_SETTLED
          : EVENT_TRADE_SETTLEMENT_FAILED
    const transition = applyMatchTransition(record, eventType)
    if (!transition.ok) return { status: 400, body: { ok: false, error: transition.error } }
    if (outcome === 'submitted') {
      record.phase = 'settlement_submitted'
      if (typeof body.txHash === 'string') record.settlementTxHash = body.txHash as Hex
    } else if (outcome === 'settled') {
      record.phase = 'settled'
      if (typeof body.txHash === 'string') record.settlementTxHash = body.txHash as Hex
      record.sell.cancelled = true
      record.buy.cancelled = true
      orders.set(record.sell.orderHash.toLowerCase(), record.sell)
      orders.set(record.buy.orderHash.toLowerCase(), record.buy)
    } else {
      record.phase = 'settlement_failed'
      record.settlementError = typeof body.error === 'string' ? body.error : 'settlement failed'
    }
    record.updatedAt = new Date().toISOString()
    persist()
    options.store.appendWal({
      type: 'trade-settlement',
      candidateHash: record.candidateHash,
      phase: record.phase,
      tipStateRoot: record.tipStateRoot,
      valueHash: record.valueHash,
    })
    return { status: 200, body: { ok: true, match: record } }
  }

  return {
    health,
    get(pathname) {
      if (pathname === '/trade/orders') return ordersList()
      if (pathname === '/trade/matches' || pathname === '/trade/timeline') return matchesList()
      return undefined
    },
    post(pathname, body) {
      if (pathname === '/trade/submit') return submitOrder(body)
      if (pathname === '/trade/cancel') return cancelOrder(body)
      if (pathname === '/trade/scan') return scan(body)
      if (pathname === '/trade/candidate') return submitCandidate(body)
      if (pathname === '/trade/check') return archiveCheck(body)
      if (pathname === '/trade/attest') return attest(body)
      if (pathname === '/trade/list') return listEscrow(body)
      if (pathname === '/trade/settle') return settleStatus(body)
      return undefined
    },
  }
}
