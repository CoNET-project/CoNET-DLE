import { addressFromHash, newChainRequestId, type DleLabNewChainRequestV1 } from '../../shared/newchain.js'
import { keccak256Utf8, ZERO20, ZERO32, type Hex } from './bytes.js'
import { replayAssetGenesisBundle, replayDepositBundle, replayStorageGenesisBundle } from './modeA.js'
import {
  ASSET_CLASS_ID,
  ASSET_STATE_NONE,
  EVENT_ASSET_OPENED,
  EVENT_STORAGE_OPENED,
  EVENT_TRADE_OPENED,
  STORAGE_CLASS_ID,
  STORAGE_STATE_NONE,
  TRADE_CLASS_ID,
  TRADE_STATE_NONE,
  type AssetGenesisBundle,
  type DepositBundle,
  type ModeAResult,
  type StorageGenesisBundle,
} from './types.js'

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
  const replay = replayDepositBundle({
    schema: 'DleLabDepositBundleV1',
    event,
    parent,
    l1EscrowView,
    validatorQuorum: 5,
  })
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

const emptyParent = {
  state: TRADE_STATE_NONE,
  nonce: 0n,
  tipStateRoot: ZERO32,
}

export function labAssetGenesisBundle(request: DleLabNewChainRequestV1): AssetGenesisBundle {
  const requestId = newChainRequestId(request)
  const event = {
    version: 1,
    classId: ASSET_CLASS_ID,
    eventType: EVENT_ASSET_OPENED,
    tipId: keccak256Utf8(`dle.archive.lab.tip.v1|asset|${requestId}`),
    nonce: 1n,
    owner: request.user,
    assetToken: addressFromHash(keccak256Utf8(`dle.archive.lab.assetToken.v1|${requestId}`)),
    burnId: keccak256Utf8(`dle.archive.lab.burn.v1|${requestId}`),
    notionalUsdc6: 1_000_000n,
  }
  const parent = { ...emptyParent, state: ASSET_STATE_NONE }
  const l1AssetView = {
    live: true,
    burnActivated: true,
    owner: event.owner,
    assetToken: event.assetToken,
    burnId: event.burnId,
    notionalUsdc6: event.notionalUsdc6,
  }
  const replay = replayAssetGenesisBundle({
    schema: 'DleLabAssetGenesisBundleV1',
    event,
    parent,
    l1AssetView,
  })
  if (!replay.ok) throw new Error(`lab asset genesis must replay: ${replay.reason}`)
  return {
    schema: 'DleLabAssetGenesisBundleV1',
    event,
    parent,
    l1AssetView,
    claimedTipStateRoot: replay.tipStateRoot,
    claimedValueHash: replay.valueHash,
  }
}

export function labStorageGenesisBundle(request: DleLabNewChainRequestV1): StorageGenesisBundle {
  const requestId = newChainRequestId(request)
  const event = {
    version: 1,
    classId: STORAGE_CLASS_ID,
    eventType: EVENT_STORAGE_OPENED,
    tipId: keccak256Utf8(`dle.archive.lab.tip.v1|storage|${requestId}`),
    nonce: 1n,
    owner: request.user,
    contentIndexHash: keccak256Utf8(`dle.archive.lab.content.v1|${requestId}`),
    accessPriceGb: 1_000_000_000n,
  }
  const parent = { ...emptyParent, state: STORAGE_STATE_NONE }
  const l1StorageView = {
    live: true,
    contentIndexPresent: true,
    owner: event.owner,
    contentIndexHash: event.contentIndexHash,
    accessPriceGb: event.accessPriceGb,
  }
  const replay = replayStorageGenesisBundle({
    schema: 'DleLabStorageGenesisBundleV1',
    event,
    parent,
    l1StorageView,
  })
  if (!replay.ok) throw new Error(`lab storage genesis must replay: ${replay.reason}`)
  return {
    schema: 'DleLabStorageGenesisBundleV1',
    event,
    parent,
    l1StorageView,
    claimedTipStateRoot: replay.tipStateRoot,
    claimedValueHash: replay.valueHash,
  }
}

export function labTradeGenesisBundleFromRequest(request: DleLabNewChainRequestV1): DepositBundle {
  const requestId = newChainRequestId(request)
  const event = {
    version: 1,
    classId: TRADE_CLASS_ID,
    eventType: EVENT_TRADE_OPENED,
    tipId: keccak256Utf8(`dle.archive.lab.tip.v1|trade|${requestId}`),
    nonce: 1n,
    sellerOrderHash: keccak256Utf8(`dle.archive.lab.escrow.v1|${requestId}`),
    subjectNftContract: addressFromHash(keccak256Utf8(`dle.archive.lab.nft.v1|${requestId}`)),
    subjectNftId: keccak256Utf8(`dle.archive.lab.subject.v1|${requestId}`),
    seller: request.user,
    quoteAsset: addressFromHash(keccak256Utf8(`dle.archive.lab.quote.v1|${requestId}`)),
    quoteAmount: 1_000_000n,
    buyerConstraint: ZERO20,
    feePolicyHash: keccak256Utf8(`dle.archive.lab.feepolicy.v1|${requestId}`),
    deadline: 1_893_456_000n,
    sellerNonce: 1n,
  }
  const parent = { ...emptyParent, state: TRADE_STATE_NONE }
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
  const replay = replayDepositBundle({
    schema: 'DleLabDepositBundleV1',
    event,
    parent,
    l1EscrowView,
    validatorQuorum: 5,
  })
  if (!replay.ok) throw new Error(`lab trade genesis must replay: ${replay.reason}`)
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

export function replayLabNewChainRequest(request: DleLabNewChainRequestV1): ModeAResult {
  if (request.classId === ASSET_CLASS_ID) return replayAssetGenesisBundle(labAssetGenesisBundle(request))
  if (request.classId === STORAGE_CLASS_ID) return replayStorageGenesisBundle(labStorageGenesisBundle(request))
  return replayDepositBundle(labTradeGenesisBundleFromRequest(request))
}
