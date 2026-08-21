import test from 'node:test'
import assert from 'node:assert/strict'
import { keccak256Utf8, type Hex } from '../src/archive/bft/bytes.js'
import { labGenesisDepositBundle } from '../src/archive/bft/labCandidate.js'
import { replayDepositBundle, replayTradeMatchModeA } from '../src/archive/bft/modeA.js'
import {
  ERR_TRADE_BAD_PHASE,
  ERR_TRADE_CERT_QUORUM,
  ERR_TRADE_MATCH_INVALID,
  ERR_TRADE_SETTLE_REPLAY,
  EVENT_TRADE_MATCH_CERTIFIED,
  EVENT_TRADE_MATCH_PROPOSED,
  EVENT_TRADE_SETTLED,
  EVENT_TRADE_SETTLEMENT_FAILED,
  EVENT_TRADE_SETTLEMENT_SUBMITTED,
  TRADE_CLASS_ID,
  TRADE_STATE_MATCH_CERTIFIED,
  TRADE_STATE_MATCH_PROPOSED,
  TRADE_STATE_OPEN,
  TRADE_STATE_SETTLEMENT_SUBMITTED,
  type TradeMatchEvent,
  type TradeOpenedFields,
  type TradeParent,
} from '../src/archive/bft/types.js'

const BUYER = '0x5555555555555555555555555555555555555555' as Hex
const SCANNER = '0x6666666666666666666666666666666666666666' as Hex

function openOrder(): { parent: TradeParent; order: TradeOpenedFields } {
  const bundle = labGenesisDepositBundle()
  const opened = replayDepositBundle(bundle)
  assert.equal(opened.ok, true)
  if (!opened.ok) throw new Error('open failed')
  return {
    parent: {
      state: TRADE_STATE_OPEN,
      nonce: opened.nonce,
      tipStateRoot: opened.tipStateRoot,
    },
    order: {
      sellerOrderHash: bundle.event.sellerOrderHash,
      subjectNftContract: bundle.event.subjectNftContract,
      subjectNftId: bundle.event.subjectNftId,
      seller: bundle.event.seller,
      quoteAsset: bundle.event.quoteAsset,
      quoteAmount: bundle.event.quoteAmount,
      buyerConstraint: bundle.event.buyerConstraint,
      feePolicyHash: bundle.event.feePolicyHash,
      deadline: bundle.event.deadline,
      sellerNonce: bundle.event.sellerNonce,
    },
  }
}

function matchEvent(
  order: TradeOpenedFields,
  parent: TradeParent,
  eventType: number,
  overrides: Partial<TradeMatchEvent> = {},
): TradeMatchEvent {
  const clearingPrice = order.quoteAmount
  const feeAmount = clearingPrice / 10_000n
  const scannerReward = feeAmount / 2n
  const committeeReward = feeAmount - scannerReward
  return {
    version: 1,
    classId: TRADE_CLASS_ID,
    eventType,
    tipId: keccak256Utf8('dle.test.match.tip'),
    nonce: parent.nonce + 1n,
    candidateHash: keccak256Utf8('dle.test.candidate'),
    certificateHash: keccak256Utf8('dle.test.cert'),
    sellOrderHash: order.sellerOrderHash,
    buyOrderHash: keccak256Utf8('dle.test.buy'),
    scanner: SCANNER,
    clearingPrice,
    feeAmount,
    scannerReward,
    committeeReward,
    feePolicyHash: order.feePolicyHash,
    settlementCalldataHash: keccak256Utf8('dle.test.settle.calldata'),
    quorum: 5,
    signerCount: 5,
    ...overrides,
  }
}

test('MatchProposed → MatchCertified → SettlementSubmitted → Settled', () => {
  const { parent, order } = openOrder()
  const proposed = replayTradeMatchModeA({
    parent,
    order,
    event: matchEvent(order, parent, EVENT_TRADE_MATCH_PROPOSED),
    buyer: BUYER,
  })
  assert.equal(proposed.ok, true)
  if (!proposed.ok) return
  assert.equal(proposed.nextState, TRADE_STATE_MATCH_PROPOSED)

  const afterProposed: TradeParent = {
    state: proposed.nextState,
    nonce: proposed.nonce,
    tipStateRoot: proposed.tipStateRoot,
  }
  const certified = replayTradeMatchModeA({
    parent: afterProposed,
    order,
    event: matchEvent(order, afterProposed, EVENT_TRADE_MATCH_CERTIFIED),
    buyer: BUYER,
  })
  assert.equal(certified.ok, true)
  if (!certified.ok) return
  assert.equal(certified.nextState, TRADE_STATE_MATCH_CERTIFIED)

  const afterCert: TradeParent = {
    state: certified.nextState,
    nonce: certified.nonce,
    tipStateRoot: certified.tipStateRoot,
  }
  const submitted = replayTradeMatchModeA({
    parent: afterCert,
    order,
    event: matchEvent(order, afterCert, EVENT_TRADE_SETTLEMENT_SUBMITTED),
    buyer: BUYER,
  })
  assert.equal(submitted.ok, true)
  if (!submitted.ok) return
  assert.equal(submitted.nextState, TRADE_STATE_SETTLEMENT_SUBMITTED)

  const afterSubmit: TradeParent = {
    state: submitted.nextState,
    nonce: submitted.nonce,
    tipStateRoot: submitted.tipStateRoot,
  }
  const settled = replayTradeMatchModeA({
    parent: afterSubmit,
    order,
    event: matchEvent(order, afterSubmit, EVENT_TRADE_SETTLED),
    buyer: BUYER,
  })
  assert.equal(settled.ok, true)
  if (settled.ok) assert.equal(settled.nextState, 5)
})

