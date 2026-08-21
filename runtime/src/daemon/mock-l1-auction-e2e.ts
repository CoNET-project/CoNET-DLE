#!/usr/bin/env node
/**
 * Mock-L1 auction E2E against a live local RPC (Anvil / hardhat node).
 *
 * Requires env from `npm run dle:deploy:mock-auction-local` (or Anvil deploy):
 *   MOCK_L1_RPC_URL, MOCK_L1_SETTLEMENT, MOCK_L1_SUBJECT_NFT, MOCK_L1_QUOTE,
 *   MOCK_L1_SUBJECT_ID, MOCK_L1_AUTHORITY_PRIVATE_KEY, MOCK_L1_SELLER_PRIVATE_KEY,
 *   MOCK_L1_BUYER_PRIVATE_KEY
 *
 * Modes (`MOCK_L1_E2E_MODE`):
 *   settle (default) — attest → list → approve → settle() on-chain
 *   recovery — attest → list → settle outcome=failed → unlist → NFT back to seller
 *
 * One-shot `dle:mock-auction-e2e` runs recovery then settle on the same deploy.
 * mockL1Only — refuses chainId 224422.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Contract, JsonRpcProvider, Wallet } from 'ethers'
import { openArchiveStore } from '../archive/store.js'
import { createTradeEngine } from '../archive/trade/engine.js'
import { mockL1FeePolicyHash } from '../shared/mockL1.js'
import { mockL1CustodyEnv } from '../shared/mockL1Custody.js'
import { mockL1SettleEnv } from '../shared/mockL1Settle.js'
import {
  ORDER_SIDE_BUY,
  ORDER_SIDE_SELL,
  certPersonalSignMessage,
  makeUnsignedTradeOrder,
  matchCandidateHash,
  orderPersonalSignMessage,
} from '../shared/tradeMatch.js'
import type { Hex } from '../shared/bytes.js'

const ERC721_OWNER_ABI = ['function ownerOf(uint256 tokenId) view returns (address)'] as const

function requireEnv(name: string): string {
  const v = process.env[name]?.trim()
  if (!v) throw new Error(`missing ${name}`)
  return v
}

type E2eMode = 'settle' | 'recovery'

function resolveMode(): E2eMode {
  const raw = (process.env.MOCK_L1_E2E_MODE ?? 'settle').trim().toLowerCase()
  if (raw === 'recovery' || raw === 'unlist' || raw === 'fail-unlist') return 'recovery'
  return 'settle'
}

async function ownerOfNft(rpcUrl: string, nft: Hex, tokenId: string): Promise<string> {
  const provider = new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true })
  try {
    const c = new Contract(nft, ERC721_OWNER_ABI, provider)
    return String(await c.ownerOf(BigInt(tokenId)))
  } finally {
    provider.destroy()
  }
}

async function main(): Promise<void> {
  const mode = resolveMode()
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
  const dir = mkdtempSync(join(tmpdir(), `dle-mock-auction-e2e-${mode}-`))
  const store = openArchiveStore(dir)

  const trade = createTradeEngine({
    domainId: `mock-auction-e2e-${mode}`,
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

    const listed = await Promise.resolve(
      trade.post('/trade/list', {
        candidateHash: cand.candidateHash,
        sellerPrivateKey: sellerPk,
      }),
    )
    if (listed?.status !== 200) throw new Error(`Archive list failed: ${JSON.stringify(listed)}`)
    const listTxHash =
      (listed.body as { listTxHash?: string }).listTxHash ??
      (listed.body as { match?: { listTxHash?: string } }).match?.listTxHash

    if (mode === 'recovery') {
      const failed = await Promise.resolve(
        trade.post('/trade/settle', {
          candidateHash: cand.candidateHash,
          outcome: 'failed',
          executeOnChain: false,
        }),
      )
      if (failed?.status !== 200) {
        throw new Error(`mark settlement_failed failed: ${JSON.stringify(failed)}`)
      }
      const phaseAfterFail = (failed.body as { match?: { phase?: string } }).match?.phase
      if (phaseAfterFail !== 'settlement_failed') {
        throw new Error(`expected settlement_failed, got ${phaseAfterFail}`)
      }

      const unlisted = await Promise.resolve(
        trade.post('/trade/unlist', {
          candidateHash: cand.candidateHash,
          sellerPrivateKey: sellerPk,
        }),
      )
      if (unlisted?.status !== 200) {
        throw new Error(`Archive unlist failed: ${JSON.stringify(unlisted)}`)
      }
      const unlistBody = unlisted.body as {
        unlistTxHash?: string
        match?: { unlistTxHash?: string; listTxHash?: string | null; phase?: string }
      }
      const unlistTxHash = unlistBody.unlistTxHash ?? unlistBody.match?.unlistTxHash
      if (!unlistTxHash) throw new Error('unlist succeeded but missing unlistTxHash')
      if (unlistBody.match?.listTxHash) {
        throw new Error('listTxHash should be cleared after unlist')
      }

      const owner = await ownerOfNft(rpcUrl, subjectNft, subjectId)
      if (owner.toLowerCase() !== seller.address.toLowerCase()) {
        throw new Error(
          `after unlist expected seller ${seller.address} to own NFT, got ${owner}`,
        )
      }

      console.log(
        JSON.stringify(
          {
            ok: true,
            mockL1Only: true,
            mode: 'recovery',
            onChain: true,
            listTxHash,
            unlistTxHash,
            phase: unlistBody.match?.phase ?? phaseAfterFail,
            nftOwner: owner,
            health: trade.health(),
            candidateHash: cand.candidateHash,
          },
          null,
          2,
        ),
      )
      return
    }

    // settle mode (default)
    const approved = await Promise.resolve(
      trade.post('/trade/approve', {
        candidateHash: cand.candidateHash,
        buyerPrivateKey: buyerPk,
      }),
    )
    if (approved?.status !== 200) throw new Error(`Archive approve failed: ${JSON.stringify(approved)}`)

    const settled = await Promise.resolve(
      trade.post('/trade/settle', {
        candidateHash: cand.candidateHash,
        outcome: 'settled',
        executeOnChain: true,
      }),
    )
    if (settled?.status !== 200) throw new Error(`on-chain settle failed: ${JSON.stringify(settled)}`)

    const matchBody = settled.body as {
      match?: {
        settlementTxHash?: string
        listTxHash?: string
        approveTxHash?: string
        phase?: string
      }
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          mockL1Only: true,
          mode: 'settle',
          onChain: true,
          listTxHash: listTxHash ?? matchBody.match?.listTxHash,
          approveTxHash:
            (approved.body as { approveTxHash?: string }).approveTxHash ?? matchBody.match?.approveTxHash,
          settlementTxHash: matchBody.match?.settlementTxHash,
          phase: matchBody.match?.phase,
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
