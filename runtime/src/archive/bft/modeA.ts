import {
  addressBytes,
  concatBytes,
  fromHex,
  keccak256,
  toHex,
  uintBE,
  utf8,
  ZERO20,
  ZERO32,
  type Hex,
} from './bytes.js'
import {
  ASSET_CLASS_ID,
  ASSET_STATE_NONE,
  ASSET_STATE_OPEN,
  ASSET_STATE_PATHS,
  ERR_ASSET_BURN_NOT_ACTIVATED,
  ERR_ASSET_L1_NOT_FOUND,
  ERR_ASSET_VIEW_MISMATCH,
  ERR_FSM_BAD_NONCE,
  ERR_FSM_CLAIMED_MISMATCH,
  ERR_FSM_DOMAIN,
  ERR_FSM_NO_TRANSITION,
  ERR_STORAGE_INDEX_MISSING,
  ERR_STORAGE_L1_NOT_FOUND,
  ERR_STORAGE_VIEW_MISMATCH,
  ERR_TRADE_BAD_PHASE,
  ERR_TRADE_CERT_QUORUM,
  ERR_TRADE_ESCROW_CUSTODY,
  ERR_TRADE_L1_NOT_FOUND,
  ERR_TRADE_MATCH_INVALID,
  ERR_TRADE_SELLER_ORDER_MISMATCH,
  ERR_TRADE_SETTLE_REPLAY,
  EVENT_ASSET_OPENED,
  EVENT_STORAGE_OPENED,
  EVENT_TRADE_MATCH_CERTIFIED,
  EVENT_TRADE_MATCH_PROPOSED,
  EVENT_TRADE_OPENED,
  EVENT_TRADE_SETTLED,
  EVENT_TRADE_SETTLEMENT_FAILED,
  EVENT_TRADE_SETTLEMENT_SUBMITTED,
  STORAGE_CLASS_ID,
  STORAGE_STATE_NONE,
  STORAGE_STATE_OPEN,
  STORAGE_STATE_PATHS,
  TRADE_CLASS_ID,
  TRADE_STATE_MATCH_CERTIFIED,
  TRADE_STATE_MATCH_PROPOSED,
  TRADE_STATE_NONE,
  TRADE_STATE_OPEN,
  TRADE_STATE_PATHS,
  TRADE_STATE_SETTLED,
  TRADE_STATE_SETTLEMENT_FAILED,
  TRADE_STATE_SETTLEMENT_SUBMITTED,
  type AssetGenesisBundle,
  type AssetOpenedEvent,
  type AssetOpenedFields,
  type DepositBundle,
  type L1AssetBurnView,
  type L1EscrowView,
  type L1StorageView,
  type ModeAResult,
  type StorageGenesisBundle,
  type StorageOpenedEvent,
  type StorageOpenedFields,
  type TradeMatchEvent,
  type TradeMatchFields,
  type TradeOpenedEvent,
  type TradeOpenedFields,
  type TradeParent,
} from './types.js'

function fail(code: number, reason: string): ModeAResult {
  return { ok: false, code, reason }
}

