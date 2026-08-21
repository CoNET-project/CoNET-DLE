/**
 * Local mock-L1 on-chain list / settle (Archive or demo as certificateAuthority).
 * mockL1Only — not CoNET mainnet / not production settlement.
 */
import { Contract, JsonRpcProvider, Wallet, getAddress } from 'ethers'
import type { Hex } from './bytes.js'

const SETTLEMENT_ABI = [
  'function list(bytes32 sellerOrderHash, address subjectNft, uint256 subjectNftId, address quoteAsset, uint256 askAmount, uint64 deadline)',
  'function settle(bytes32 certificateHash, bytes32 sellerOrderHash, address buyer, uint256 clearingAmount, address scanner, address[] committee)',
  'function listings(bytes32) view returns (address seller, address subjectNft, uint256 subjectNftId, address quoteAsset, uint256 askAmount, uint64 deadline, bool settled)',
] as const

const ERC721_ABI = [
  'function approve(address to, uint256 tokenId)',
  'function getApproved(uint256 tokenId) view returns (address)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
  'function ownerOf(uint256 tokenId) view returns (address)',
] as const

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
] as const

export interface MockL1ListInput {
  rpcUrl: string
  settlement: Hex
  sellerPrivateKey: string
  sellerOrderHash: Hex
  subjectNft: Hex
  subjectNftId: string
  quoteAsset: Hex
  askAmount: string
  deadline: string
}

export interface MockL1ApproveInput {
  rpcUrl: string
  settlement: Hex
  buyerPrivateKey: string
  quoteAsset: Hex
  /** Minimum allowance required (clearing / ask amount). */
  amount: string
}

export interface MockL1SettleInput {
  rpcUrl: string
  settlement: Hex
  authorityPrivateKey: string
  certificateHash: Hex
  sellerOrderHash: Hex
  buyer: Hex
  clearingAmount: string
  scanner: Hex
  committee: readonly Hex[]
}

export type MockL1TxResult =
  | { ok: true; txHash: Hex; mockL1Only: true }
  | { ok: false; reason: string; mockL1Only: true }

function asAddress(raw: string, label: string): string {
  try {
    return getAddress(raw)
  } catch {
    throw new Error(`invalid ${label}`)
  }
}

function asBytes32(raw: string, label: string): string {
  const h = raw.trim().toLowerCase()
  if (!/^0x[0-9a-f]{64}$/.test(h)) throw new Error(`invalid ${label}`)
  return h
}

/**
 * Seller escrows NFT into MockDleAuctionSettlement.list (required before settle).
 */
export async function listMockL1Auction(input: MockL1ListInput): Promise<MockL1TxResult> {
  const settlement = asAddress(input.settlement, 'settlement')
  const subjectNft = asAddress(input.subjectNft, 'subjectNft')
  const quoteAsset = asAddress(input.quoteAsset, 'quoteAsset')
  let tokenId: bigint
  let ask: bigint
  let deadline: bigint
  let orderHash: string
  try {
    tokenId = BigInt(input.subjectNftId)
    ask = BigInt(input.askAmount)
    deadline = BigInt(input.deadline)
    orderHash = asBytes32(input.sellerOrderHash, 'sellerOrderHash')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: msg, mockL1Only: true }
  }
  if (ask <= 0n) return { ok: false, reason: 'askAmount must be > 0', mockL1Only: true }

  const provider = new JsonRpcProvider(input.rpcUrl, undefined, { staticNetwork: true })
  try {
    const seller = new Wallet(input.sellerPrivateKey, provider)
    const nft = new Contract(subjectNft, ERC721_ABI, seller)
    const settlementC = new Contract(settlement, SETTLEMENT_ABI, seller)

    const owner = String(await nft.ownerOf(tokenId)).toLowerCase()
    if (owner === settlement.toLowerCase()) {
      // Already escrowed for a prior list — treat as success (idempotent demo path).
      return { ok: true, txHash: '0x' + '0'.repeat(64) as Hex, mockL1Only: true }
    }
    if (owner !== seller.address.toLowerCase()) {
      return { ok: false, reason: 'seller does not own subject NFT', mockL1Only: true }
    }

    const approved = String(await nft.getApproved(tokenId)).toLowerCase()
    const approvedAll = Boolean(await nft.isApprovedForAll(seller.address, settlement))
    if (approved !== settlement.toLowerCase() && !approvedAll) {
      const approveTx = await nft.approve(settlement, tokenId)
      await approveTx.wait()
    }

    const tx = await settlementC.list(orderHash, subjectNft, tokenId, quoteAsset, ask, deadline)
    const receipt = await tx.wait()
    const txHash = String(receipt?.hash ?? tx.hash) as Hex
    return { ok: true, txHash, mockL1Only: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: `list failed: ${msg}`, mockL1Only: true }
  } finally {
    provider.destroy()
  }
}