test('MatchCertified rejects insufficient quorum', () => {
  const { parent, order } = openOrder()
  const proposed = replayTradeMatchModeA({
    parent,
    order,
    event: matchEvent(order, parent, EVENT_TRADE_MATCH_PROPOSED),
    buyer: BUYER,
  })
  assert.equal(proposed.ok, true)
  if (!proposed.ok) return
  const afterProposed: TradeParent = {
    state: proposed.nextState,
    nonce: proposed.nonce,
    tipStateRoot: proposed.tipStateRoot,
  }
  const bad = replayTradeMatchModeA({
    parent: afterProposed,
    order,
    event: matchEvent(order, afterProposed, EVENT_TRADE_MATCH_CERTIFIED, {
      quorum: 5,
      signerCount: 4,
    }),
    buyer: BUYER,
  })
  assert.equal(bad.ok, false)
  if (!bad.ok) assert.equal(bad.code, ERR_TRADE_CERT_QUORUM)
})

test('bad phase is rejected', () => {
  const { parent, order } = openOrder()
  const skip = replayTradeMatchModeA({
    parent,
    order,
    event: matchEvent(order, parent, EVENT_TRADE_MATCH_CERTIFIED),
    buyer: BUYER,
  })
  assert.equal(skip.ok, false)
  if (!skip.ok) assert.equal(skip.code, ERR_TRADE_BAD_PHASE)
})

test('fee split must be 1 bps 50/50', () => {
  const { parent, order } = openOrder()
  const badFee = replayTradeMatchModeA({
    parent,
    order,
    event: matchEvent(order, parent, EVENT_TRADE_MATCH_PROPOSED, {
      feeAmount: 1n,
      scannerReward: 1n,
      committeeReward: 0n,
    }),
    buyer: BUYER,
  })
  assert.equal(badFee.ok, false)
  if (!badFee.ok) assert.equal(badFee.code, ERR_TRADE_MATCH_INVALID)
})

test('Settled rejects certificate replay', () => {
  const { parent, order } = openOrder()
  const proposed = replayTradeMatchModeA({
    parent,
    order,
    event: matchEvent(order, parent, EVENT_TRADE_MATCH_PROPOSED),
    buyer: BUYER,
  })
  assert.equal(proposed.ok, true)
  if (!proposed.ok) return
  let cur: TradeParent = {
    state: proposed.nextState,
    nonce: proposed.nonce,
    tipStateRoot: proposed.tipStateRoot,
  }
  const certified = replayTradeMatchModeA({
    parent: cur,
    order,
    event: matchEvent(order, cur, EVENT_TRADE_MATCH_CERTIFIED),
    buyer: BUYER,
  })
  assert.equal(certified.ok, true)
  if (!certified.ok) return
  cur = { state: certified.nextState, nonce: certified.nonce, tipStateRoot: certified.tipStateRoot }
  const replay = replayTradeMatchModeA({
    parent: cur,
    order,
    event: matchEvent(order, cur, EVENT_TRADE_SETTLED),
    buyer: BUYER,
    alreadySettledCertificate: true,
  })
  assert.equal(replay.ok, false)
  if (!replay.ok) assert.equal(replay.code, ERR_TRADE_SETTLE_REPLAY)
})

test('SettlementFailed allowed from MatchCertified', () => {
  const { parent, order } = openOrder()
  const proposed = replayTradeMatchModeA({
    parent,
    order,
    event: matchEvent(order, parent, EVENT_TRADE_MATCH_PROPOSED),
    buyer: BUYER,
  })
  assert.equal(proposed.ok, true)
  if (!proposed.ok) return
  let cur: TradeParent = {
    state: proposed.nextState,
    nonce: proposed.nonce,
    tipStateRoot: proposed.tipStateRoot,
  }
  const certified = replayTradeMatchModeA({
    parent: cur,
    order,
    event: matchEvent(order, cur, EVENT_TRADE_MATCH_CERTIFIED),
    buyer: BUYER,
  })
  assert.equal(certified.ok, true)
  if (!certified.ok) return
  cur = { state: certified.nextState, nonce: certified.nonce, tipStateRoot: certified.tipStateRoot }
  const failed = replayTradeMatchModeA({
    parent: cur,
    order,
    event: matchEvent(order, cur, EVENT_TRADE_SETTLEMENT_FAILED),
    buyer: BUYER,
  })
  assert.equal(failed.ok, true)
  if (failed.ok) assert.equal(failed.nextState, 6)
})
