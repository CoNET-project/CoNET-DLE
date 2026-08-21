import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CHAIN_CLASS_TRADE,
  makeMockL1Registration,
  parseMockL1BoundView,
  parseMockL1Registration,
} from '../src/shared/mockL1.js'
import { keccak256Utf8, type Hex } from '../src/shared/bytes.js'

const USER = '0x1111111111111111111111111111111111111111' as Hex
const REGISTRY = '0x2222222222222222222222222222222222222222' as Hex
const GENESIS = keccak256Utf8('dle.test.mockl1.genesis')

test('assignmentStatus must be BOUND (2)', () => {
  const bad = parseMockL1BoundView({
    live: true,
    mockL1Only: true,
    chainId: 31337,
    registry: REGISTRY,
    tokenId: '1',
    chainClass: CHAIN_CLASS_TRADE,
    chainOwner: USER,
    archiveGroupId: 'g1',
    assignmentStatus: 1,
    genesisAcHash: GENESIS,
  })
  assert.equal(bad.ok, false)
  if (!bad.ok) assert.match(bad.reason, /BOUND/)

  const ok = parseMockL1BoundView({
    live: true,
    mockL1Only: true,
    chainId: 31337,
    registry: REGISTRY,
    tokenId: '1',
    chainClass: CHAIN_CLASS_TRADE,
    chainOwner: USER,
    archiveGroupId: 'g1',
    assignmentStatus: 2,
    genesisAcHash: GENESIS,
  })
  assert.equal(ok.ok, true)
})

test('lab notL1Nft cannot be upgraded to MockL1 registration', () => {
  const reg = makeMockL1Registration({
    classId: CHAIN_CLASS_TRADE,
    user: USER,
    tokenId: '7',
    registry: REGISTRY,
    chainId: 31337,
    archiveGroupId: 'lab-group',
    genesisAcHash: GENESIS,
  })
  const upgraded = parseMockL1Registration({ ...reg, notL1Nft: true })
  assert.equal(upgraded.ok, false)
  if (!upgraded.ok) assert.match(upgraded.reason, /notL1Nft/)
})

test('makeMockL1Registration round-trips parseMockL1Registration', () => {
  const reg = makeMockL1Registration({
    classId: CHAIN_CLASS_TRADE,
    user: USER,
    tokenId: '42',
    registry: REGISTRY,
    chainId: 31337,
    archiveGroupId: 'g1',
    genesisAcHash: GENESIS,
  })
  const parsed = parseMockL1Registration(reg)
  assert.equal(parsed.ok, true)
  if (parsed.ok) {
    assert.equal(parsed.request.tokenId, '42')
    assert.equal(parsed.request.bound.assignmentStatus, 2)
    assert.equal(parsed.request.notLabNotL1Nft, true)
  }
})

test('rejects DleLab schema as MockL1 registration', () => {
  const lab = parseMockL1Registration({
    schema: 'DleLabNewChainRequestV1',
    mockL1Only: true,
    notProductionDepin: true,
    notLabNotL1Nft: true,
  })
  assert.equal(lab.ok, false)
})
