#!/usr/bin/env node
/**
 * Mock-L1 auction CLI — register chain NFT genesis via archive HTTP,
 * submit sell/buy orders, scan, check, attest, settle status.
 * mockL1Only / not production DePIN.
 */
import process from 'node:process'
import { Wallet } from 'ethers'
import {
  CHAIN_CLASS_ASSET,
  CHAIN_CLASS_STORAGE,
  CHAIN_CLASS_TRADE,
  makeMockL1Registration,
  mockL1ClassNameOf,
  mockL1FeePolicyHash,
  type MockL1ChainClassId,
} from '../shared/mockL1.js'
import {
  ORDER_SIDE_BUY,
  ORDER_SIDE_SELL,
  certPersonalSignMessage,
  makeUnsignedTradeOrder,
  matchCandidateHash,
  orderPersonalSignMessage,
  type OrderSide,
} from '../shared/tradeMatch.js'
import type { Hex } from '../shared/bytes.js'

const POST_TIMEOUT_MS = 15_000

interface Parsed {
  archiveUrl: string
  cmd: string
  args: Record<string, string>
}

function usage(): never {
  console.error(`usage: mock-l1-auction-cli.js --archive URL <command> [flags]

commands:
  register   --class asset|storage|trade --tokenId N --user 0x.. --registry 0x.. --chainId N --pk HEX
  submit     --side sell|buy --chainNftId N --pk HEX --subjectNft 0x.. --subjectId N --quote 0x.. --price WEI --deadline SEC
  cancel     --orderHash 0x.. --pk HEX
  scan       [--scanner 0x..]
  candidate  --sellHash 0x.. --buyHash 0x.. --scanner 0x..
  check      --candidateHash 0x.. [--custody true] [--balanceOk true] [--allowanceOk true]
  attest     --candidateHash 0x.. --pk HEX
  settle     --candidateHash 0x.. --outcome submitted|settled|failed [--txHash 0x..]
  status     (GET /trade/orders + /trade/matches + /mockl1/chains)

mockL1Only — not CoNET mainnet, not production DePIN.
`)
  process.exit(2)
}

function parseArgs(argv: string[]): Parsed {
  let archiveUrl = ''
  const args: Record<string, string> = {}
  const positional: string[] = []
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!
    const n = argv[i + 1]
    if (a === '--archive' && n !== undefined) {
      archiveUrl = n.replace(/\/$/, '')
      i += 1
      continue
    }
    if (a.startsWith('--') && n !== undefined && !n.startsWith('--')) {
      args[a.slice(2)] = n
      i += 1
      continue
    }
    if (!a.startsWith('--')) positional.push(a)
  }
  if (archiveUrl === '' || positional[0] === undefined) usage()
  return { archiveUrl, cmd: positional[0]!, args }
}

async function postJson(url: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), POST_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    const json = (await res.json()) as Record<string, unknown>
    return { status: res.status, body: json }
  } finally {
    clearTimeout(t)
  }
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url)
  return res.json()
}

function classIdOf(raw: string): MockL1ChainClassId {
  const s = raw.toLowerCase()
  if (s === 'asset' || s === '1') return CHAIN_CLASS_ASSET
  if (s === 'storage' || s === '2') return CHAIN_CLASS_STORAGE
  if (s === 'trade' || s === '3') return CHAIN_CLASS_TRADE
  throw new Error(`unknown class ${raw}`)
}

