import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createNewChainEngine } from '../src/archive/newchain/engine.js'
import {
  ERR_VALIDATOR_QUORUM_HMAC_CUTOVER,
  ERR_VALIDATOR_QUORUM_SIG,
  buildHmacLabValidatorQuorum,
  buildLabValidatorQuorum,
  isHmacValidatorQuorum,
  recoverLabValidatorAttestSigner,
  verifyEip712LabValidatorAttestation,
  verifyLabValidatorQuorum,
  verifyLabValidatorQuorumForRestore,
} from '../src/archive/newchain/validatorQuorum.js'
import { replayLabNewChainRequest } from '../src/archive/bft/labCandidate.js'
import { openArchiveStore } from '../src/archive/store.js'
import { labSeatingAddress } from '../src/archive/syncQualification/eip712.js'
import { keccak256Utf8, type Hex } from '../src/shared/bytes.js'
import { labRouteTableFromPeers } from '../src/shared/labRoute.js'
import {
  LAB_CLASS_ASSET,
  LAB_NEWCHAIN_NOTE,
  labChainNftIdFromRequestId,
  makeNewChainRequest,
  newChainRequestId,
} from '../src/shared/newchain.js'

const dirs: string[] = []

after(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

function subjectOf(label: string) {
  return {
    requestId: keccak256Utf8(`dle.test.p18.${label}.request`),
    valueHash: keccak256Utf8(`dle.test.p18.${label}.value`),
    tipStateRoot: keccak256Utf8(`dle.test.p18.${label}.tip`),
    bodyCommitment: keccak256Utf8(`dle.test.p18.${label}.body`),
  }
}

test('P18 cutover rejects HMAC and hmacForgeable Q_V quorums', () => {
  const subject = subjectOf('cutover')
  const hmac = buildHmacLabValidatorQuorum(subject)
  assert.equal(isHmacValidatorQuorum(hmac), true)
  const hmacVerified = verifyLabValidatorQuorum(hmac, subject)
  assert.equal(hmacVerified.ok, false)
  if (hmacVerified.ok) throw new Error('expected HMAC cutover')
  assert.equal(hmacVerified.reason, ERR_VALIDATOR_QUORUM_HMAC_CUTOVER)
  assert.equal(verifyLabValidatorQuorumForRestore(hmac, subject).ok, true)

  const labeled = { ...buildLabValidatorQuorum(subject), hmacForgeable: true as const }
  const labeledVerified = verifyLabValidatorQuorum(labeled, subject)
  assert.equal(labeledVerified.ok, false)
  if (labeledVerified.ok) throw new Error('expected labeled HMAC cutover')
  assert.equal(labeledVerified.reason, ERR_VALIDATOR_QUORUM_HMAC_CUTOVER)
})

test('P18 recoverAddress binds the seating key; tampered signature fails SIG', () => {
  const subject = subjectOf('bind')
  const quorum = buildLabValidatorQuorum(subject)
  const first = quorum.attestations[0]
  assert.ok(first)
  assert.equal(first.eip712, true)
  assert.equal(first.hmacForgeable, false)
  assert.equal(first.signer, labSeatingAddress(first.validatorId))
  assert.equal(verifyEip712LabValidatorAttestation(first, subject), true)
  assert.equal(recoverLabValidatorAttestSigner(first, subject), labSeatingAddress(first.validatorId))
  assert.equal(verifyLabValidatorQuorum(quorum, subject).ok, true)

  const wrongSigner = {
    ...quorum,
    attestations: quorum.attestations.map((row, index) =>
      index === 0 ? { ...row, signer: labSeatingAddress(quorum.committee[1] ?? '') } : row,
    ),
  }
  const mismatched = verifyLabValidatorQuorum(wrongSigner, subject)
  assert.equal(mismatched.ok, false)
  if (mismatched.ok) throw new Error('expected signer bind failure')
  assert.equal(mismatched.reason, ERR_VALIDATOR_QUORUM_SIG)

  const tampered = {
    ...quorum,
    attestations: quorum.attestations.map((row, index) =>
      index === 0 ? { ...row, signature: `0x${'11'.repeat(65)}` as Hex } : row,
    ),
  }
  const bad = verifyLabValidatorQuorum(tampered, subject)
  assert.equal(bad.ok, false)
  if (bad.ok) throw new Error('expected tampered SIG')
  assert.equal(bad.reason, ERR_VALIDATOR_QUORUM_SIG)
})

test('P18 keep-only restores disk HMAC Q_V and labels health EIP-712', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'dle-p18-qv-'))
  dirs.push(dataDir)
  const store = openArchiveStore(dataDir)
  const request = makeNewChainRequest({
    classId: LAB_CLASS_ASSET,
    nonce: 18,
    salt: keccak256Utf8('dle.test.p18.keep'),
  })
  const requestId = newChainRequestId(request)
  const replay = replayLabNewChainRequest(request)
  assert.equal(replay.ok, true)
  if (!replay.ok) throw new Error(replay.reason)
  const subject = {
    requestId,
    valueHash: replay.valueHash,
    tipStateRoot: replay.tipStateRoot,
    bodyCommitment: replay.bodyCommitment,
  }
  const chainNftId = labChainNftIdFromRequestId(requestId)
  const acceptedAt = '2026-08-16T00:00:00.000Z'
  store.persistNewChainState({
    schema: 'DleLabNewChainStateV1',
    labOnly: true,
    notL1Nft: true,
    records: [
      {
        requestId,
        chainNftId,
        classId: request.classId,
        className: 'asset',
        user: request.user,
        valueHash: replay.valueHash,
        tipStateRoot: replay.tipStateRoot,
        bodyCommitment: replay.bodyCommitment,
        acceptedAt,
        certificate: {
          schema: 'DleLabGenesisCertificateV1',
          labOnly: true,
          notProductionDepin: true,
          notL1Nft: true,
          notArchiveCertificate: true,
          note: LAB_NEWCHAIN_NOTE,
          requestId,
          chainNftId,
          classId: request.classId,
          className: 'asset',
          user: request.user,
          valueHash: replay.valueHash,
          tipStateRoot: replay.tipStateRoot,
          bodyCommitment: replay.bodyCommitment,
          height: '0x1',
          domainId: 'fd-p18',
          acceptedAt,
        },
        validatorQuorum: buildHmacLabValidatorQuorum(subject),
        archiveCertificatePending: true,
      },
    ],
  })

  const routeTable = labRouteTableFromPeers({ domainId: 'fd-p18', role: 'active' }, [])
  const engine = createNewChainEngine({ domainId: 'fd-p18', store, routeTable })
  assert.equal(engine.list().count, 1)
  const health = engine.health()
  assert.equal(health.newchainValidatorQuorumEip712, true)
  assert.equal(health.newchainHmacForgeable, false)
  const hmacVerified = verifyLabValidatorQuorum(buildHmacLabValidatorQuorum(subject), subject)
  assert.equal(hmacVerified.ok, false)
  if (hmacVerified.ok) throw new Error('expected live HMAC cutover')
  assert.equal(hmacVerified.reason, ERR_VALIDATOR_QUORUM_HMAC_CUTOVER)

  const accepted = engine.accept(
    makeNewChainRequest({
      classId: LAB_CLASS_ASSET,
      nonce: 19,
      salt: keccak256Utf8('dle.test.p18.accept'),
    }),
  )
  assert.equal(accepted.status, 200)
  const quorum = accepted.body.validatorQuorum as {
    eip712?: boolean
    hmacForgeable?: boolean
    validatorQuorumEip712?: boolean
  }
  assert.equal(quorum.eip712, true)
  assert.equal(quorum.hmacForgeable, false)
  assert.equal(quorum.validatorQuorumEip712, true)
  assert.equal(engine.list().count, 2)
})
