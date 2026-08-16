import test from 'node:test'
import assert from 'node:assert/strict'
import { ZERO32 } from '../src/archive/bft/bytes.js'
import { labAssetGenesisBundle, labGenesisDepositBundle, labStorageGenesisBundle } from '../src/archive/bft/labCandidate.js'
import { replayAssetGenesisBundle, replayDepositBundle, replayModeA, replayStorageGenesisBundle } from '../src/archive/bft/modeA.js'
import {
  ERR_ASSET_BURN_NOT_ACTIVATED,
  ERR_FSM_BAD_NONCE,
  ERR_FSM_CLAIMED_MISMATCH,
  ERR_STORAGE_INDEX_MISSING,
  ERR_TRADE_ESCROW_CUSTODY,
  ERR_TRADE_L1_NOT_FOUND,
  ERR_TRADE_SELLER_ORDER_MISMATCH,
} from '../src/archive/bft/types.js'
import { keccak256Utf8 } from '../src/shared/bytes.js'
import { LAB_CLASS_ASSET, LAB_CLASS_STORAGE, makeNewChainRequest } from '../src/shared/newchain.js'

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

test('lab AssetOpened candidate replays from None to Open', () => {
  const bundle = labAssetGenesisBundle(
    makeNewChainRequest({ classId: LAB_CLASS_ASSET, nonce: 1, salt: keccak256Utf8('dle.test.asset.salt') }),
  )
  const result = replayAssetGenesisBundle(bundle)
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.nextState, 1)
    assert.equal(result.nonce, 1n)
    assert.equal(result.tipStateRoot, bundle.claimedTipStateRoot)
    assert.equal(result.valueHash, bundle.claimedValueHash)
  }
})

test('asset genesis rejects a bad nonce', () => {
  const bundle = labAssetGenesisBundle(
    makeNewChainRequest({ classId: LAB_CLASS_ASSET, nonce: 1, salt: keccak256Utf8('dle.test.asset.nonce') }),
  )
  bundle.event.nonce = 2n
  const result = replayAssetGenesisBundle(bundle)
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.code, ERR_FSM_BAD_NONCE)
})

test('asset genesis rejects an inactive lab burn view', () => {
  const bundle = labAssetGenesisBundle(
    makeNewChainRequest({ classId: LAB_CLASS_ASSET, nonce: 1, salt: keccak256Utf8('dle.test.asset.burn') }),
  )
  bundle.l1AssetView.burnActivated = false
  const result = replayAssetGenesisBundle(bundle)
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.code, ERR_ASSET_BURN_NOT_ACTIVATED)
})

test('lab StorageOpened candidate replays from None to Open', () => {
  const bundle = labStorageGenesisBundle(
    makeNewChainRequest({ classId: LAB_CLASS_STORAGE, nonce: 1, salt: keccak256Utf8('dle.test.storage.salt') }),
  )
  const result = replayStorageGenesisBundle(bundle)
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.nextState, 1)
    assert.equal(result.nonce, 1n)
    assert.equal(result.tipStateRoot, bundle.claimedTipStateRoot)
  }
})

test('storage genesis rejects a missing content index', () => {
  const bundle = labStorageGenesisBundle(
    makeNewChainRequest({ classId: LAB_CLASS_STORAGE, nonce: 1, salt: keccak256Utf8('dle.test.storage.index') }),
  )
  bundle.l1StorageView.contentIndexPresent = false
  const result = replayStorageGenesisBundle(bundle)
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.code, ERR_STORAGE_INDEX_MISSING)
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
