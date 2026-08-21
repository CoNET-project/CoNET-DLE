/**
 * Local mock-L1 escrow custody helpers (Archive-side eth_call).
 * mockL1Only — not CoNET mainnet / not production settlement.
 */
import { Contract, JsonRpcProvider, getAddress } from 'ethers'
import type { Hex } from './bytes.js'

const ERC721_ABI = [
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function getApproved(uint256 tokenId) view returns (address)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
] as const

const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
] as const

export interface MockL1CustodyCheckInput {
  rpcUrl: string
  settlement: Hex
  seller: Hex
  subjectNftContract: Hex
  subjectNftId: string
  buyer: Hex
  quoteAsset: Hex
  clearingPrice: string
}

export type MockL1CustodyCheckResult =
  | { ok: true; mockL1Only: true }
  | { ok: false; reason: string; mockL1Only: true }

function asAddress(raw: string, label: string): string {
  try {
    return getAddress(raw)
  } catch {
    throw new Error(`invalid ${label}`)
  }
}

/**
 * Archive verifies NFT custody + buyer quote balance/allowance against a local
 * settlement/escrow address. Client-asserted flags must not replace this when RPC is configured.
 */
export async function verifyMockL1Custody(input: MockL1CustodyCheckInput): Promise<MockL1CustodyCheckResult> {
  const settlement = asAddress(input.settlement, 'settlement')
  const seller = asAddress(input.seller, 'seller')
  const buyer = asAddress(input.buyer, 'buyer')
  const nft = asAddress(input.subjectNftContract, 'subjectNft')
  const quote = asAddress(input.quoteAsset, 'quoteAsset')
  let tokenId: bigint
  let price: bigint
  try {
    tokenId = BigInt(input.subjectNftId)
    price = BigInt(input.clearingPrice)
  } catch {
    return { ok: false, reason: 'invalid subjectNftId or clearingPrice', mockL1Only: true }
  }
  if (price <= 0n) return { ok: false, reason: 'clearingPrice must be > 0', mockL1Only: true }

  const provider = new JsonRpcProvider(input.rpcUrl, undefined, { staticNetwork: true })
  const nftC = new Contract(nft, ERC721_ABI, provider)
  const erc20 = new Contract(quote, ERC20_ABI, provider)

  try {
    const owner = String(await nftC.ownerOf(tokenId)).toLowerCase()
    const settlementLc = settlement.toLowerCase()
    if (owner === settlementLc) {
      // NFT already in escrow — OK
    } else if (owner === seller.toLowerCase()) {
      const approved = String(await nftC.getApproved(tokenId)).toLowerCase()
      const approvedAll = Boolean(await nftC.isApprovedForAll(seller, settlement))
      if (approved !== settlementLc && !approvedAll) {
        return { ok: false, reason: 'L1 escrow custody not confirmed (NFT not held/approved)', mockL1Only: true }
      }
    } else {
      return { ok: false, reason: 'L1 escrow custody not confirmed (unexpected NFT owner)', mockL1Only: true }
    }

    const bal = BigInt(await erc20.balanceOf(buyer))
    if (bal < price) {
      return { ok: false, reason: 'buyer balance/allowance check failed (balance)', mockL1Only: true }
    }
    const allow = BigInt(await erc20.allowance(buyer, settlement))
    if (allow < price) {
      return { ok: false, reason: 'buyer balance/allowance check failed (allowance)', mockL1Only: true }
    }
    return { ok: true, mockL1Only: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: `L1 RPC custody check failed: ${msg}`, mockL1Only: true }
  } finally {
    provider.destroy()
  }
}

export function mockL1CustodyEnv(): { rpcUrl?: string; settlement?: Hex } {
  const rpcUrl = process.env.MOCK_L1_RPC_URL?.trim()
  const settlement = process.env.MOCK_L1_SETTLEMENT?.trim() as Hex | undefined
  return {
    rpcUrl: rpcUrl && rpcUrl.length > 0 ? rpcUrl : undefined,
    settlement: settlement && /^0x[0-9a-fA-F]{40}$/.test(settlement) ? settlement : undefined,
  }
}
