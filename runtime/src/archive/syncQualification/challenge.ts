import { bytesToBigInt, concatBytes, fromHex, keccak256, keccak256Utf8, utf8, type Hex } from '../../shared/bytes.js'
import { proveHashIndex, verifyHashIndexProof } from '../../shared/hashIndexTree.js'
import { DLE_LAB_CHAIN_NFT_ID, isHashObjectKind, type HashLocatorV1 } from '../../shared/hashLookup.js'
import { getObjectLocal } from '../hop1.js'
import { projectHashObject, type HashStore } from '../hashStore.js'
import { probeFinalizedClRandomness, type ClBeaconProbeResult } from './clBeacon.js'
import {
  archiveStateChallengeMessage,
  labSeatingAddress,
  recoverArchiveStateChallenge,
  signArchiveStateChallenge,
} from './eip712.js'
import {
  ERR_SYNC_CHALLENGE_HMAC_CUTOVER,
  ERR_SYNC_CHALLENGE_SIG,
  LAB_SYNC_MAX_HOSTED_CHAINS,
  LAB_SYNC_OPEN_ALL_HOSTED_CHAINS,
  type ArchiveSyncFreezeV1,
  type SyncInventoryV1,
} from './types.js'
import type {
  ArchiveStateChallengeAnswerV1,
  ArchiveStateChallengeSampleV1,
  ArchiveStateChallengeV1,
  ChallengeSampleKind,
  SyncBeaconSource,
} from './types.js'

