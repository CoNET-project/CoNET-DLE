import test from 'node:test'
import assert from 'node:assert/strict'
import { mockL1FeePolicyHash, computeFeeSplit } from '../src/shared/mockL1.js'
import {
  ORDER_SIDE_BUY,
  ORDER_SIDE_SELL,
  buildFeeAmounts,
  findBestMatch,
  makeUnsignedTradeOrder,
  ordersPriceMatch,
  parseTradeOrder,
  type MockL1TradeOrderV1,
} from '../src/shared/tradeMatch.js'
import type { Hex } from '../src/shared/bytes.js'

const NFT = '0x2222222222222222222222222222222222222222' as Hex
const QUOTE = '0x3333333333333333333333333333333333333333' as Hex
const MAKER_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Hex
const MAKER_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Hex

function order(partial: {
  side: 'sell' | 'buy'
  price: string
  maker?: Hex
  createdAt?: string
  cancelled?: boolean
  deadline?: string
}): MockL1TradeOrderV1 {
  const unsigned = makeUnsignedTradeOrder({
    side: partial.side === 'sell' ? ORDER_SIDE_SELL : ORDER_SIDE_BUY,
    chainNftId: '7',
    maker: partial.maker ?? (partial.side === 'sell' ? MAKER_A : MAKER_B),
    subjectNftContract: NFT,
    subjectNftId: '1',
    quoteAsset: QUOTE,
    price: partial.price,
    amount: '1',
    nonce: '1',
    deadline: partial.deadline ?? String(Math.floor(Date.now() / 1000) + 3600),
  })
  return {
    ...unsigned,
    signature: '0x00' as Hex,
    createdAt: partial.createdAt ?? unsigned.createdAt,
    cancelled: partial.cancelled,
  }
}

test('ordersPriceMatch requires bid >= ask and same subject/quote', () => {
  const now = BigInt(Math.floor(Date.now() / 1000))
  const sell = order({ side: 'sell', price: '1000' })
  const buyOk = order({ side: 'buy', price: '1000' })
  const buyLow = order({ side: 'buy', price: '999' })
  assert.equal(ordersPriceMatch(sell, buyOk, now), true)
  assert.equal(ordersPriceMatch(sell, buyLow, now), false)
})

test('ordersPriceMatch rejects expired or cancelled', () => {
  const now = 2_000_000_000n
  const sell = order({ side: 'sell', price: '1000', deadline: '100' })
  const buy = order({ side: 'buy', price: '1000' })
  assert.equal(ordersPriceMatch(sell, buy, now), false)
  const sellLive = order({ side: 'sell', price: '1000' })
  const buyCancelled = order({ side: 'buy', price: '1000', cancelled: true })
  assert.equal(ordersPriceMatch(sellLive, buyCancelled, BigInt(Math.floor(Date.now() / 1000))), false)
})

test('findBestMatch tie-breaks by earliest createdAt then orderHash', () => {
  const now = BigInt(Math.floor(Date.now() / 1000))
  const sellEarly = order({
    side: 'sell',
    price: '1000',
    createdAt: '2026-01-01T00:00:00.000Z',
  })
  const sellLate = order({
    side: 'sell',
    price: '1000',
    maker: '0xcccccccccccccccccccccccccccccccccccccccc' as Hex,
    createdAt: '2026-01-02T00:00:00.000Z',
  })
  const buy = order({
    side: 'buy',
    price: '1100',
    createdAt: '2026-01-01T00:00:01.000Z',
  })
  const best = findBestMatch([sellLate, sellEarly, buy], now)
  assert.ok(best)
  assert.equal(best!.sell.orderHash, sellEarly.orderHash)
  assert.equal(best!.clearingPrice, '1000')
})

test('1 bps fee splits 50/50 scanner/committee', () => {
  const split = computeFeeSplit(1_000_000n)
  assert.equal(split.feeAmount, 100n)
  assert.equal(split.scannerReward, 50n)
  assert.equal(split.committeeReward, 50n)
  const amounts = buildFeeAmounts('1000000')
  assert.equal(amounts.feeAmount, '100')
  assert.equal(amounts.scannerReward, '50')
  assert.equal(amounts.committeeReward, '50')
})

test('parseTradeOrder rejects wrong fee policy and lab-style schemas', () => {
  const unsigned = makeUnsignedTradeOrder({
    side: ORDER_SIDE_SELL,
    chainNftId: '1',
    maker: MAKER_A,
    subjectNftContract: NFT,
    subjectNftId: '1',
    quoteAsset: QUOTE,
    price: '100',
    amount: '1',
    nonce: '1',
    deadline: '9999999999',
  })
  const badFee = parseTradeOrder({
    ...unsigned,
    signature: '0xab',
    feePolicyHash: '0x' + '11'.repeat(32),
  })
  assert.equal(badFee.ok, false)
  const lab = parseTradeOrder({ schema: 'DleLabNewChainRequestV1', mockL1Only: true })
  assert.equal(lab.ok, false)
  const ok = parseTradeOrder({
    ...unsigned,
    signature: '0xab',
    feePolicyHash: mockL1FeePolicyHash(),
  })
  assert.equal(ok.ok, true)
})
