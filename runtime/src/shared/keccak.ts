/** Keccak-256 (Ethereum), not NIST SHA3. Isomorphic — do not import archive-a/b. */

const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
] as const

const RHO = [
  0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14,
] as const

function rotl64(value: bigint, shift: number): bigint {
  const n = BigInt(shift % 64)
  return ((value << n) | (value >> (64n - n))) & 0xffffffffffffffffn
}

function keccakF(lanes: BigUint64Array): void {
  const B = new BigUint64Array(25)
  for (let round = 0; round < 24; round += 1) {
    const C = new BigUint64Array(5)
    for (let x = 0; x < 5; x += 1) {
      C[x] = lanes[x]! ^ lanes[x + 5]! ^ lanes[x + 10]! ^ lanes[x + 15]! ^ lanes[x + 20]!
    }
    for (let x = 0; x < 5; x += 1) {
      const D = C[(x + 4) % 5]! ^ rotl64(C[(x + 1) % 5]!, 1)
      for (let y = 0; y < 5; y += 1) lanes[x + 5 * y]! ^= D
    }
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        const destX = y
        const destY = (2 * x + 3 * y) % 5
        B[destX + 5 * destY] = rotl64(lanes[x + 5 * y]!, RHO[x + 5 * y]!)
      }
    }
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        lanes[x + 5 * y] =
          B[x + 5 * y]! ^ (~B[((x + 1) % 5) + 5 * y]! & B[((x + 2) % 5) + 5 * y]!)
        lanes[x + 5 * y]! &= 0xffffffffffffffffn
      }
    }
    lanes[0]! ^= RC[round]!
  }
}

export function keccak256Bytes(input: Uint8Array): Uint8Array {
  const rate = 136
  const state = new Uint8Array(200)
  let offset = 0
  while (offset + rate <= input.length) {
    for (let i = 0; i < rate; i += 1) state[i]! ^= input[offset + i]!
    permute(state)
    offset += rate
  }
  const block = new Uint8Array(rate)
  const rest = input.subarray(offset)
  block.set(rest)
  block[rest.length]! ^= 0x01
  block[rate - 1]! ^= 0x80
  for (let i = 0; i < rate; i += 1) state[i]! ^= block[i]!
  permute(state)
  return state.slice(0, 32)
}

function permute(state: Uint8Array): void {
  const lanes = new BigUint64Array(25)
  const view = new DataView(state.buffer, state.byteOffset, 200)
  for (let i = 0; i < 25; i += 1) lanes[i] = view.getBigUint64(i * 8, true)
  keccakF(lanes)
  for (let i = 0; i < 25; i += 1) view.setBigUint64(i * 8, lanes[i]!, true)
}