function sameHex(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

function encodeTradeOpenedPayload(fields: TradeOpenedFields): Uint8Array {
  return concatBytes(
    fromHex(fields.sellerOrderHash, 32),
    addressBytes(fields.subjectNftContract),
    fromHex(fields.subjectNftId, 32),
    addressBytes(fields.seller),
    addressBytes(fields.quoteAsset),
    uintBE(fields.quoteAmount, 16),
    addressBytes(fields.buyerConstraint),
    fromHex(fields.feePolicyHash, 32),
    uintBE(fields.deadline, 8),
    uintBE(fields.sellerNonce, 32),
  )
}

export function encodeTradeOpenedEvent(event: TradeOpenedEvent): Uint8Array {
  return concatBytes(
    uintBE(event.version, 1),
    uintBE(event.classId, 1),
    uintBE(event.eventType, 2),
    fromHex(event.tipId, 32),
    uintBE(event.nonce, 8),
    encodeTradeOpenedPayload(event),
  )
}

function leafBytes(path: string, value: Uint8Array): Uint8Array {
  const pathBytes = utf8(path)
  return concatBytes(uintBE(pathBytes.length, 2), pathBytes, uintBE(value.length, 2), value)
}

function merkleRoot(leaves: Uint8Array[]): Hex {
  if (leaves.length === 0) return keccak256(new Uint8Array(0))
  let layer = leaves.map((leaf) => keccak256(leaf))
  while (layer.length > 1) {
    const next: Hex[] = []
    for (let i = 0; i < layer.length; i += 2) {
      const left = fromHex(layer[i]!, 32)
      const right = fromHex(layer[i + 1] ?? layer[i]!, 32)
      next.push(keccak256(concatBytes(left, right)))
    }
    layer = next
  }
  return layer[0]!
}

export function computeTradeTipStateRoot(fields: {
  state: number
  nonce: bigint
  order: TradeOpenedFields
  buyer?: Hex
  tradeFeeAmount?: bigint
  paymentAuthHash?: Hex
  l1TxHash?: Hex
  candidateHash?: Hex
  certificateHash?: Hex
  scanner?: Hex
  clearingPrice?: bigint
  settlementCalldataHash?: Hex
}): Hex {
  const values: Record<(typeof TRADE_STATE_PATHS)[number], Uint8Array> = {
    '/state': uintBE(fields.state, 1),
    '/nonce': uintBE(fields.nonce, 8),
    '/sellerOrderHash': fromHex(fields.order.sellerOrderHash, 32),
    '/subjectNftContract': addressBytes(fields.order.subjectNftContract),
    '/subjectNftId': fromHex(fields.order.subjectNftId, 32),
    '/seller': addressBytes(fields.order.seller),
    '/sellerNonce': uintBE(fields.order.sellerNonce, 32),
    '/buyer': addressBytes(fields.buyer ?? ZERO20),
    '/buyerConstraint': addressBytes(fields.order.buyerConstraint),
    '/quoteAsset': addressBytes(fields.order.quoteAsset),
    '/quoteAmount': uintBE(fields.order.quoteAmount, 16),
    '/tradeFeeAmount': uintBE(fields.tradeFeeAmount ?? 0n, 16),
    '/feePolicyHash': fromHex(fields.order.feePolicyHash, 32),
    '/deadline': uintBE(fields.order.deadline, 8),
    '/paymentAuthHash': fromHex(fields.paymentAuthHash ?? ZERO32, 32),
    '/l1TxHash': fromHex(fields.l1TxHash ?? ZERO32, 32),
    '/candidateHash': fromHex(fields.candidateHash ?? ZERO32, 32),
    '/certificateHash': fromHex(fields.certificateHash ?? ZERO32, 32),
    '/scanner': addressBytes(fields.scanner ?? ZERO20),
    '/clearingPrice': uintBE(fields.clearingPrice ?? 0n, 16),
    '/settlementCalldataHash': fromHex(fields.settlementCalldataHash ?? ZERO32, 32),
  }
  const leaves = [...TRADE_STATE_PATHS]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((path) => leafBytes(path, values[path]))
  return merkleRoot(leaves)
}

export function computeValueHash(input: {
  tipStateRoot: Hex
  eventBytes: Uint8Array
  parentTipStateRoot: Hex
}): Hex {
  return keccak256(
    concatBytes(
      utf8('dle.archive.lab.value.v1'),
      fromHex(input.tipStateRoot, 32),
      fromHex(keccak256(input.eventBytes), 32),
      fromHex(input.parentTipStateRoot, 32),
    ),
  )
}

function escrowMatches(event: TradeOpenedFields, view: L1EscrowView): boolean {
  return (
    sameHex(event.sellerOrderHash, view.sellerOrderHash) &&
    sameHex(event.subjectNftContract, view.subjectNftContract) &&
    sameHex(event.subjectNftId, view.subjectNftId) &&
    sameHex(event.seller, view.seller) &&
    sameHex(event.quoteAsset, view.quoteAsset) &&
    event.quoteAmount === view.quoteAmount &&
    sameHex(event.buyerConstraint, view.buyerConstraint) &&
    sameHex(event.feePolicyHash, view.feePolicyHash) &&
    event.deadline === view.deadline &&
    event.sellerNonce === view.sellerNonce
  )
}

export function replayModeA(input: {
  parent: TradeParent
  event: TradeOpenedEvent
  l1EscrowView: L1EscrowView
  claimedTipStateRoot?: Hex
  claimedValueHash?: Hex
}): ModeAResult {
  if (input.event.version !== 1 || input.event.classId !== TRADE_CLASS_ID) {
    return fail(ERR_FSM_DOMAIN, 'event domain or classId is not trade v1')
  }
  if (input.event.eventType !== EVENT_TRADE_OPENED) {
    return fail(ERR_FSM_NO_TRANSITION, 'unsupported eventType')
  }
  if (input.parent.state !== TRADE_STATE_NONE) {
    return fail(ERR_FSM_NO_TRANSITION, 'TradeOpened is only valid from None')
  }
  if (input.event.nonce !== input.parent.nonce + 1n) {
    return fail(ERR_FSM_BAD_NONCE, 'event nonce must be parent.nonce + 1')
  }
  if (!input.l1EscrowView.live) {
    return fail(ERR_TRADE_L1_NOT_FOUND, 'cited L1 escrow view is not live')
  }
  if (!input.l1EscrowView.settlementOwnsSubject) {
    return fail(ERR_TRADE_ESCROW_CUSTODY, 'Settlement does not hold the subject NFT')
  }
  if (!escrowMatches(input.event, input.l1EscrowView)) {
    return fail(ERR_TRADE_SELLER_ORDER_MISMATCH, 'TradeOpened fields do not equal the cited L1 escrow view')
  }
  const eventBytes = encodeTradeOpenedEvent(input.event)
  const tipStateRoot = computeTradeTipStateRoot({
    state: TRADE_STATE_OPEN,
    nonce: input.event.nonce,
    order: input.event,
  })
  const valueHash = computeValueHash({
    tipStateRoot,
    eventBytes,
    parentTipStateRoot: input.parent.tipStateRoot,
  })
  if (input.claimedTipStateRoot !== undefined && !sameHex(input.claimedTipStateRoot, tipStateRoot)) {
    return fail(ERR_FSM_CLAIMED_MISMATCH, 'claimed tipStateRoot does not match Mode A replay')
  }
  if (input.claimedValueHash !== undefined && !sameHex(input.claimedValueHash, valueHash)) {
    return fail(ERR_FSM_CLAIMED_MISMATCH, 'claimed valueHash does not match Mode A replay')
  }
  return {
    ok: true,
    nextState: TRADE_STATE_OPEN,
    nonce: input.event.nonce,
    tipStateRoot,
    valueHash,
    bodyCommitment: keccak256(eventBytes),
    eventBytes,
  }
}

export function replayDepositBundle(bundle: DepositBundle): ModeAResult {
  return replayModeA({
    parent: bundle.parent,
    event: bundle.event,
    l1EscrowView: bundle.l1EscrowView,
    ...(bundle.claimedTipStateRoot !== undefined ? { claimedTipStateRoot: bundle.claimedTipStateRoot } : {}),
    ...(bundle.claimedValueHash !== undefined ? { claimedValueHash: bundle.claimedValueHash } : {}),
  })
}

function encodeTradeMatchPayload(fields: TradeMatchFields): Uint8Array {
  return concatBytes(
    fromHex(fields.candidateHash, 32),
    fromHex(fields.certificateHash, 32),
    fromHex(fields.sellOrderHash, 32),
    fromHex(fields.buyOrderHash, 32),
    addressBytes(fields.scanner),
    uintBE(fields.clearingPrice, 16),
    uintBE(fields.feeAmount, 16),
    uintBE(fields.scannerReward, 16),
    uintBE(fields.committeeReward, 16),
    fromHex(fields.feePolicyHash, 32),
    fromHex(fields.settlementCalldataHash, 32),
    uintBE(fields.quorum, 1),
    uintBE(fields.signerCount, 1),
  )
}

export function encodeTradeMatchEvent(event: TradeMatchEvent): Uint8Array {
  return concatBytes(
    uintBE(event.version, 1),
    uintBE(event.classId, 1),
    uintBE(event.eventType, 2),
    fromHex(event.tipId, 32),
    uintBE(event.nonce, 8),
    encodeTradeMatchPayload(event),
  )
}

function assertClaimed(
  tipStateRoot: Hex,
  valueHash: Hex,
  claimedTipStateRoot?: Hex,
  claimedValueHash?: Hex,
): ModeAResult | null {
  if (claimedTipStateRoot !== undefined && !sameHex(claimedTipStateRoot, tipStateRoot)) {
    return fail(ERR_FSM_CLAIMED_MISMATCH, 'claimed tipStateRoot does not match Mode A replay')
  }
  if (claimedValueHash !== undefined && !sameHex(claimedValueHash, valueHash)) {
    return fail(ERR_FSM_CLAIMED_MISMATCH, 'claimed valueHash does not match Mode A replay')
  }
  return null
}

/**
 * Monotonic match / settlement transitions after TradeOpened.
 * Open → MatchProposed → MatchCertified → SettlementSubmitted → Settled | SettlementFailed.
 */
export function replayTradeMatchModeA(input: {
  parent: TradeParent
  order: TradeOpenedFields
  event: TradeMatchEvent
  buyer: Hex
  alreadySettledCertificate?: boolean
  claimedTipStateRoot?: Hex
  claimedValueHash?: Hex
}): ModeAResult {
  if (input.event.version !== 1 || input.event.classId !== TRADE_CLASS_ID) {
    return fail(ERR_FSM_DOMAIN, 'event domain or classId is not trade v1')
  }
  if (input.event.nonce !== input.parent.nonce + 1n) {
    return fail(ERR_FSM_BAD_NONCE, 'event nonce must be parent.nonce + 1')
  }
  if (!sameHex(input.event.sellOrderHash, input.order.sellerOrderHash)) {
    return fail(ERR_TRADE_MATCH_INVALID, 'match sellOrderHash must equal open sellerOrderHash')
  }
  if (input.event.clearingPrice < input.order.quoteAmount) {
    return fail(ERR_TRADE_MATCH_INVALID, 'clearingPrice must be >= ask')
  }
  const expectedFee = input.event.clearingPrice / 10_000n
  if (input.event.feeAmount !== expectedFee) {
    return fail(ERR_TRADE_MATCH_INVALID, 'feeAmount must be clearingPrice / 10000 (1 bps)')
  }
  const expectedScanner = expectedFee / 2n
  const expectedCommittee = expectedFee - expectedScanner
  if (input.event.scannerReward !== expectedScanner || input.event.committeeReward !== expectedCommittee) {
    return fail(ERR_TRADE_MATCH_INVALID, 'fee split must be 50/50 scanner/committee')
  }

  let nextState: number
  switch (input.event.eventType) {
    case EVENT_TRADE_MATCH_PROPOSED:
      if (input.parent.state !== TRADE_STATE_OPEN) {
        return fail(ERR_TRADE_BAD_PHASE, 'MatchProposed only from Open')
      }
      nextState = TRADE_STATE_MATCH_PROPOSED
      break
    case EVENT_TRADE_MATCH_CERTIFIED:
      if (input.parent.state !== TRADE_STATE_MATCH_PROPOSED) {
        return fail(ERR_TRADE_BAD_PHASE, 'MatchCertified only from MatchProposed')
      }
      if (input.event.signerCount < input.event.quorum || input.event.quorum < 1) {
        return fail(ERR_TRADE_CERT_QUORUM, 'certificate quorum not met')
      }
      nextState = TRADE_STATE_MATCH_CERTIFIED
      break
    case EVENT_TRADE_SETTLEMENT_SUBMITTED:
      if (input.parent.state !== TRADE_STATE_MATCH_CERTIFIED) {
        return fail(ERR_TRADE_BAD_PHASE, 'SettlementSubmitted only from MatchCertified')
      }
      nextState = TRADE_STATE_SETTLEMENT_SUBMITTED
      break
    case EVENT_TRADE_SETTLED:
      if (
        input.parent.state !== TRADE_STATE_MATCH_CERTIFIED &&
        input.parent.state !== TRADE_STATE_SETTLEMENT_SUBMITTED
      ) {
        return fail(ERR_TRADE_BAD_PHASE, 'Settled only from MatchCertified or SettlementSubmitted')
      }
      if (input.alreadySettledCertificate) {
        return fail(ERR_TRADE_SETTLE_REPLAY, 'certificate already settled on mock L1')
      }
      nextState = TRADE_STATE_SETTLED
      break
    case EVENT_TRADE_SETTLEMENT_FAILED:
      if (
        input.parent.state !== TRADE_STATE_MATCH_CERTIFIED &&
        input.parent.state !== TRADE_STATE_SETTLEMENT_SUBMITTED
      ) {
        return fail(ERR_TRADE_BAD_PHASE, 'SettlementFailed only from MatchCertified or SettlementSubmitted')
      }
      nextState = TRADE_STATE_SETTLEMENT_FAILED
      break
    default:
      return fail(ERR_FSM_NO_TRANSITION, 'unsupported match/settlement eventType')
  }

  const eventBytes = encodeTradeMatchEvent(input.event)
  const tipStateRoot = computeTradeTipStateRoot({
    state: nextState,
    nonce: input.event.nonce,
    order: input.order,
    buyer: input.buyer,
    tradeFeeAmount: input.event.feeAmount,
    candidateHash: input.event.candidateHash,
    certificateHash: input.event.certificateHash,
    scanner: input.event.scanner,
    clearingPrice: input.event.clearingPrice,
    settlementCalldataHash: input.event.settlementCalldataHash,
  })
  const valueHash = computeValueHash({
    tipStateRoot,
    eventBytes,
    parentTipStateRoot: input.parent.tipStateRoot,
  })
  const claimed = assertClaimed(
    tipStateRoot,
    valueHash,
    input.claimedTipStateRoot,
    input.claimedValueHash,
  )
  if (claimed !== null) return claimed
  return {
    ok: true,
    nextState,
    nonce: input.event.nonce,
    tipStateRoot,
    valueHash,
    bodyCommitment: keccak256(eventBytes),
    eventBytes,
  }
}

function encodeAssetOpenedPayload(fields: AssetOpenedFields): Uint8Array {
  return concatBytes(
    addressBytes(fields.owner),
    addressBytes(fields.assetToken),
    fromHex(fields.burnId, 32),
    uintBE(fields.notionalUsdc6, 16),
  )
}

export function encodeAssetOpenedEvent(event: AssetOpenedEvent): Uint8Array {
  return concatBytes(
    uintBE(event.version, 1),
    uintBE(event.classId, 1),
    uintBE(event.eventType, 2),
    fromHex(event.tipId, 32),
    uintBE(event.nonce, 8),
    encodeAssetOpenedPayload(event),
  )
}

export function computeAssetTipStateRoot(fields: {
  state: number
  nonce: bigint
  order: AssetOpenedFields
}): Hex {
  const values: Record<(typeof ASSET_STATE_PATHS)[number], Uint8Array> = {
    '/state': uintBE(fields.state, 1),
    '/nonce': uintBE(fields.nonce, 8),
    '/owner': addressBytes(fields.order.owner),
    '/assetToken': addressBytes(fields.order.assetToken),
    '/burnId': fromHex(fields.order.burnId, 32),
    '/notionalUsdc6': uintBE(fields.order.notionalUsdc6, 16),
  }
  const leaves = [...ASSET_STATE_PATHS]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((path) => leafBytes(path, values[path]))
  return merkleRoot(leaves)
}

function assetViewMatches(event: AssetOpenedFields, view: L1AssetBurnView): boolean {
  return (
    sameHex(event.owner, view.owner) &&
    sameHex(event.assetToken, view.assetToken) &&
    sameHex(event.burnId, view.burnId) &&
    event.notionalUsdc6 === view.notionalUsdc6
  )
}

export function replayAssetOpened(input: {
  parent: TradeParent
  event: AssetOpenedEvent
  l1AssetView: L1AssetBurnView
  claimedTipStateRoot?: Hex
  claimedValueHash?: Hex
}): ModeAResult {
  if (input.event.version !== 1 || input.event.classId !== ASSET_CLASS_ID) {
    return fail(ERR_FSM_DOMAIN, 'event domain or classId is not asset v1')
  }
  if (input.event.eventType !== EVENT_ASSET_OPENED) {
    return fail(ERR_FSM_NO_TRANSITION, 'unsupported eventType')
  }
  if (input.parent.state !== ASSET_STATE_NONE) {
    return fail(ERR_FSM_NO_TRANSITION, 'AssetOpened is only valid from None')
  }
  if (input.event.nonce !== input.parent.nonce + 1n) {
    return fail(ERR_FSM_BAD_NONCE, 'event nonce must be parent.nonce + 1')
  }
  if (!input.l1AssetView.live) {
    return fail(ERR_ASSET_L1_NOT_FOUND, 'cited L1 asset-burn view is not live')
  }
  if (!input.l1AssetView.burnActivated) {
    return fail(ERR_ASSET_BURN_NOT_ACTIVATED, 'lab asset-burn view is not activated')
  }
  if (!assetViewMatches(input.event, input.l1AssetView)) {
    return fail(ERR_ASSET_VIEW_MISMATCH, 'AssetOpened fields do not equal the cited L1 asset-burn view')
  }
  const eventBytes = encodeAssetOpenedEvent(input.event)
  const tipStateRoot = computeAssetTipStateRoot({
    state: ASSET_STATE_OPEN,
    nonce: input.event.nonce,
    order: input.event,
  })
  const valueHash = computeValueHash({
    tipStateRoot,
    eventBytes,
    parentTipStateRoot: input.parent.tipStateRoot,
  })
  if (input.claimedTipStateRoot !== undefined && !sameHex(input.claimedTipStateRoot, tipStateRoot)) {
    return fail(ERR_FSM_CLAIMED_MISMATCH, 'claimed tipStateRoot does not match Mode A replay')
  }
  if (input.claimedValueHash !== undefined && !sameHex(input.claimedValueHash, valueHash)) {
    return fail(ERR_FSM_CLAIMED_MISMATCH, 'claimed valueHash does not match Mode A replay')
  }
  return {
    ok: true,
    nextState: ASSET_STATE_OPEN,
    nonce: input.event.nonce,
    tipStateRoot,
    valueHash,
    bodyCommitment: keccak256(eventBytes),
    eventBytes,
  }
}

function encodeStorageOpenedPayload(fields: StorageOpenedFields): Uint8Array {
  return concatBytes(
    addressBytes(fields.owner),
    fromHex(fields.contentIndexHash, 32),
    uintBE(fields.accessPriceGb, 16),
  )
}

export function encodeStorageOpenedEvent(event: StorageOpenedEvent): Uint8Array {
  return concatBytes(
    uintBE(event.version, 1),
    uintBE(event.classId, 1),
    uintBE(event.eventType, 2),
    fromHex(event.tipId, 32),
    uintBE(event.nonce, 8),
    encodeStorageOpenedPayload(event),
  )
}

export function computeStorageTipStateRoot(fields: {
  state: number
  nonce: bigint
  order: StorageOpenedFields
}): Hex {
  const values: Record<(typeof STORAGE_STATE_PATHS)[number], Uint8Array> = {
    '/state': uintBE(fields.state, 1),
    '/nonce': uintBE(fields.nonce, 8),
    '/owner': addressBytes(fields.order.owner),
    '/contentIndexHash': fromHex(fields.order.contentIndexHash, 32),
    '/accessPriceGb': uintBE(fields.order.accessPriceGb, 16),
  }
  const leaves = [...STORAGE_STATE_PATHS]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((path) => leafBytes(path, values[path]))
  return merkleRoot(leaves)
}

function storageViewMatches(event: StorageOpenedFields, view: L1StorageView): boolean {
  return (
    sameHex(event.owner, view.owner) &&
    sameHex(event.contentIndexHash, view.contentIndexHash) &&
    event.accessPriceGb === view.accessPriceGb
  )
}

export function replayStorageOpened(input: {
  parent: TradeParent
  event: StorageOpenedEvent
  l1StorageView: L1StorageView
  claimedTipStateRoot?: Hex
  claimedValueHash?: Hex
}): ModeAResult {
  if (input.event.version !== 1 || input.event.classId !== STORAGE_CLASS_ID) {
    return fail(ERR_FSM_DOMAIN, 'event domain or classId is not storage v1')
  }
  if (input.event.eventType !== EVENT_STORAGE_OPENED) {
    return fail(ERR_FSM_NO_TRANSITION, 'unsupported eventType')
  }
  if (input.parent.state !== STORAGE_STATE_NONE) {
    return fail(ERR_FSM_NO_TRANSITION, 'StorageOpened is only valid from None')
  }
  if (input.event.nonce !== input.parent.nonce + 1n) {
    return fail(ERR_FSM_BAD_NONCE, 'event nonce must be parent.nonce + 1')
  }
  if (!input.l1StorageView.live) {
    return fail(ERR_STORAGE_L1_NOT_FOUND, 'cited L1 storage view is not live')
  }
  if (!input.l1StorageView.contentIndexPresent) {
    return fail(ERR_STORAGE_INDEX_MISSING, 'lab storage content index is not present')
  }
  if (!storageViewMatches(input.event, input.l1StorageView)) {
    return fail(ERR_STORAGE_VIEW_MISMATCH, 'StorageOpened fields do not equal the cited L1 storage view')
  }
  const eventBytes = encodeStorageOpenedEvent(input.event)
  const tipStateRoot = computeStorageTipStateRoot({
    state: STORAGE_STATE_OPEN,
    nonce: input.event.nonce,
    order: input.event,
  })
  const valueHash = computeValueHash({
    tipStateRoot,
    eventBytes,
    parentTipStateRoot: input.parent.tipStateRoot,
  })
  if (input.claimedTipStateRoot !== undefined && !sameHex(input.claimedTipStateRoot, tipStateRoot)) {
    return fail(ERR_FSM_CLAIMED_MISMATCH, 'claimed tipStateRoot does not match Mode A replay')
  }
  if (input.claimedValueHash !== undefined && !sameHex(input.claimedValueHash, valueHash)) {
    return fail(ERR_FSM_CLAIMED_MISMATCH, 'claimed valueHash does not match Mode A replay')
  }
  return {
    ok: true,
    nextState: STORAGE_STATE_OPEN,
    nonce: input.event.nonce,
    tipStateRoot,
    valueHash,
    bodyCommitment: keccak256(eventBytes),
    eventBytes,
  }
}

export function replayAssetGenesisBundle(bundle: AssetGenesisBundle): ModeAResult {
  return replayAssetOpened({
    parent: bundle.parent,
    event: bundle.event,
    l1AssetView: bundle.l1AssetView,
    ...(bundle.claimedTipStateRoot !== undefined ? { claimedTipStateRoot: bundle.claimedTipStateRoot } : {}),
    ...(bundle.claimedValueHash !== undefined ? { claimedValueHash: bundle.claimedValueHash } : {}),
  })
}

export function replayStorageGenesisBundle(bundle: StorageGenesisBundle): ModeAResult {
  return replayStorageOpened({
    parent: bundle.parent,
    event: bundle.event,
    l1StorageView: bundle.l1StorageView,
    ...(bundle.claimedTipStateRoot !== undefined ? { claimedTipStateRoot: bundle.claimedTipStateRoot } : {}),
    ...(bundle.claimedValueHash !== undefined ? { claimedValueHash: bundle.claimedValueHash } : {}),
  })
}

export function hexOfEventBytes(bytes: Uint8Array): Hex {
  return toHex(bytes)
}
