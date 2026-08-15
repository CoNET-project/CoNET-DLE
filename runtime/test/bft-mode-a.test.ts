import test from 'node:test'
import assert from 'node:assert/strict'
import { ZERO32 } from '../src/archive/bft/bytes.js'
import { labGenesisDepositBundle } from '../src/archive/bft/labCandidate.js'
import { replayDepositBundle, replayModeA } from '../src/archive/bft/modeA.js'
import {
  ERR_FSM_BAD_NONCE,
  ERR_FSM_CLAIMED_MISMATCH,
  ERR_TRADE_ESCROW_CUSTODY,
  ERR_TRADE_L1_NOT_FOUND,
  ERR_TRADE_SELLER_ORDER_MISMATCH,
} from '../src/archive/bft/types.js'

test('lab TradeOpened candidate replays from None to Open', () => {
  const bundle = labGenesisDepositBundle()
  const result = replayDepositBundle(bundle)
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.nextState, 1)
    assert.equal(result.nonce, 1n)
    assert.equal(result.tipStateRoot, bundle.claimedTipStateRoot)
    assert.equal(result.valueHash, bundle.claimedValueHash)
  }
})

test('bad nonce is rejected even when validatorQuorum is 5', () => {
  const bundle = labGenesisDepositBundle()
  bundle.event.nonce = 2n
  bundle.validatorQuorum = 5
  const result = replayDepositBundle(bundle)
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.code, ERR_FSM_BAD_NONCE)
})

test('missing live L1 escrow view is rejected', () => {
  const bundle = labGenesisDepositBundle()
  bundle.l1EscrowView.live = false
  const result = replayDepositBundle(bundle)
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.code, ERR_TRADE_L1_NOT_FOUND)
})

test('Settlement custody failure is rejected', () => {
  const bundle = labGenesisDepositBundle()
  bundle.l1EscrowView.settlementOwnsSubject = false
  const result = replayDepositBundle(bundle)
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.code, ERR_TRADE_ESCROW_CUSTODY)
})

test('seller-order mismatch is rejected', () => {
  const bundle = labGenesisDepositBundle()
  bundle.l1EscrowView.seller = '0x4444444444444444444444444444444444444444'
  const result = replayDepositBundle(bundle)
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.code, ERR_TRADE_SELLER_ORDER_MISMATCH)
})

test('claimed tipStateRoot mismatch is rejected after a successful replay shape', () => {
  const bundle = labGenesisDepositBundle()
  const result = replayModeA({
    parent: bundle.parent,
    event: bundle.event,
    l1EscrowView: bundle.l1EscrowView,
    claimedTipStateRoot: ZERO32,
  })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.code, ERR_FSM_CLAIMED_MISMATCH)
})
