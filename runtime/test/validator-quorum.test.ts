import { test } from 'node:test'
import assert from 'node:assert/strict'
import { labSeatingAddress } from '../src/archive/syncQualification/eip712.js'
import { keccak256Utf8 } from '../src/shared/bytes.js'
import {
  LAB_VALIDATOR_COUNT,
  LAB_VALIDATOR_QUORUM,
  buildLabValidatorQuorum,
  labValidatorCommittee,
  verifyLabValidatorQuorum,
} from '../src/archive/newchain/validatorQuorum.js'

test('lab Q_V is a deterministic 5-of-7 EIP-712 quorum', () => {
  const subject = {
    requestId: keccak256Utf8('dle.test.qv.request'),
    valueHash: keccak256Utf8('dle.test.qv.value'),
    tipStateRoot: keccak256Utf8('dle.test.qv.tip'),
    bodyCommitment: keccak256Utf8('dle.test.qv.body'),
  }
  const first = buildLabValidatorQuorum(subject)
  const second = buildLabValidatorQuorum(subject)
  assert.equal(first.schema, 'DleLabValidatorQuorumV1')
  assert.equal(first.hmacForgeable, false)
  assert.equal(first.eip712, true)
  assert.equal(first.validatorQuorumEip712, true)
  assert.equal(first.notProductionSecp256k1, true)
  assert.equal(first.quorum, LAB_VALIDATOR_QUORUM)
  assert.equal(first.committee.length, LAB_VALIDATOR_COUNT)
  assert.deepEqual(first.committee, labValidatorCommittee(subject.requestId))
  assert.deepEqual(first.attestations, second.attestations)
  assert.equal(first.attestations[0]?.signer, labSeatingAddress(first.committee[0] ?? ''))
  assert.equal(verifyLabValidatorQuorum(first, subject).ok, true)
})

test('fewer than five valid validator EIP-712 attests is rejected', () => {
  const subject = {
    requestId: keccak256Utf8('dle.test.qv.short'),
    valueHash: keccak256Utf8('dle.test.qv.short.value'),
    tipStateRoot: keccak256Utf8('dle.test.qv.short.tip'),
    bodyCommitment: keccak256Utf8('dle.test.qv.short.body'),
  }
  const quorum = buildLabValidatorQuorum(subject)
  quorum.attestations = quorum.attestations.slice(0, 4)
  const verified = verifyLabValidatorQuorum(quorum, subject)
  assert.equal(verified.ok, false)
  if (verified.ok) throw new Error('expected rejection')
  assert.match(verified.reason, /needs 5/)
})

test('validator committee is bound to requestId', () => {
  const subject = {
    requestId: keccak256Utf8('dle.test.qv.bind.a'),
    valueHash: keccak256Utf8('dle.test.qv.bind.value'),
    tipStateRoot: keccak256Utf8('dle.test.qv.bind.tip'),
    bodyCommitment: keccak256Utf8('dle.test.qv.bind.body'),
  }
  const quorum = buildLabValidatorQuorum(subject)
  const other = {
    ...subject,
    requestId: keccak256Utf8('dle.test.qv.bind.b'),
  }
  assert.equal(verifyLabValidatorQuorum(quorum, other).ok, false)
})
