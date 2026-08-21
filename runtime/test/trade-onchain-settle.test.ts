/**
 * TradeEngine on-chain settle path (hook) — match_certified → settle tx → settled.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
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

async function signOrder(wallet: Wallet, side: typeof ORDER_SIDE_SELL | typeof ORDER_SIDE_BUY) {
  const unsigned = makeUnsignedTradeOrder({
    side,
    chainNftId: '1',
    maker: wallet.address as Hex,
    subjectNftContract: '0x2222222222222222222222222222222222222222',
    subjectNftId: '1',
    quoteAsset: '0x3333333333333333333333333333333333333333',
    price: '1000000',
    amount: '1',
    nonce: String(Date.now()) + String(Math.floor(Math.random() * 1e6)),
    deadline: String(Math.floor(Date.now() / 1000) + 3600),
    feePolicyHash: mockL1FeePolicyHash(),
  })
  const signature = (await wallet.signMessage(orderPersonalSignMessage(unsigned.orderHash))) as Hex
  return { ...unsigned, signature }
}

async function certifyMatch(opts: {
  trade: ReturnType<typeof createTradeEngine>
  seller: Wallet
  buyer: Wallet
  checkers: Wallet[]
}): Promise<string> {
  const { trade, seller, buyer, checkers } = opts
  const sell = await signOrder(seller, ORDER_SIDE_SELL)
  const buy = await signOrder(buyer, ORDER_SIDE_BUY)
  assert.equal((await Promise.resolve(trade.post('/trade/submit', sell)))?.status, 200)
  assert.equal((await Promise.resolve(trade.post('/trade/submit', buy)))?.status, 200)
  const scan = await Promise.resolve(trade.post('/trade/scan', { scanner: checkers[0]!.address }))
  assert.equal(scan?.status, 200)
  const matchRow = (scan!.body as { match: Record<string, unknown> }).match
  const cand = { ...matchRow, candidateHash: matchCandidateHash(matchRow as never) }
  assert.equal((await Promise.resolve(trade.post('/trade/candidate', cand)))?.status, 200)
  const checked = await Promise.resolve(trade.post('/trade/check', { candidateHash: cand.candidateHash }))
  assert.equal(checked?.status, 200)
  const certMatch = (
    checked!.body as {
      match: { certificate: { certificateHash: string; committee: string[] } }
    }
  ).match
  const byAddr = new Map(checkers.map((w) => [w.address.toLowerCase(), w]))
  for (const addr of certMatch.certificate.committee.slice(0, 5)) {
    const w = byAddr.get(addr.toLowerCase())!
    const signature = await w.signMessage(
      certPersonalSignMessage(certMatch.certificate.certificateHash as Hex),
    )
    assert.equal(
      (
        await Promise.resolve(
          trade.post('/trade/attest', {
            candidateHash: cand.candidateHash,
            signer: w.address,
            signature,
          }),
        )
      )?.status,
      200,
    )
  }
  return cand.candidateHash
}

async function listAndApprove(
  trade: ReturnType<typeof createTradeEngine>,
  candidateHash: string,
  seller: Wallet,
  buyer: Wallet,
): Promise<void> {
  assert.equal(
    (
      await Promise.resolve(
        trade.post('/trade/list', {
          candidateHash,
          sellerPrivateKey: seller.privateKey,
        }),
      )
    )?.status,
    200,
  )
  assert.equal(
    (
      await Promise.resolve(
        trade.post('/trade/approve', {
          candidateHash,
          buyerPrivateKey: buyer.privateKey,
        }),
      )
    )?.status,
    200,
  )
}

test('trade settle executeOnChain uses submitL1SettlementTx hook then settles', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dle-trade-onchain-'))
  const store = openArchiveStore(dir)
  const seller = Wallet.createRandom()
  const buyer = Wallet.createRandom()
  const checkers = Array.from({ length: 9 }, () => Wallet.createRandom())
  let settleCalls = 0
  const fakeTx = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Hex
  const fakeListTx = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Hex
  const fakeApproveTx = '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' as Hex

  const trade = createTradeEngine({
    domainId: 'onchain-settle-test',
    store,
    checkerPool: checkers.map((w) => w.address),
    verifyL1Custody: async () => ({ ok: true }),
    submitL1ListTx: async () => ({ ok: true, txHash: fakeListTx }),
    submitL1ApproveTx: async () => ({ ok: true, txHash: fakeApproveTx }),
    submitL1SettlementTx: async () => {
      settleCalls += 1
      return { ok: true, txHash: fakeTx }
    },
  })

  try {
    const candidateHash = await certifyMatch({ trade, seller, buyer, checkers })
    await listAndApprove(trade, candidateHash, seller, buyer)

    const settled = await Promise.resolve(
      trade.post('/trade/settle', {
        candidateHash,
        outcome: 'settled',
        executeOnChain: true,
      }),
    )
    assert.equal(settled?.status, 200)
    assert.equal(settleCalls, 1)
    const body = settled!.body as {
      ok: boolean
      onChain: boolean
      match: { phase: string; settlementTxHash: string }
    }
    assert.equal(body.ok, true)
    assert.equal(body.onChain, true)
    assert.equal(body.match.phase, 'settled')
    assert.equal(body.match.settlementTxHash, fakeTx)
    assert.equal(trade.health().tradeOnChainSettleConfigured, true)
    assert.equal(trade.health().tradeOnChainSettleMode, 'hook')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('trade settle executeOnChain refuses without list/approve (preflight gate)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dle-trade-preflight-'))
  const store = openArchiveStore(dir)
  const seller = Wallet.createRandom()
  const buyer = Wallet.createRandom()
  const checkers = Array.from({ length: 9 }, () => Wallet.createRandom())
  let settleCalls = 0

  const trade = createTradeEngine({
    domainId: 'preflight-gate-test',
    store,
    checkerPool: checkers.map((w) => w.address),
    verifyL1Custody: async () => ({ ok: true }),
    submitL1SettlementTx: async () => {
      settleCalls += 1
      return { ok: true, txHash: ('0x' + 'd'.repeat(64)) as Hex }
    },
  })

  try {
    const candidateHash = await certifyMatch({ trade, seller, buyer, checkers })
    const blocked = await Promise.resolve(
      trade.post('/trade/settle', {
        candidateHash,
        outcome: 'settled',
        executeOnChain: true,
      }),
    )
    assert.equal(blocked?.status, 400)
    assert.equal(settleCalls, 0)
    const body = blocked!.body as { error: string; match: { phase: string }; preflight: boolean }
    assert.match(body.error, /list NFT escrow first/)
    assert.equal(body.preflight, false)
    assert.equal(body.match.phase, 'match_certified')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('trade settle executeOnChain failure marks settlement_failed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dle-trade-onchain-fail-'))
  const store = openArchiveStore(dir)
  const seller = Wallet.createRandom()
  const buyer = Wallet.createRandom()
  const checkers = Array.from({ length: 9 }, () => Wallet.createRandom())
  const fakeListTx = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Hex
  const fakeApproveTx = '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' as Hex

  const trade = createTradeEngine({
    domainId: 'onchain-settle-fail',
    store,
    checkerPool: checkers.map((w) => w.address),
    verifyL1Custody: async () => ({ ok: true }),
    submitL1ListTx: async () => ({ ok: true, txHash: fakeListTx }),
    submitL1ApproveTx: async () => ({ ok: true, txHash: fakeApproveTx }),
    submitL1SettlementTx: async () => ({ ok: false, reason: 'simulated revert' }),
  })

  try {
    const candidateHash = await certifyMatch({ trade, seller, buyer, checkers })
    await listAndApprove(trade, candidateHash, seller, buyer)

    const failed = await Promise.resolve(
      trade.post('/trade/settle', {
        candidateHash,
        outcome: 'settled',
        executeOnChain: true,
      }),
    )
    assert.equal(failed?.status, 400)
    const body = failed!.body as { match: { phase: string; settlementError: string } }
    assert.equal(body.match.phase, 'settlement_failed')
    assert.match(body.match.settlementError, /simulated revert/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('trade list escrow requires seller key matching sell maker', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dle-trade-list-'))
  const store = openArchiveStore(dir)
  const seller = Wallet.createRandom()
  const buyer = Wallet.createRandom()
  const checkers = Array.from({ length: 9 }, () => Wallet.createRandom())
  const fakeListTx = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Hex
  let listCalls = 0

  const trade = createTradeEngine({
    domainId: 'list-escrow-test',
    store,
    checkerPool: checkers.map((w) => w.address),
    verifyL1Custody: async () => ({ ok: true }),
    submitL1ListTx: async () => {
      listCalls += 1
      return { ok: true, txHash: fakeListTx }
    },
  })

  try {
    const sell = await signOrder(seller, ORDER_SIDE_SELL)
    const buy = await signOrder(buyer, ORDER_SIDE_BUY)
    await Promise.resolve(trade.post('/trade/submit', sell))
    await Promise.resolve(trade.post('/trade/submit', buy))
    const scan = await Promise.resolve(trade.post('/trade/scan', { scanner: checkers[0]!.address }))
    const matchRow = (scan!.body as { match: Record<string, unknown> }).match
    const cand = { ...matchRow, candidateHash: matchCandidateHash(matchRow as never) }
    await Promise.resolve(trade.post('/trade/candidate', cand))

    const wrong = await Promise.resolve(
      trade.post('/trade/list', {
        candidateHash: cand.candidateHash,
        sellerPrivateKey: buyer.privateKey,
      }),
    )
    assert.equal(wrong?.status, 400)
    assert.match(String((wrong!.body as { error?: string }).error), /does not match/)

    const listed = await Promise.resolve(
      trade.post('/trade/list', {
        candidateHash: cand.candidateHash,
        sellerPrivateKey: seller.privateKey,
      }),
    )
    assert.equal(listed?.status, 200)
    assert.equal(listCalls, 1)
    const body = listed!.body as { ok: boolean; listTxHash: string; match: { listTxHash: string } }
    assert.equal(body.ok, true)
    assert.equal(body.listTxHash, fakeListTx)
    assert.equal(body.match.listTxHash, fakeListTx)
    assert.equal(trade.health().tradeListConfigured, true)
    assert.equal(trade.health().tradeListMode, 'hook')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('trade approve quote requires buyer key matching buy maker', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dle-trade-approve-'))
  const store = openArchiveStore(dir)
  const seller = Wallet.createRandom()
  const buyer = Wallet.createRandom()
  const checkers = Array.from({ length: 9 }, () => Wallet.createRandom())
  const fakeApproveTx = '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' as Hex
  let approveCalls = 0

  const trade = createTradeEngine({
    domainId: 'approve-quote-test',
    store,
    checkerPool: checkers.map((w) => w.address),
    verifyL1Custody: async () => ({ ok: true }),
    submitL1ApproveTx: async (args) => {
      approveCalls += 1
      assert.equal(args.buyer.toLowerCase(), buyer.address.toLowerCase())
      assert.equal(args.amount, '1000000')
      return { ok: true, txHash: fakeApproveTx }
    },
  })

  try {
    const sell = await signOrder(seller, ORDER_SIDE_SELL)
    const buy = await signOrder(buyer, ORDER_SIDE_BUY)
    await Promise.resolve(trade.post('/trade/submit', sell))
    await Promise.resolve(trade.post('/trade/submit', buy))
    const scan = await Promise.resolve(trade.post('/trade/scan', { scanner: checkers[0]!.address }))
    const matchRow = (scan!.body as { match: Record<string, unknown> }).match
    const cand = { ...matchRow, candidateHash: matchCandidateHash(matchRow as never) }
    await Promise.resolve(trade.post('/trade/candidate', cand))

    const wrong = await Promise.resolve(
      trade.post('/trade/approve', {
        candidateHash: cand.candidateHash,
        buyerPrivateKey: seller.privateKey,
      }),
    )
    assert.equal(wrong?.status, 400)
    assert.match(String((wrong!.body as { error?: string }).error), /does not match/)

    const approved = await Promise.resolve(
      trade.post('/trade/approve', {
        candidateHash: cand.candidateHash,
        buyerPrivateKey: buyer.privateKey,
      }),
    )
    assert.equal(approved?.status, 200)
    assert.equal(approveCalls, 1)
    const body = approved!.body as {
      ok: boolean
      approveTxHash: string
      match: { approveTxHash: string }
    }
    assert.equal(body.ok, true)
    assert.equal(body.approveTxHash, fakeApproveTx)
    assert.equal(body.match.approveTxHash, fakeApproveTx)
    assert.equal(trade.health().tradeApproveConfigured, true)
    assert.equal(trade.health().tradeApproveMode, 'hook')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('trade preflight is read-only and returns fees after list+approve', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dle-trade-preflight-api-'))
  const store = openArchiveStore(dir)
  const seller = Wallet.createRandom()
  const buyer = Wallet.createRandom()
  const checkers = Array.from({ length: 9 }, () => Wallet.createRandom())
  const fakeListTx = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Hex
  const fakeApproveTx = '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' as Hex

  const trade = createTradeEngine({
    domainId: 'preflight-api-test',
    store,
    checkerPool: checkers.map((w) => w.address),
    verifyL1Custody: async () => ({ ok: true }),
    submitL1ListTx: async () => ({ ok: true, txHash: fakeListTx }),
    submitL1ApproveTx: async () => ({ ok: true, txHash: fakeApproveTx }),
  })

  try {
    const candidateHash = await certifyMatch({ trade, seller, buyer, checkers })

    const missing = await Promise.resolve(trade.post('/trade/preflight', { candidateHash }))
    assert.equal(missing?.status, 400)
    const missingBody = missing!.body as {
      ok: boolean
      preflight: boolean
      error: string
      checks: { hasListTx: boolean; hasApproveTx: boolean }
      fees: { feeAmount: string; feeBps: number }
      match: { phase: string }
    }
    assert.equal(missingBody.ok, false)
    assert.equal(missingBody.preflight, false)
    assert.match(missingBody.error, /list NFT escrow first/)
    assert.equal(missingBody.checks.hasListTx, false)
    assert.equal(missingBody.match.phase, 'match_certified')
    assert.equal(missingBody.fees.feeBps, 1)
    assert.ok(BigInt(missingBody.fees.feeAmount) > 0n)

    await listAndApprove(trade, candidateHash, seller, buyer)

    const ready = await Promise.resolve(trade.post('/trade/preflight', { candidateHash }))
    assert.equal(ready?.status, 200)
    const readyBody = ready!.body as {
      ok: boolean
      preflight: boolean
      checks: { hasListTx: boolean; hasApproveTx: boolean; rpcConfigured: boolean }
      fees: { feeAmount: string; scannerReward: string; committeeReward: string }
      match: { phase: string; listTxHash: string; approveTxHash: string }
    }
    assert.equal(readyBody.ok, true)
    assert.equal(readyBody.preflight, true)
    assert.equal(readyBody.checks.hasListTx, true)
    assert.equal(readyBody.checks.hasApproveTx, true)
    assert.equal(readyBody.checks.rpcConfigured, false)
    assert.equal(readyBody.match.phase, 'match_certified')
    assert.equal(readyBody.match.listTxHash, fakeListTx)
    assert.equal(readyBody.match.approveTxHash, fakeApproveTx)
    assert.equal(
      BigInt(readyBody.fees.feeAmount),
      BigInt(readyBody.fees.scannerReward) + BigInt(readyBody.fees.committeeReward),
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
