#!/usr/bin/env node
/**
 * One-shot mock-L1 auction demo (in-process TradeEngine).
 * Default: custody via Archive hook (no Anvil required).
 * With MOCK_L1_RPC_URL + MOCK_L1_SETTLEMENT: Archive uses eth_call custody
 * (requires NFT approved/held + buyer ERC-20 allowance on that RPC).
 * When list/approve are configured, demo also POSTs /trade/list + /trade/approve.
 * mockL1Only — not CoNET mainnet / not production DePIN.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Wallet } from 'ethers'
import { openArchiveStore } from '../archive/store.js'
import { createTradeEngine } from '../archive/trade/engine.js'
import { mockL1FeePolicyHash } from '../shared/mockL1.js'
import { mockL1CustodyEnv } from '../shared/mockL1Custody.js'
import {
  ORDER_SIDE_BUY,
  ORDER_SIDE_SELL,
  certPersonalSignMessage,
  makeUnsignedTradeOrder,
  matchCandidateHash,
  orderPersonalSignMessage,
} from '../shared/tradeMatch.js'
import type { Hex } from '../shared/bytes.js'

const NFT = (process.env.MOCK_L1_SUBJECT_NFT ??
  '0x2222222222222222222222222222222222222222') as Hex
const QUOTE = (process.env.MOCK_L1_QUOTE ??
  '0x3333333333333333333333333333333333333333') as Hex
const PRICE = process.env.MOCK_L1_PRICE ?? '1000000'
const SUBJECT_ID = process.env.MOCK_L1_SUBJECT_ID ?? '1'

async function signOrder(wallet: Wallet, side: typeof ORDER_SIDE_SELL | typeof ORDER_SIDE_BUY, price: string) {
  const unsigned = makeUnsignedTradeOrder({
    side,
    chainNftId: process.env.MOCK_L1_CHAIN_NFT_ID ?? '1',
    maker: wallet.address as Hex,
    subjectNftContract: NFT,
    subjectNftId: SUBJECT_ID,
    quoteAsset: QUOTE,
    price,
    amount: '1',
    nonce: String(Date.now()),
    deadline: String(Math.floor(Date.now() / 1000) + 3600),
    feePolicyHash: mockL1FeePolicyHash(),
  })
  const signature = (await wallet.signMessage(orderPersonalSignMessage(unsigned.orderHash))) as Hex
  return { ...unsigned, signature }
}

async function main(): Promise<void> {
  const env = mockL1CustodyEnv()
  const useRpc = Boolean(env.rpcUrl && env.settlement)
  const dir = mkdtempSync(join(tmpdir(), 'dle-mock-auction-demo-'))
  const store = openArchiveStore(dir)
  const seller = Wallet.createRandom()
  const buyer = Wallet.createRandom()
  const checkers = Array.from({ length: 9 }, () => Wallet.createRandom())

  const trade = createTradeEngine({
    domainId: 'mock-auction-demo',
    store,
    checkerPool: checkers.map((w) => w.address),
    l1RpcUrl: env.rpcUrl,
    l1SettlementAddress: env.settlement,
    ...(useRpc
      ? {}
      : {
          verifyL1Custody: async () => ({ ok: true as const }),
        }),
  })

  console.log(
    JSON.stringify(
      {
        mockL1Only: true,
        custodyMode: useRpc ? 'eth_call' : 'inprocess_hook',
        rpcUrl: env.rpcUrl ?? null,
        settlement: env.settlement ?? null,
        seller: seller.address,
        buyer: buyer.address,
      },
      null,
      2,
    ),
  )

  try {
    const sell = await signOrder(seller, ORDER_SIDE_SELL, PRICE)
    const buy = await signOrder(buyer, ORDER_SIDE_BUY, PRICE)
    for (const step of [
      await Promise.resolve(trade.post('/trade/submit', sell)),
      await Promise.resolve(trade.post('/trade/submit', buy)),
    ]) {
      if (step?.status !== 200) throw new Error(`submit failed: ${JSON.stringify(step)}`)
    }

    const scan = await Promise.resolve(
      trade.post('/trade/scan', { scanner: checkers[0]!.address }),
    )
    if (scan?.status !== 200) throw new Error(`scan failed: ${JSON.stringify(scan)}`)
    const candidateBody = (scan.body as { match?: Record<string, unknown> }).match
    if (candidateBody === undefined) throw new Error('scan returned no candidate')
    const cand = {
      ...candidateBody,
      candidateHash: matchCandidateHash(candidateBody as never),
    }
    const candRes = await Promise.resolve(trade.post('/trade/candidate', cand))
    if (candRes?.status !== 200) throw new Error(`candidate failed: ${JSON.stringify(candRes)}`)

    const checked = await Promise.resolve(
      trade.post('/trade/check', { candidateHash: cand.candidateHash }),
    )
    if (checked?.status !== 200) {
      throw new Error(
        `check failed (set MOCK_L1_RPC_URL + MOCK_L1_SETTLEMENT with listed NFT / allowance, or omit for hook demo): ${JSON.stringify(checked)}`,
      )
    }
    const match = (
      checked.body as {
        match: {
          phase: string
          certificate: { certificateHash: string; committee: string[] }
        }
      }
    ).match
    const phaseAfterCheck = match.phase

    const byAddr = new Map(checkers.map((w) => [w.address.toLowerCase(), w]))
    for (const addr of match.certificate.committee.slice(0, 5)) {
      const w = byAddr.get(addr.toLowerCase())
      if (w === undefined) throw new Error(`committee wallet missing ${addr}`)
      const signature = await w.signMessage(
        certPersonalSignMessage(match.certificate.certificateHash as Hex),
      )
      const att = await Promise.resolve(
        trade.post('/trade/attest', {
          candidateHash: cand.candidateHash,
          signer: w.address,
          signature,
        }),
      )
      if (att?.status !== 200) throw new Error(`attest failed: ${JSON.stringify(att)}`)
    }

    let listTxHash: string | undefined
    let approveTxHash: string | undefined
    const healthBeforeSettle = trade.health() as {
      tradeListConfigured?: boolean
      tradeApproveConfigured?: boolean
    }

    // Round 5/6: when Archive list/approve are configured (RPC or hook), use Archive routes.
    if (healthBeforeSettle.tradeListConfigured) {
      const listed = await Promise.resolve(
        trade.post('/trade/list', {
          candidateHash: cand.candidateHash,
          sellerPrivateKey: seller.privateKey,
        }),
      )
      if (listed?.status !== 200) {
        throw new Error(
          `list failed (need seller NFT approved + MOCK_L1_* or list hook): ${JSON.stringify(listed)}`,
        )
      }
      listTxHash = (listed.body as { listTxHash?: string }).listTxHash
    }
    if (healthBeforeSettle.tradeApproveConfigured) {
      const approved = await Promise.resolve(
        trade.post('/trade/approve', {
          candidateHash: cand.candidateHash,
          buyerPrivateKey: buyer.privateKey,
        }),
      )
      if (approved?.status !== 200) {
        throw new Error(
          `approve failed (need buyer allowance path or approve hook): ${JSON.stringify(approved)}`,
        )
      }
      approveTxHash = (approved.body as { approveTxHash?: string }).approveTxHash
    }

    const submitted = await Promise.resolve(
      trade.post('/trade/settle', {
        candidateHash: cand.candidateHash,
        outcome: 'submitted',
        txHash: '0xdemodemo000000000000000000000000000000000000000000000000000001',
      }),
    )
    const settled = await Promise.resolve(
      trade.post('/trade/settle', {
        candidateHash: cand.candidateHash,
        outcome: 'settled',
        txHash: '0xdemodemo000000000000000000000000000000000000000000000000000002',
      }),
    )

    console.log(
      JSON.stringify(
        {
          ok: true,
          mockL1Only: true,
          health: trade.health(),
          listTxHash: listTxHash ?? null,
          approveTxHash: approveTxHash ?? null,
          phases: {
            afterCheck: phaseAfterCheck,
            afterSubmit: (submitted?.body as { match?: { phase: string } })?.match?.phase,
            afterSettled: (settled?.body as { match?: { phase: string } })?.match?.phase,
          },
          candidateHash: cand.candidateHash,
          note: useRpc
            ? 'Archive eth_call custody + /trade/list + /trade/approve when configured; demo settle uses lab txHash unless executeOnChain/authority is set.'
            : 'In-process hook custody; wire Anvil via MOCK_L1_* for real eth_call / list / approve.',
        },
        null,
        2,
      ),
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
