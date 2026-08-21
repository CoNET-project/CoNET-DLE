import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Wallet } from 'ethers'
import { openArchiveStore } from '../src/archive/store.js'
import { createTradeEngine } from '../src/archive/trade/engine.js'
import { mockL1FeePolicyHash } from '../src/shared/mockL1.js'
import {
  ORDER_SIDE_BUY,
  ORDER_SIDE_SELL,
  certPersonalSignMessage,
  makeUnsignedTradeOrder,
  matchCandidateHash,
  orderPersonalSignMessage,
} from '../src/shared/tradeMatch.js'
import type { Hex } from '../src/shared/bytes.js'

const NFT = '0x2222222222222222222222222222222222222222' as Hex
const QUOTE = '0x3333333333333333333333333333333333333333' as Hex

async function signOrder(wallet: Wallet, side: typeof ORDER_SIDE_SELL | typeof ORDER_SIDE_BUY, price: string) {
  const unsigned = makeUnsignedTradeOrder({
    side,
    chainNftId: '7',
    maker: wallet.address as Hex,
    subjectNftContract: NFT,
    subjectNftId: '1',
    quoteAsset: QUOTE,
    price,
    amount: '1',
    nonce: String(Date.now() * 1000 + Math.floor(Math.random() * 1000)),
    deadline: String(Math.floor(Date.now() / 1000) + 3600),
    feePolicyHash: mockL1FeePolicyHash(),
  })
  const signature = (await wallet.signMessage(orderPersonalSignMessage(unsigned.orderHash))) as Hex
  return { ...unsigned, signature }
}

test('archive check uses verifyL1Custody hook and rejects failed custody', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dle-trade-custody-'))
  const store = openArchiveStore(dir)
  const seller = Wallet.createRandom()
  const buyer = Wallet.createRandom()
  const checkers = Array.from({ length: 9 }, () => Wallet.createRandom())
  let custodyCalls = 0
  const trade = createTradeEngine({
    domainId: 'lab',
    store,
    checkerPool: checkers.map((w) => w.address),
    verifyL1Custody: async () => {
      custodyCalls += 1
      return { ok: false, reason: 'L1 escrow custody not confirmed (hook)' }
    },
  })

  const sell = await signOrder(seller, ORDER_SIDE_SELL, '1000000')
  const buy = await signOrder(buyer, ORDER_SIDE_BUY, '1000000')
  assert.equal((await Promise.resolve(trade.post('/trade/submit', sell)))?.status, 200)
  assert.equal((await Promise.resolve(trade.post('/trade/submit', buy)))?.status, 200)
  const scan = await Promise.resolve(trade.post('/trade/scan', { scanner: checkers[0]!.address }))
  assert.equal(scan?.status, 200)
  const candidateBody = (scan!.body as { match?: Record<string, unknown> }).match
  assert.ok(candidateBody)
  const cand = {
    ...candidateBody,
    candidateHash: matchCandidateHash(candidateBody as never),
  }
  assert.equal((await Promise.resolve(trade.post('/trade/candidate', cand)))?.status, 200)

  const rejected = await Promise.resolve(
    trade.post('/trade/check', {
      candidateHash: cand.candidateHash,
      // Client flags must be ignored when hook/RPC is configured.
      l1EscrowCustody: true,
      buyerBalanceOk: true,
      buyerAllowanceOk: true,
    }),
  )
  assert.equal(rejected?.status, 400)
  assert.equal(custodyCalls, 1)
  assert.match(String((rejected!.body as { error?: string }).error), /custody/i)
})

test('archive check accepts hook ok then certifies with committee attest', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dle-trade-custody-ok-'))
  const store = openArchiveStore(dir)
  const seller = Wallet.createRandom()
  const buyer = Wallet.createRandom()
  const checkers = Array.from({ length: 9 }, () => Wallet.createRandom())
  const trade = createTradeEngine({
    domainId: 'lab',
    store,
    checkerPool: checkers.map((w) => w.address),
    verifyL1Custody: async () => ({ ok: true }),
  })

  const sell = await signOrder(seller, ORDER_SIDE_SELL, '1000000')
  const buy = await signOrder(buyer, ORDER_SIDE_BUY, '1100000')
  await Promise.resolve(trade.post('/trade/submit', sell))
  await Promise.resolve(trade.post('/trade/submit', buy))
  const scan = await Promise.resolve(trade.post('/trade/scan', { scanner: checkers[0]!.address }))
  const candidateBody = (scan!.body as { match?: Record<string, unknown> }).match!
  const cand = {
    ...candidateBody,
    candidateHash: matchCandidateHash(candidateBody as never),
  }
  await Promise.resolve(trade.post('/trade/candidate', cand))
  const checked = await Promise.resolve(trade.post('/trade/check', { candidateHash: cand.candidateHash }))
  assert.equal(checked?.status, 200)
  const match = (checked!.body as { match: { phase: string; certificate: { certificateHash: string; committee: string[] } } })
    .match
  assert.equal(match.phase, 'match_proposed')

  const byAddr = new Map(checkers.map((w) => [w.address.toLowerCase(), w]))
  for (const addr of match.certificate.committee.slice(0, 5)) {
    const w = byAddr.get(addr.toLowerCase())
    assert.ok(w)
    const signature = await w!.signMessage(certPersonalSignMessage(match.certificate.certificateHash as Hex))
    const att = await Promise.resolve(
      trade.post('/trade/attest', {
        candidateHash: cand.candidateHash,
        signer: w!.address,
        signature,
      }),
    )
    assert.equal(att?.status, 200)
  }
  const health = trade.health()
  assert.equal(health.tradeRpcCustodyConfigured, true)
  assert.equal(health.tradeRpcCustodyMode, 'hook')
  const timeline = trade.get('/trade/timeline') as { matches: Array<{ phase: string }> }
  assert.equal(timeline.matches[0]?.phase, 'match_certified')
})
