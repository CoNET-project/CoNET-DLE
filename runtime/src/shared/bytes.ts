import { keccak256Bytes } from './keccak.js'

export { keccak256Bytes }

export type Hex = `0x${string}`

export const ZERO32 = `0x${'00'.repeat(32)}` as Hex
export const ZERO20 = `0x${'00'.repeat(20)}` as Hex

export function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

export function uintBE(value: bigint | number, bytes: number): Uint8Array {
  const out = new Uint8Array(bytes)
  let n = typeof value === 'bigint' ? value : BigInt(value)
  if (n < 0n) throw new Error('uintBE refuses a negative value')
  for (let i = bytes - 1; i >= 0; i -= 1) {
    out[i] = Number(n & 0xffn)
    n >>= 8n
  }
  if (n !== 0n) throw new Error('uintBE overflow')
  return out
}

export function toHex(bytes: Uint8Array): Hex {
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}` as Hex
}

export function fromHex(value: string, expected?: number): Uint8Array {
  const hex = value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error('invalid hex')
  }
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  if (expected !== undefined && bytes.length !== expected) {
    throw new Error(`expected ${expected} bytes`)
  }
  return bytes
}

export function addressBytes(value: string): Uint8Array {
  const hex = value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value
  if (hex.length !== 40) throw new Error('address must be 20 bytes')
  return fromHex(`0x${hex.toLowerCase()}`, 20)
}

export function keccak256(data: Uint8Array): Hex {
  return toHex(keccak256Bytes(data))
}

export function keccak256Utf8(value: string): Hex {
  return keccak256(utf8(value))
}

export function bytesToBigInt(bytes: Uint8Array): bigint {
  let n = 0n
  for (const byte of bytes) n = (n << 8n) | BigInt(byte)
  return n
}