/**
 * Buyer approves quote ERC-20 to settlement (required before settle transferFrom).
 * Idempotent when allowance already ≥ amount.
 */
export async function approveMockL1AuctionQuote(input: MockL1ApproveInput): Promise<MockL1TxResult> {
  const settlement = asAddress(input.settlement, 'settlement')
  const quoteAsset = asAddress(input.quoteAsset, 'quoteAsset')
  let amount: bigint
  try {
    amount = BigInt(input.amount)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: msg, mockL1Only: true }
  }
  if (amount <= 0n) return { ok: false, reason: 'amount must be > 0', mockL1Only: true }

  const provider = new JsonRpcProvider(input.rpcUrl, undefined, { staticNetwork: true })
  try {
    const buyer = new Wallet(input.buyerPrivateKey, provider)
    const quote = new Contract(quoteAsset, ERC20_ABI, buyer)
    const current = BigInt(await quote.allowance(buyer.address, settlement))
    if (current >= amount) {
      return { ok: true, txHash: ('0x' + '0'.repeat(64)) as Hex, mockL1Only: true }
    }
    const tx = await quote.approve(settlement, amount)
    const receipt = await tx.wait()
    const txHash = String(receipt?.hash ?? tx.hash) as Hex
    return { ok: true, txHash, mockL1Only: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: `approve failed: ${msg}`, mockL1Only: true }
  } finally {
    provider.destroy()
  }
}

/**
 * certificateAuthority calls MockDleAuctionSettlement.settle (atomic NFT↔ERC20 + 1bps).
 */
export async function settleMockL1Auction(input: MockL1SettleInput): Promise<MockL1TxResult> {
  const settlement = asAddress(input.settlement, 'settlement')
  const buyer = asAddress(input.buyer, 'buyer')
  const scanner = asAddress(input.scanner, 'scanner')
  let certificateHash: string
  let sellerOrderHash: string
  let clearingAmount: bigint
  let committee: string[]
  try {
    certificateHash = asBytes32(input.certificateHash, 'certificateHash')
    sellerOrderHash = asBytes32(input.sellerOrderHash, 'sellerOrderHash')
    clearingAmount = BigInt(input.clearingAmount)
    committee = input.committee.map((a, i) => asAddress(a, `committee[${i}]`))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: msg, mockL1Only: true }
  }
  if (clearingAmount <= 0n) return { ok: false, reason: 'clearingAmount must be > 0', mockL1Only: true }
  if (committee.length === 0) return { ok: false, reason: 'committee empty', mockL1Only: true }

  const provider = new JsonRpcProvider(input.rpcUrl, undefined, { staticNetwork: true })
  try {
    const authority = new Wallet(input.authorityPrivateKey, provider)
    const settlementC = new Contract(settlement, SETTLEMENT_ABI, authority)
    const tx = await settlementC.settle(
      certificateHash,
      sellerOrderHash,
      buyer,
      clearingAmount,
      scanner,
      committee,
    )
    const receipt = await tx.wait()
    const txHash = String(receipt?.hash ?? tx.hash) as Hex
    return { ok: true, txHash, mockL1Only: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: `settle failed: ${msg}`, mockL1Only: true }
  } finally {
    provider.destroy()
  }
}

export function mockL1SettleEnv(): {
  rpcUrl?: string
  settlement?: Hex
  authorityPrivateKey?: string
  settleOnChain: boolean
} {
  const rpcUrl = process.env.MOCK_L1_RPC_URL?.trim()
  const settlement = process.env.MOCK_L1_SETTLEMENT?.trim() as Hex | undefined
  const authorityPrivateKey = process.env.MOCK_L1_AUTHORITY_PRIVATE_KEY?.trim()
  const settleOnChain =
    process.env.MOCK_L1_SETTLE_ONCHAIN === '1' || process.env.MOCK_L1_SETTLE_ONCHAIN === 'true'
  return {
    rpcUrl: rpcUrl && rpcUrl.length > 0 ? rpcUrl : undefined,
    settlement: settlement && /^0x[0-9a-fA-F]{40}$/.test(settlement) ? settlement : undefined,
    authorityPrivateKey:
      authorityPrivateKey && /^0x[0-9a-fA-F]{64}$/.test(authorityPrivateKey)
        ? authorityPrivateKey
        : undefined,
    settleOnChain,
  }
}
