#!/usr/bin/env node
/**
 * Mock-L1 auction E2E against a live local RPC (Anvil / hardhat node).
 *
 * Requires env from `npm run dle:deploy:mock-auction-local` (or Anvil deploy):
 *   MOCK_L1_RPC_URL, MOCK_L1_SETTLEMENT, MOCK_L1_SUBJECT_NFT, MOCK_L1_QUOTE,
 *   MOCK_L1_SUBJECT_ID, MOCK_L1_AUTHORITY_PRIVATE_KEY, MOCK_L1_SELLER_PRIVATE_KEY,
 *   MOCK_L1_BUYER_PRIVATE_KEY
 *
 * Flow: seller list() → TradeEngine match/cert → Archive settle() on-chain.
 * mockL1Only — refuses chainId 224422.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonRpcProvider, Wallet } from 'ethers'
import { openArchiveStore } from '../archive/store.js'
import { createTradeEngine } from '../archive/trade/engine.js'
import { mockL1FeePolicyHash } from '../shared/mockL1.js'
import { mockL1CustodyEnv } from '../shared/mockL1Custody.js'
import { listMockL1Auction, mockL1SettleEnv } from '../shared/mockL1Settle.js'
import {
  ORDER_SIDE_BUY,
  ORDER_SIDE_SELL,
  certPersonalSignMessage,
  makeUnsignedTradeOrder,
  matchCandidateHash,
  orderPersonalSignMessage,
} from '../shared/tradeMatch.js'
import type { Hex } from '../shared/bytes.js'

function requireEnv(name: string): string {
  const v = process.env[name]?.trim()
  if (!v) throw new Error(`missing ${name}`)
  return v
}

async function main(): Promise<void> {
  const settleEnv = mockL1SettleEnv()
  const custodyEnv = mockL1CustodyEnv()
  const rpcUrl = settleEnv.rpcUrl ?? custodyEnv.rpcUrl ?? requireEnv('MOCK_L1_RPC_URL')
  const settlement = (settleEnv.settlement ?? custodyEnv.settlement ?? requireEnv('MOCK_L1_SETTLEMENT')) as Hex
  const subjectNft = requireEnv('MOCK_L1_SUBJECT_NFT') as Hex
  const quote = requireEnv('MOCK_L1_QUOTE') as Hex
  const subjectId = requireEnv('MOCK_L1_SUBJECT_ID')
  const authorityPk = settleEnv.authorityPrivateKey ?? requireEnv('MOCK_L1_AUTHORITY_PRIVATE_KEY')
  const sellerPk = requireEnv('MOCK_L1_SELLER_PRIVATE_KEY')
  const buyerPk = requireEnv('MOCK_L1_BUYER_PRIVATE_KEY')
  const price = process.env.MOCK_L1_PRICE ?? '1000000'
  const chainNftId = process.env.MOCK_L1_CHAIN_NFT_ID ?? '1'

  const provider = new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true })
  try {
    const net = await provider.getNetwork()
    if (Number(net.chainId) === 224422) {
      throw new Error('refusing CoNET mainnet (224422) — mock-L1 E2E is local-only')
    }
  } finally {
    provider.destroy()
  }

  const seller = new Wallet(sellerPk)
  const buyer = new Wallet(buyerPk)
  const checkers = Array.from({ length: 9 }, () => Wallet.createRandom())
  const dir = mkdtempSync(join(tmpdir(), 'dle-mock-auction-e2e-'))
  const store = openArchiveStore(dir)

  const trade = createTradeEngine({
    domainId: 'mock-auction-e2e',
    store,
    checkerPool: checkers.map((w) => w.address),
    certificateAuthorityHint: new Wallet(authorityPk).address as Hex,
    l1RpcUrl: rpcUrl,
    l1SettlementAddress: settlement,
    l1AuthorityPrivateKey: authorityPk,
  })

  try {
    const deadline = String(Math.floor(Date.now() / 1000) + 3600)
    const sellUnsigned = makeUnsignedTradeOrder({
      side: ORDER_SIDE_SELL,
      chainNftId,
      maker: seller.address as Hex,
      subjectNftContract: subjectNft,
      subjectNftId: subjectId,
      quoteAsset: quote,
      price,
      amount: '1',
      nonce: String(Date.now()),
      deadline,
      feePolicyHash: mockL1FeePolicyHash(),
    })
    const sell = {
      ...sellUnsigned,
      signature: (await seller.signMessage(orderPersonalSignMessage(sellUnsigned.orderHash))) as Hex,
    }
    const buyUnsigned = makeUnsignedTradeOrder({
      side: ORDER_SIDE_BUY,
      chainNftId,
      maker: buyer.address as Hex,
      subjectNftContract: subjectNft,
      subjectNftId: subjectId,
      quoteAsset: quote,
      price,
      amount: '1',
      nonce: String(Date.now() + 1),
      deadline,
      feePolicyHash: mockL1FeePolicyHash(),
    })
    const buy = {
      ...buyUnsigned,
      signature: (await buyer.signMessage(orderPersonalSignMessage(buyUnsigned.orderHash))) as Hex,
    }

    const listed = await listMockL1Auction({
      rpcUrl,
      settlement,
      sellerPrivateKey: sellerPk,
      sellerOrderHash: sell.orderHash,
      subjectNft,
      subjectNftId: subjectId,
      quoteAsset: quote,
      askAmount: price,
      deadline,
    })
    if (!listed.ok) throw new Error(`list failed: ${listed.reason}`)

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
    if (checked?.status !== 200) throw new Error(`check failed: ${JSON.stringify(checked)}`)
    const match = (
      checked.body as {
        match: {
          phase: string
          certificate: { certificateHash: string; committee: string[] }
        }
      }
    ).match

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

    const settled = await Promise.resolve(
      trade.post('/trade/settle', {
        candidateHash: cand.candidateHash,
        outcome: 'settled',
        executeOnChain: true,
      }),
    )
    if (settled?.status !== 200) throw new Error(`on-chain settle failed: ${JSON.stringify(settled)}`)

    console.log(
      JSON.stringify(
        {
          ok: true,
          mockL1Only: true,
          onChain: true,
          listTxHash: listed.txHash,
          settlementTxHash: (settled.body as { match?: { settlementTxHash?: string } })?.match
            ?.settlementTxHash,
          phase: (settled.body as { match?: { phase?: string } })?.match?.phase,
          health: trade.health(),
          candidateHash: cand.candidateHash,
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
