import { keccak256Utf8, ZERO20, ZERO32, type Hex } from './bytes.js'
import { replayModeA } from './modeA.js'
import { EVENT_TRADE_OPENED, TRADE_CLASS_ID, TRADE_STATE_NONE, type DepositBundle } from './types.js'

const SELLER = '0x1111111111111111111111111111111111111111' as Hex
const SUBJECT_NFT = '0x2222222222222222222222222222222222222222' as Hex
const QUOTE_ASSET = '0x3333333333333333333333333333333333333333' as Hex

export function labGenesisDepositBundle(): DepositBundle {
  const event = {
    version: 1,
    classId: TRADE_CLASS_ID,
    eventType: EVENT_TRADE_OPENED,
    tipId: keccak256Utf8('dle.archive.lab.tip.v1|trade-genesis'),
    nonce: 1n,
    sellerOrderHash: keccak256Utf8('dle.archive.lab.escrow.v1'),
    subjectNftContract: SUBJECT_NFT,
    subjectNftId: keccak256Utf8('dle.archive.lab.nft.v1'),
    seller: SELLER,
    quoteAsset: QUOTE_ASSET,
    quoteAmount: 1_000_000n,
    buyerConstraint: ZERO20,
    feePolicyHash: keccak256Utf8('dle.archive.lab.feepolicy.v1'),
    deadline: 1_893_456_000n,
    sellerNonce: 1n,
  }
  const parent = {
    state: TRADE_STATE_NONE,
    nonce: 0n,
    tipStateRoot: ZERO32,
  }
  const l1EscrowView = {
    live: true,
    settlementOwnsSubject: true,
    sellerOrderHash: event.sellerOrderHash,
    subjectNftContract: event.subjectNftContract,
    subjectNftId: event.subjectNftId,
    seller: event.seller,
    quoteAsset: event.quoteAsset,
    quoteAmount: event.quoteAmount,
    buyerConstraint: event.buyerConstraint,
    feePolicyHash: event.feePolicyHash,
    deadline: event.deadline,
    sellerNonce: event.sellerNonce,
  }
  const replay = replayModeA({ parent, event, l1EscrowView })
  if (!replay.ok) throw new Error(`lab genesis candidate must replay: ${replay.reason}`)
  return {
    schema: 'DleLabDepositBundleV1',
    event,
    parent,
    l1EscrowView,
    validatorQuorum: 5,
    claimedTipStateRoot: replay.tipStateRoot,
    claimedValueHash: replay.valueHash,
  }
}