function sampleIndex(seed: Hex, salt: string, modulo: number): number {
  if (modulo <= 0) return 0
  const digest = keccak256(concatBytes(fromHex(seed, 32), utf8(salt)))
  return Number(bytesToBigInt(fromHex(digest, 32)) % BigInt(modulo))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function archiveCertificateCommitment(value: unknown): string | null {
  const cert = isRecord(value) && isRecord(value.certificate) ? value.certificate : value
  if (!isRecord(cert) || typeof cert.valueHash !== 'string') return null
  const membership = typeof cert.membershipRoot === 'string' ? cert.membershipRoot : ''
  const tip = typeof cert.tipStateRoot === 'string' ? cert.tipStateRoot : ''
  const body = typeof cert.bodyCommitment === 'string' ? cert.bodyCommitment : ''
  return `${cert.valueHash}|${membership}|${tip}|${body}`
}

function tipStateRootOf(value: unknown): string | null {
  if (!isRecord(value)) return null
  if (typeof value.tipStateRoot === 'string') return value.tipStateRoot
  if (isRecord(value.certificate) && typeof value.certificate.tipStateRoot === 'string') {
    return value.certificate.tipStateRoot
  }
  return null
}

function sampleBodiesMatch(kind: string, expected: unknown, got: unknown): boolean {
  if (expected === undefined || expected === null || got === undefined || got === null) return false
  if (JSON.stringify(expected) === JSON.stringify(got)) return true
  if (kind !== 'ac') return false
  const left = archiveCertificateCommitment(expected)
  const right = archiveCertificateCommitment(got)
  // Both sides already hold an AC / genesis stub: compare the commitment,
  // never fall through to tip (different valueHash can share a tip).
  if (left !== null && right !== null) return left === right
  // P8b: challenger already committed an AC — candidate must open the AC object.
  if (left !== null && right === null) return false
  // Genesis tip-first: expected has no AC body. Same tipStateRoot is enough
  // (including when the candidate answers with an AC that shares the tip).
  const leftTip = tipStateRootOf(expected)
  const rightTip = tipStateRootOf(got)
  return leftTip !== null && leftTip === rightTip
}

function pick<T>(items: readonly T[], seed: Hex, salt: string): T | undefined {
  if (items.length === 0) return undefined
  return items[sampleIndex(seed, salt, items.length)]
}

function tipHeight(locs: readonly HashLocatorV1[]): bigint {
  let max = 0n
  for (const locator of locs) {
    const height = BigInt(locator.height)
    if (height > max) max = height
  }
  return max
}

function toSample(locator: HashLocatorV1): ArchiveStateChallengeSampleV1 {
  return {
    chainNftId: locator.chainNftId,
    height: locator.height,
    kind: locator.kind,
    hash: locator.hash,
  }
}

function sampleKey(sample: ArchiveStateChallengeSampleV1): string {
  return `${sample.kind}:${sample.chainNftId}:${sample.height}:${sample.hash}`
}

export const LAB_SYNC_BEACON_AFTER_FREEZE_DOMAIN = 'dle.lab.sync.beacon.afterFreeze.v1'
export const LAB_SYNC_HONEST_WAIT_REVEAL_DOMAIN = 'dle.lab.sync.honestWait.v1'
export const LAB_SYNC_REVEAL_AFTER_FREEZE_DOMAIN = 'dle.lab.sync.reveal.afterFreeze.v1'

export function uniqueHostedChainNftIds(chainNftIds: readonly string[]): string[] {
  return [...new Set(chainNftIds.filter((id) => id !== ''))].sort((left, right) => left.localeCompare(right))
}

export function candidateSetRootOf(chainNftIds: readonly string[]): Hex {
  return keccak256Utf8(uniqueHostedChainNftIds(chainNftIds).join(','))
}

export function freezeHexOf(input: {
  hostedChainSetRoot: Hex
  lastACRef: Hex
  candidate: string
  nonce: number
  candidateSetRoot: Hex
}): Hex {
  return keccak256Utf8(
    `${input.hostedChainSetRoot}|${input.lastACRef}|${input.candidate}|${input.nonce}|${input.candidateSetRoot}`,
  )
}

/** Instant keccak(freezeHex). Contrast-only — not a post-freeze reveal. */
export function labSyncBeacon(freezeHex: Hex): Hex {
  return keccak256Utf8(`dle.lab.sync.beacon.v1|${freezeHex}`)
}

export function labHonestWaitReveal(freezeHex: Hex): Hex {
  return keccak256Utf8(`${LAB_SYNC_HONEST_WAIT_REVEAL_DOMAIN}|${freezeHex}`)
}

export function labSyncBeaconAfterFreeze(freezeHex: Hex, revealSalt: Hex): Hex {
  return keccak256Utf8(`${LAB_SYNC_BEACON_AFTER_FREEZE_DOMAIN}|${freezeHex}|${revealSalt}`)
}

export function postFreezeRevealSalt(input: {
  domainId: string
  freezeHex: Hex
  frozenAt: string
  revealMaterial: string
}): Hex {
  return keccak256Utf8(
    `${LAB_SYNC_REVEAL_AFTER_FREEZE_DOMAIN}|${input.domainId}|${input.freezeHex}|${input.frozenAt}|${input.revealMaterial}`,
  )
}

export function challengeSeedOf(input: {
  labBeacon: Hex
  groupId: string
  candidate: string
  nonce: number
  lastACRef: Hex
  hostedChainSetRoot: Hex
}): Hex {
  return keccak256(
    concatBytes(
      utf8('dle.archive.sync.challenge.v1'),
      fromHex(input.labBeacon, 32),
      fromHex(input.groupId, 32),
      utf8(input.candidate),
      utf8(String(input.nonce)),
      fromHex(input.lastACRef, 32),
      fromHex(input.hostedChainSetRoot, 32),
    ),
  )
}

export function challengeHashOf(challenge: {
  seed: Hex
  candidate: string
  nonce: number
  hashIndexRoot: Hex
}): Hex {
  return keccak256Utf8(
    `dle.archive.sync.challenge.hash.v1|${challenge.seed}|${challenge.candidate}|${challenge.nonce}|${challenge.hashIndexRoot}`,
  )
}

function sampleCommitment(sample: ArchiveStateChallengeSampleV1): string {
  return `${sample.chainNftId}|${sample.height}|${sample.kind}|${sample.hash}`
}

export function challengeSamplesRootOf(samples: readonly ArchiveStateChallengeSampleV1[]): Hex {
  return keccak256Utf8(samples.map(sampleCommitment).join(';'))
}

export function challengeSamplesMatchSeed(
  challenge: Pick<ArchiveStateChallengeV1, 'samples' | 'seed'>,
  inventory: Pick<SyncInventoryV1, 'locators' | 'chainNftIds'>,
): boolean {
  const expected = buildStratifiedSamples(inventory.locators, inventory.chainNftIds, challenge.seed)
  if (expected.length !== challenge.samples.length) return false
  return expected.every((sample, index) => sampleKey(sample) === sampleKey(challenge.samples[index]!))
}

export function isHmacChallenge(value: unknown): boolean {
  if (!isRecord(value) || value.schema !== 'ArchiveStateChallengeV1') return true
  if (value.hmacForgeable === true) return true
  if (value.eip712 !== true) return true
  if (typeof value.signature !== 'string' || !value.signature.startsWith('0x')) return true
  if (typeof value.signer !== 'string') return true
  if (typeof value.samplesRoot !== 'string') return true
  return false
}

export function verifyEip712Challenge(
  challenge: ArchiveStateChallengeV1,
): { ok: true; recovered: string } | { ok: false; error: string } {
  if (isHmacChallenge(challenge)) return { ok: false, error: ERR_SYNC_CHALLENGE_HMAC_CUTOVER }
  const expectedRoot = challengeSamplesRootOf(challenge.samples)
  if (challenge.samplesRoot.toLowerCase() !== expectedRoot.toLowerCase()) {
    return { ok: false, error: ERR_SYNC_CHALLENGE_SIG }
  }
  const expectedHash = challengeHashOf(challenge)
  if (challenge.challengeHash.toLowerCase() !== expectedHash.toLowerCase()) {
    return { ok: false, error: ERR_SYNC_CHALLENGE_SIG }
  }
  try {
    const recovered = recoverArchiveStateChallenge(
      archiveStateChallengeMessage({
        groupId: challenge.groupId,
        candidate: challenge.candidate,
        challenger: challenge.challenger,
        nonce: challenge.nonce,
        hostedChainSetRoot: challenge.hostedChainSetRoot,
        lastACRef: challenge.lastACRef,
        membershipRoot: challenge.membershipRoot,
        hashIndexRoot: challenge.hashIndexRoot,
        freezeHex: challenge.freezeHex,
        labBeacon: challenge.labBeacon,
        seed: challenge.seed,
        challengeHash: challenge.challengeHash,
        samplesRoot: challenge.samplesRoot,
      }),
      challenge.signature,
    )
    const expected = labSeatingAddress(challenge.challenger)
    if (recovered.toLowerCase() !== expected.toLowerCase()) {
      return { ok: false, error: ERR_SYNC_CHALLENGE_SIG }
    }
    if (challenge.signer.toLowerCase() !== expected.toLowerCase()) {
      return { ok: false, error: ERR_SYNC_CHALLENGE_SIG }
    }
    return { ok: true, recovered }
  } catch {
    return { ok: false, error: ERR_SYNC_CHALLENGE_SIG }
  }
}

export function attestLabChallenge(
  unsigned: Omit<
    ArchiveStateChallengeV1,
    | 'eip712'
    | 'hmacForgeable'
    | 'notProductionOperatorKey'
    | 'labDeterministicSeatingKey'
    | 'notL1Settled'
    | 'samplesRoot'
    | 'signer'
    | 'signature'
    | 'challengeHash'
  >,
): ArchiveStateChallengeV1 {
  const samplesRoot = challengeSamplesRootOf(unsigned.samples)
  const challengeHash = challengeHashOf(unsigned)
  const message = archiveStateChallengeMessage({
    groupId: unsigned.groupId,
    candidate: unsigned.candidate,
    challenger: unsigned.challenger,
    nonce: unsigned.nonce,
    hostedChainSetRoot: unsigned.hostedChainSetRoot,
    lastACRef: unsigned.lastACRef,
    membershipRoot: unsigned.membershipRoot,
    hashIndexRoot: unsigned.hashIndexRoot,
    freezeHex: unsigned.freezeHex,
    labBeacon: unsigned.labBeacon,
    seed: unsigned.seed,
    challengeHash,
    samplesRoot,
  })
  return {
    ...unsigned,
    eip712: true,
    hmacForgeable: false,
    notProductionOperatorKey: true,
    labDeterministicSeatingKey: true,
    notL1Settled: true,
    challengeHash,
    samplesRoot,
    signer: labSeatingAddress(unsigned.challenger),
    signature: signArchiveStateChallenge(unsigned.challenger, message),
  }
}

function groupLocatorsByChain(locators: readonly HashLocatorV1[]): Map<string, HashLocatorV1[]> {
  const grouped = new Map<string, HashLocatorV1[]>()
  for (const locator of locators) {
    const list = grouped.get(locator.chainNftId)
    if (list === undefined) grouped.set(locator.chainNftId, [locator])
    else list.push(locator)
  }
  return grouped
}

export function selectHostedChains(chainNftIds: readonly string[], seed: Hex): string[] {
  const unique = uniqueHostedChainNftIds(chainNftIds)
  if (LAB_SYNC_OPEN_ALL_HOSTED_CHAINS || LAB_SYNC_MAX_HOSTED_CHAINS <= 0 || unique.length <= LAB_SYNC_MAX_HOSTED_CHAINS) {
    return unique
  }
  const preferred = unique.filter((id) => id === DLE_LAB_CHAIN_NFT_ID || id === '42')
  const rest = unique.filter((id) => id !== DLE_LAB_CHAIN_NFT_ID && id !== '42')
  const ranked = rest
    .map((id) => ({ id, rank: sampleIndex(seed, `hosted|${id}`, 1_000_000_007) }))
    .sort((left, right) => left.rank - right.rank || left.id.localeCompare(right.id))
  const picked: string[] = [...preferred]
  for (const row of ranked) {
    if (picked.length >= LAB_SYNC_MAX_HOSTED_CHAINS) break
    picked.push(row.id)
  }
  return picked
}

export function openedHostedChainsOf(samples: readonly ArchiveStateChallengeSampleV1[]): string[] {
  return uniqueHostedChainNftIds(
    samples
      .filter((sample) => sample.kind !== 'hashIndex' && sample.kind !== 'emptyInventory' && sample.chainNftId !== '')
      .map((sample) => sample.chainNftId),
  )
}

export function labCgOpeningView(
  inventory: Pick<SyncInventoryV1, 'chainNftIds' | 'locators'>,
  seed: Hex,
): {
  hostedChainCount: number
  openedChainCount: number
  openedAllHostedChains: boolean
  sampleCount: number
} {
  const hosted = uniqueHostedChainNftIds(inventory.chainNftIds)
  const samples = buildStratifiedSamples(inventory.locators, inventory.chainNftIds, seed)
  const opened = new Set(openedHostedChainsOf(samples))
  const openedAllHostedChains = hosted.every((id) => opened.has(id))
  return {
    hostedChainCount: hosted.length,
    openedChainCount: opened.size,
    openedAllHostedChains,
    sampleCount: samples.length,
  }
}

export function challengeCoversLiveOpening(
  challenge: ArchiveStateChallengeV1,
  inventory: Pick<SyncInventoryV1, 'chainNftIds'>,
): boolean {
  if (challenge.openedAllHostedChains !== true) return false
  const hosted = uniqueHostedChainNftIds(inventory.chainNftIds)
  return challenge.hostedChainCount === hosted.length && challenge.openedChainCount === hosted.length
}

export function buildStratifiedSamples(
  locators: readonly HashLocatorV1[],
  chainNftIds: readonly string[],
  seed: Hex,
): ArchiveStateChallengeSampleV1[] {
  const hosted = selectHostedChains(chainNftIds, seed)
  if (hosted.length === 0 || locators.length === 0) {
    return [
      {
        chainNftId: '',
        height: '0x0',
        kind: 'emptyInventory',
        hash: seed,
      },
    ]
  }
  const samples: ArchiveStateChallengeSampleV1[] = []
  const seen = new Set<string>()
  const byChain = groupLocatorsByChain(locators)
  const push = (sample: ArchiveStateChallengeSampleV1 | undefined): void => {
    if (sample === undefined) return
    const key = sampleKey(sample)
    if (seen.has(key)) return
    seen.add(key)
    samples.push(sample)
  }
  for (const nft of hosted) {
    const locs = byChain.get(nft) ?? []
    if (locs.length === 0) continue
    const max = tipHeight(locs)
    const tipClass = locs.filter(
      (locator) =>
        (locator.kind === 'ac' || locator.kind === 'tipStateRoot') && BigInt(locator.height) === max,
    )
    push(toSample(pick(tipClass.length > 0 ? tipClass : locs, seed, `tip|${nft}`)!))
    if (max > 0n) {
      const history = locs.filter((locator) => BigInt(locator.height) < max)
      const picked = pick(history, seed, `history|${nft}`)
      if (picked !== undefined) push(toSample(picked))
    }
    const da = locs.filter((locator) => locator.kind === 'daRootProof')
    const daPicked = pick(da, seed, `da|${nft}`)
    if (daPicked !== undefined) push(toSample(daPicked))
  }
  const indexPool = locators.filter((locator) => locator.kind !== 'ac' && locator.kind !== 'tipStateRoot')
  const indexSource = indexPool.length > 0 ? indexPool : locators
  const indexLeaf = pick(indexSource, seed, 'hashIndex')
  if (indexLeaf !== undefined) {
    push({
      chainNftId: indexLeaf.chainNftId,
      height: indexLeaf.height,
      kind: 'hashIndex',
      hash: indexLeaf.hash,
    })
  }
  return samples
}

export function freezeMatchesInventory(
  freeze: ArchiveSyncFreezeV1,
  inventory: Pick<
    SyncInventoryV1,
    'groupId' | 'hostedChainSetRoot' | 'lastACRef' | 'membershipRoot' | 'hashIndexRoot' | 'chainNftIds'
  >,
): boolean {
  return (
    freeze.groupId === inventory.groupId &&
    freeze.hostedChainSetRoot === inventory.hostedChainSetRoot &&
    freeze.lastACRef === inventory.lastACRef &&
    freeze.membershipRoot === inventory.membershipRoot &&
    freeze.hashIndexRoot === inventory.hashIndexRoot &&
    freeze.candidateSetRoot === candidateSetRootOf(inventory.chainNftIds)
  )
}

export function freezeChallengeRoots(input: {
  inventory: SyncInventoryV1
  candidate: string
  challenger: string
  nonce: number
  now?: string
}): ArchiveSyncFreezeV1 {
  const candidateSetRoot = candidateSetRootOf(input.inventory.chainNftIds)
  const freezeHex = freezeHexOf({
    hostedChainSetRoot: input.inventory.hostedChainSetRoot,
    lastACRef: input.inventory.lastACRef,
    candidate: input.candidate,
    nonce: input.nonce,
    candidateSetRoot,
  })
  return {
    schema: 'ArchiveSyncFreezeV1',
    labOnly: true,
    beaconBound: false,
    waitingForClBeacon: true,
    notClRandao: true,
    notProductionBeacon: true,
    publicrpcNotClRandao: true,
    groupId: input.inventory.groupId,
    candidate: input.candidate,
    challenger: input.challenger,
    nonce: input.nonce,
    hostedChainSetRoot: input.inventory.hostedChainSetRoot,
    lastACRef: input.inventory.lastACRef,
    membershipRoot: input.inventory.membershipRoot,
    hashIndexRoot: input.inventory.hashIndexRoot,
    candidateSetRoot,
    freezeHex,
    frozenAt: input.now ?? new Date().toISOString(),
  }
}

export function bindChallengeBeacon(input: {
  freeze: ArchiveSyncFreezeV1
  inventory: SyncInventoryV1
  revealSalt?: Hex
  probe?: ClBeaconProbeResult
  boundAt?: string
}): ArchiveStateChallengeV1 {
  const probe = input.probe ?? probeFinalizedClRandomness()
  let labBeacon: Hex
  let beaconSource: SyncBeaconSource
  let clViewBound = false
  let labBeaconAfterFreeze = false
  let revealSalt: Hex | undefined
  if (probe.available) {
    labBeacon = probe.randomness
    beaconSource = 'injected-cl-view'
    clViewBound = true
  } else {
    revealSalt = input.revealSalt ?? labHonestWaitReveal(input.freeze.freezeHex)
    labBeacon = labSyncBeaconAfterFreeze(input.freeze.freezeHex, revealSalt)
    beaconSource = 'lab-after-freeze'
    labBeaconAfterFreeze = true
  }
  const seed = challengeSeedOf({
    labBeacon,
    groupId: input.freeze.groupId,
    candidate: input.freeze.candidate,
    nonce: input.freeze.nonce,
    lastACRef: input.freeze.lastACRef,
    hostedChainSetRoot: input.freeze.hostedChainSetRoot,
  })
  const samples = buildStratifiedSamples(input.inventory.locators, input.inventory.chainNftIds, seed)
  const hosted = uniqueHostedChainNftIds(input.inventory.chainNftIds)
  const opened = new Set(openedHostedChainsOf(samples))
  return attestLabChallenge({
    schema: 'ArchiveStateChallengeV1',
    labOnly: true,
    notClRandao: true,
    notProductionSecp256k1: true,
    notThirtyDayQualification: true,
    groupId: input.freeze.groupId,
    candidate: input.freeze.candidate,
    challenger: input.freeze.challenger,
    nonce: input.freeze.nonce,
    hostedChainSetRoot: input.freeze.hostedChainSetRoot,
    lastACRef: input.freeze.lastACRef,
    membershipRoot: input.freeze.membershipRoot,
    hashIndexRoot: input.freeze.hashIndexRoot,
    freezeHex: input.freeze.freezeHex,
    labBeacon,
    seed,
    hostedChainCount: hosted.length,
    openedChainCount: opened.size,
    openedAllHostedChains: hosted.every((id) => opened.has(id)),
    samples,
    candidateSetRoot: input.freeze.candidateSetRoot,
    beaconSource,
    clViewBound,
    labBeaconAfterFreeze,
    notProductionBeacon: true,
    waitingForClBeacon: false,
    publicrpcNotClRandao: true,
    ...(revealSalt !== undefined ? { revealSalt } : {}),
    frozenAt: input.freeze.frozenAt,
    boundAt: input.boundAt ?? new Date().toISOString(),
  })
}

export function buildChallenge(input: {
  inventory: SyncInventoryV1
  candidate: string
  challenger: string
  nonce: number
  revealSalt?: Hex
  probe?: ClBeaconProbeResult
}): ArchiveStateChallengeV1 {
  const freeze = freezeChallengeRoots({
    inventory: input.inventory,
    candidate: input.candidate,
    challenger: input.challenger,
    nonce: input.nonce,
  })
  return bindChallengeBeacon({
    freeze,
    inventory: input.inventory,
    revealSalt: input.revealSalt ?? labHonestWaitReveal(freeze.freezeHex),
    ...(input.probe !== undefined ? { probe: input.probe } : {}),
  })
}

export function answerChallengeLocal(
  store: HashStore,
  inventory: SyncInventoryV1,
  challenge: ArchiveStateChallengeV1,
): ArchiveStateChallengeAnswerV1 {
  const objects: unknown[] = []
  const indexProofs: ArchiveStateChallengeAnswerV1['indexProofs'] = []
  for (const sample of challenge.samples) {
    if (sample.kind === 'emptyInventory') {
      objects.push({
        schema: 'DleLabEmptyInventoryV1',
        hostedChainSetRoot: inventory.hostedChainSetRoot,
        lastACRef: inventory.lastACRef,
        hashIndexRoot: inventory.hashIndexRoot,
      })
      continue
    }
    if (sample.kind === 'hashIndex') {
      const proof = proveHashIndex(inventory.locators, sample.hash, inventory.groupId)
      if ('schema' in proof) indexProofs.push(proof)
      continue
    }
    if (!isHashObjectKind(sample.kind)) {
      objects.push(null)
      continue
    }
    const local = getObjectLocal(store, sample.chainNftId, sample.height)
    if (local.status !== 'hit') {
      objects.push(null)
      continue
    }
    const projected = projectHashObject(local.object, sample.kind)
    if (projected !== undefined) {
      objects.push(projected)
      continue
    }
    objects.push(sample.kind === 'ac' ? projectHashObject(local.object, 'tipStateRoot') ?? null : null)
  }
  return {
    schema: 'ArchiveStateChallengeAnswerV1',
    labOnly: true,
    candidate: challenge.candidate,
    nonce: challenge.nonce,
    seed: challenge.seed,
    hostedChainSetRoot: challenge.hostedChainSetRoot,
    lastACRef: challenge.lastACRef,
    membershipRoot: challenge.membershipRoot,
    hashIndexRoot: challenge.hashIndexRoot,
    objects,
    indexProofs,
    hopUsed: false,
    localOnly: true,
  }
}

export function gradeChallenge(input: {
  challenge: ArchiveStateChallengeV1
  answer: ArchiveStateChallengeAnswerV1
  expected: SyncInventoryV1
  store: HashStore
}): { ok: true } | { ok: false; reason: string } {
  if (input.answer.hopUsed === true || input.answer.localOnly !== true) {
    return { ok: false, reason: 'ERR_SYNC_HOP_DURING_CHALLENGE' }
  }
  if (input.answer.seed !== input.challenge.seed || input.answer.nonce !== input.challenge.nonce) {
    return { ok: false, reason: 'ERR_SYNC_SEED_MISMATCH' }
  }
  if (
    input.answer.hostedChainSetRoot !== input.challenge.hostedChainSetRoot ||
    input.answer.lastACRef !== input.challenge.lastACRef ||
    input.answer.membershipRoot !== input.challenge.membershipRoot ||
    input.answer.hashIndexRoot !== input.challenge.hashIndexRoot
  ) {
    return { ok: false, reason: 'ERR_SYNC_ROOT_MISMATCH' }
  }
  let objectAt = 0
  let proofAt = 0
  for (const sample of input.challenge.samples) {
    if (sample.kind === 'emptyInventory') {
      const got = input.answer.objects[objectAt]
      objectAt += 1
      if (got === null || got === undefined) return { ok: false, reason: 'ERR_SYNC_EMPTY_INVENTORY' }
      continue
    }
    if (sample.kind === 'hashIndex') {
      const proof = input.answer.indexProofs[proofAt]
      proofAt += 1
      if (proof === undefined || proof.kind !== 'inclusion' || !verifyHashIndexProof(proof)) {
        return { ok: false, reason: 'ERR_SYNC_INDEX_PROOF' }
      }
      if (proof.hash !== sample.hash || proof.hashIndexRoot !== input.challenge.hashIndexRoot) {
        return { ok: false, reason: 'ERR_SYNC_INDEX_PROOF' }
      }
      continue
    }
    const got = input.answer.objects[objectAt]
    objectAt += 1
    if (!isHashObjectKind(sample.kind)) return { ok: false, reason: 'ERR_SYNC_SAMPLE_KIND' }
    const local = getObjectLocal(input.store, sample.chainNftId, sample.height)
    if (local.status !== 'hit') return { ok: false, reason: `ERR_SYNC_CHALLENGER_MISSING:${sample.chainNftId}` }
    const expected =
      projectHashObject(local.object, sample.kind) ??
      (sample.kind === 'ac' ? projectHashObject(local.object, 'tipStateRoot') : undefined)
    if (expected === undefined || !sampleBodiesMatch(sample.kind, expected, got)) {
      return { ok: false, reason: `ERR_SYNC_OBJECT_MISMATCH:${sample.kind}:${sample.chainNftId}` }
    }
  }
  return { ok: true }
}

/** Voter freezer miss — never the candidate's fault. Skip reject; inbound is a no-op. */
export function isSyncChallengerMissingReason(reason: string): boolean {
  return reason.startsWith('ERR_SYNC_CHALLENGER_MISSING')
}

export function isChallengeSampleKind(value: unknown): value is ChallengeSampleKind {
  return (
    value === 'hashIndex' ||
    value === 'emptyInventory' ||
    (typeof value === 'string' && isHashObjectKind(value))
  )
}
