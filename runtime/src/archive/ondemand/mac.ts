import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { concatBytes, fromHex, toHex, uintBE, utf8, type Hex } from '../../shared/bytes.js'

export interface PoolAttest {
  schema: 'DleLabPoolAttestV1'
  domainId: string
  poolRoot: Hex
  epoch: number
  shardId: string
  roulette: Hex
  mac: Hex
}

function macKey(domainId: string): Buffer {
  return createHash('sha256').update(`dle.ondemand.lab.mac.v1|${domainId}`, 'utf8').digest()
}

export function attestCanonicalBytes(attest: Omit<PoolAttest, 'mac' | 'schema'>): Uint8Array {
  return concatBytes(
    utf8('dle.ondemand.lab.attest.v1'),
    fromHex(attest.poolRoot, 32),
    uintBE(attest.epoch, 8),
    utf8(attest.shardId),
    fromHex(attest.roulette, 32),
    utf8(attest.domainId),
  )
}

export function signLabPoolAttest(attest: Omit<PoolAttest, 'mac' | 'schema'>): Hex {
  return toHex(createHmac('sha256', macKey(attest.domainId)).update(attestCanonicalBytes(attest)).digest())
}

export function verifyLabPoolAttest(attest: PoolAttest): boolean {
  const expected = fromHex(signLabPoolAttest(attest), 32)
  let actual: Uint8Array
  try {
    actual = fromHex(attest.mac, 32)
  } catch {
    return false
  }
  if (actual.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
}
