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
  ERR_FSM_BAD_NONCE,
  ERR_FSM_CLAIMED_MISMATCH,
  ERR_FSM_DOMAIN,
  ERR_FSM_NO_TRANSITION,
  ERR_TRADE_ESCROW_CUSTODY,
  ERR_TRADE_L1_NOT_FOUND,
  ERR_TRADE_SELLER_ORDER_MISMATCH,
  EVENT_TRADE_OPENED,
  TRADE_CLASS_ID,
  TRADE_STATE_NONE,
  TRADE_STATE_OPEN,
  TRADE_STATE_PATHS,
  type DepositBundle,
  type L1EscrowView,
  type ModeAResult,
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

export function hexOfEventBytes(bytes: Uint8Array): Hex {
  return toHex(bytes)
}