async function main(): Promise<void> {
  const { archiveUrl, cmd, args } = parseArgs(process.argv.slice(2))

  if (cmd === 'status') {
    const [chains, orders, matches] = await Promise.all([
      getJson(`${archiveUrl}/mockl1/chains`),
      getJson(`${archiveUrl}/trade/orders`),
      getJson(`${archiveUrl}/trade/matches`),
    ])
    console.log(JSON.stringify({ mockL1Only: true, chains, orders, matches }, null, 2))
    return
  }

  if (cmd === 'register') {
    const pk = args.pk
    if (pk === undefined) throw new Error('--pk required')
    const wallet = new Wallet(pk)
    const classId = classIdOf(args.class ?? 'trade')
    const tokenId = args.tokenId ?? '1'
    const user = (args.user ?? wallet.address) as Hex
    const registry = args.registry as Hex
    const chainId = Number(args.chainId ?? '31337')
    if (registry === undefined) throw new Error('--registry required')
    const req = makeMockL1Registration({
      tokenId,
      classId,
      user,
      registry,
      chainId,
      archiveGroupId:
        args.archiveGroupId ??
        '0x0000000000000000000000000000000000000000000000000000000000000001',
      genesisAcHash: (args.placementCert ??
        '0x00000000000000000000000000000000000000000000000000000000000000aa') as Hex,
    })
    const out = await postJson(`${archiveUrl}/mockl1/register`, req)
    console.log(JSON.stringify({ ...out, className: mockL1ClassNameOf(classId) }, null, 2))
    return
  }

  if (cmd === 'submit') {
    const pk = args.pk
    if (pk === undefined) throw new Error('--pk required')
    const wallet = new Wallet(pk)
    const side = (args.side === 'buy' ? ORDER_SIDE_BUY : ORDER_SIDE_SELL) as OrderSide
    const unsigned = makeUnsignedTradeOrder({
      side,
      chainNftId: args.chainNftId ?? '1',
      maker: wallet.address as Hex,
      subjectNftContract: args.subjectNft as Hex,
      subjectNftId: args.subjectId ?? '1',
      quoteAsset: args.quote as Hex,
      price: args.price ?? '1000000',
      amount: args.amount ?? '1',
      nonce: args.nonce ?? String(Date.now()),
      deadline: args.deadline ?? String(Math.floor(Date.now() / 1000) + 3600),
      feePolicyHash: mockL1FeePolicyHash(),
    })
    if (args.subjectNft === undefined || args.quote === undefined) {
      throw new Error('--subjectNft and --quote required')
    }
    const sig = await wallet.signMessage(orderPersonalSignMessage(unsigned.orderHash))
    const order = { ...unsigned, signature: sig as Hex }
    const out = await postJson(`${archiveUrl}/trade/submit`, order)
    console.log(JSON.stringify(out, null, 2))
    return
  }

  if (cmd === 'cancel') {
    const pk = args.pk
    const orderHash = args.orderHash
    if (pk === undefined || orderHash === undefined) throw new Error('--pk and --orderHash required')
    const wallet = new Wallet(pk)
    const msg = `dle.mockl1.trade.cancel.v1|${orderHash.toLowerCase()}`
    const signature = await wallet.signMessage(msg)
    const out = await postJson(`${archiveUrl}/trade/cancel`, {
      orderHash,
      maker: wallet.address,
      signature,
    })
    console.log(JSON.stringify(out, null, 2))
    return
  }

  if (cmd === 'scan') {
    const out = await postJson(`${archiveUrl}/trade/scan`, {
      scanner: args.scanner ?? '0x0000000000000000000000000000000000000001',
    })
    console.log(JSON.stringify(out, null, 2))
    return
  }

  if (cmd === 'candidate') {
    const sellOrderHash = args.sellHash as Hex
    const buyOrderHash = args.buyHash as Hex
    const scanner = (args.scanner ?? '0x0000000000000000000000000000000000000001') as Hex
    if (sellOrderHash === undefined || buyOrderHash === undefined) {
      throw new Error('--sellHash and --buyHash required')
    }
    const status = (await getJson(`${archiveUrl}/trade/orders`)) as {
      orders?: Array<Record<string, unknown>>
    }
    const sell = status.orders?.find((o) => String(o.orderHash).toLowerCase() === sellOrderHash.toLowerCase())
    const buy = status.orders?.find((o) => String(o.orderHash).toLowerCase() === buyOrderHash.toLowerCase())
    if (sell === undefined || buy === undefined) throw new Error('orders not found on archive')
    const candidate = {
      schema: 'MockL1MatchCandidateV1' as const,
      mockL1Only: true as const,
      scanner,
      sellOrderHash,
      buyOrderHash,
      chainNftId: String(sell.chainNftId),
      subjectNftContract: sell.subjectNftContract as Hex,
      subjectNftId: String(sell.subjectNftId),
      quoteAsset: sell.quoteAsset as Hex,
      clearingPrice: String(sell.price),
      feePolicyHash: mockL1FeePolicyHash(),
      candidateHash: '0x' as Hex,
      submittedAt: new Date().toISOString(),
    }
    candidate.candidateHash = matchCandidateHash(candidate)
    const out = await postJson(`${archiveUrl}/trade/candidate`, candidate)
    console.log(JSON.stringify(out, null, 2))
    return
  }

  if (cmd === 'check') {
    const out = await postJson(`${archiveUrl}/trade/check`, {
      candidateHash: args.candidateHash,
      l1EscrowCustody: args.custody !== 'false',
      buyerBalanceOk: args.balanceOk !== 'false',
      buyerAllowanceOk: args.allowanceOk !== 'false',
    })
    console.log(JSON.stringify(out, null, 2))
    return
  }

  if (cmd === 'attest') {
    const pk = args.pk
    const candidateHash = args.candidateHash
    if (pk === undefined || candidateHash === undefined) throw new Error('--pk and --candidateHash required')
    const wallet = new Wallet(pk)
    const matches = (await getJson(`${archiveUrl}/trade/matches`)) as {
      matches?: Array<{ candidateHash: string; certificate?: { certificateHash: string } }>
    }
    const row = matches.matches?.find((m) => m.candidateHash.toLowerCase() === candidateHash.toLowerCase())
    const certHash = row?.certificate?.certificateHash
    if (certHash === undefined) throw new Error('certificate not proposed yet')
    const signature = await wallet.signMessage(certPersonalSignMessage(certHash as Hex))
    const out = await postJson(`${archiveUrl}/trade/attest`, {
      candidateHash,
      signer: wallet.address,
      signature,
    })
    console.log(JSON.stringify(out, null, 2))
    return
  }

  if (cmd === 'settle') {
    const out = await postJson(`${archiveUrl}/trade/settle`, {
      candidateHash: args.candidateHash,
      outcome: args.outcome ?? 'submitted',
      txHash: args.txHash,
      error: args.error,
    })
    console.log(JSON.stringify(out, null, 2))
    return
  }

  usage()
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
