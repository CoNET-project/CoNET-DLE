import {
  addressBytes,
  bytesToBigInt,
  concatBytes,
  fromHex,
  keccak256,
  keccak256Bytes,
  toHex,
  uintBE,
  utf8,
  type Hex,
} from '../bytes.js'
import {
  LAB_BEACON_DOMAIN,
  LAB_EPOCH,
  LAB_SHARD_ID,
  MIN_WAIT_POOL,
  ROULETTE_DOMAIN,
  VALIDATOR_COMMITTEE_SIZE,
  VALIDATOR_STANDBY_SIZE,
  WAIT_LEAF_DOMAIN,
  type DrawResult,
} from './types.js'

export function normalizeAddress(raw: string): Hex {
  const hex = raw.startsWith('0x') || raw.startsWith('0X') ? raw.slice(2) : raw
  if (hex.length !== 40 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error('invalid miner address')
  }
  return `0x${hex.toLowerCase()}` as Hex
}

export function sortAddresses(addresses: readonly string[]): Hex[] {
  return [...new Set(addresses.map(normalizeAddress))].sort()
}

export function lengthPrefixed(data: Uint8Array): Uint8Array {
  return concatBytes(uintBE(data.length, 4), data)
}

export function waitLeaf(address: string, joinNonce = 0): Hex {
  return keccak256(concatBytes(utf8(WAIT_LEAF_DOMAIN), addressBytes(address), uintBE(joinNonce, 8)))
}

export function merkleRoot(leaves: readonly Hex[]): Hex {
  if (leaves.length === 0) throw new Error('merkle root requires at least one leaf')
  let layer = leaves.map((leaf) => fromHex(leaf, 32))
  while (layer.length > 1) {
    const next: Uint8Array[] = []
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i]!
      const right = layer[i + 1]
      next.push(right === undefined ? left : keccak256Bytes(concatBytes(left, right)))
    }
    layer = next
  }
  return toHex(layer[0]!)
}

export function poolRootOf(addresses: readonly string[], joinNonce = 0): Hex {
  const sorted = sortAddresses(addresses)
  return merkleRoot(sorted.map((address) => waitLeaf(address, joinNonce)))
}

export function labBeaconAfterFreeze(poolRoot: Hex, epoch = LAB_EPOCH, shardId = LAB_SHARD_ID): Hex {
  return keccak256(concatBytes(utf8(LAB_BEACON_DOMAIN), fromHex(poolRoot, 32), uintBE(epoch, 8), utf8(shardId)))
}

export function rouletteSeed(input: {
  beacon: Hex
  epoch: number
  shardId: string
  poolRoot: Hex
}): Hex {
  return keccak256(
    concatBytes(
      lengthPrefixed(utf8(ROULETTE_DOMAIN)),
      lengthPrefixed(fromHex(input.beacon, 32)),
      uintBE(input.epoch, 8),
      lengthPrefixed(utf8(input.shardId)),
      lengthPrefixed(fromHex(input.poolRoot, 32)),
    ),
  )
}

export function fisherYates(sorted: readonly Hex[], roulette: Hex): Hex[] {
  const arr = [...sorted]
  let stream = fromHex(roulette, 32)
  for (let i = arr.length - 1; i > 0; i -= 1) {
    stream = keccak256Bytes(concatBytes(stream, uintBE(i, 4)))
    const j = Number(bytesToBigInt(stream) % BigInt(i + 1))
    const current = arr[i]!
    arr[i] = arr[j]!
    arr[j] = current
  }
  return arr
}

export function drawCommittee(input: {
  miners: readonly string[]
  epoch?: number
  shardId?: string
  beacon?: Hex
  joinNonce?: number
}): DrawResult {
  const miners = sortAddresses(input.miners)
  if (miners.length < MIN_WAIT_POOL) {
    throw new Error(`waiting pool needs at least ${MIN_WAIT_POOL} miners`)
  }
  const epoch = input.epoch ?? LAB_EPOCH
  const shardId = input.shardId ?? LAB_SHARD_ID
  const joinNonce = input.joinNonce ?? 0
  const poolRoot = poolRootOf(miners, joinNonce)
  const beacon = input.beacon ?? labBeaconAfterFreeze(poolRoot, epoch, shardId)
  const roulette = rouletteSeed({ beacon, epoch, shardId, poolRoot })
  const shuffled = fisherYates(miners, roulette)
  return {
    miners,
    poolRoot,
    beacon,
    roulette,
    committee: shuffled.slice(0, VALIDATOR_COMMITTEE_SIZE),
    standbys: shuffled.slice(VALIDATOR_COMMITTEE_SIZE, VALIDATOR_COMMITTEE_SIZE + VALIDATOR_STANDBY_SIZE),
  }
}

export function sameHexList(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((item, index) => item.toLowerCase() === right[index]!.toLowerCase())
}
