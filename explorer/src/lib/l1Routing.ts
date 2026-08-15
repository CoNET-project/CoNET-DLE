import {
  ARCHIVE_ROSTER_DOMAIN_IDS,
  ARCHIVES_OF_SELECTOR,
  BOOTSTRAP_GROUP_ID,
  CONET_GLOBAL_ARCHIVE_ROUTING_REGISTRY,
  CONET_L1_RPC_URLS,
  LIVE_GROUP_IDS_SELECTOR,
} from '../config/l1Routing'
import { isRecord } from './jsonrpc'

const FETCH_MS = 8_000
const TTL_MS = 30_000

export type ArchiveWalletMap = Map<string, string>

let cached:
  | { at: number; value: ArchiveWalletMap }
  | { at: number; value: null }
  | null = null
let inFlight: Promise<ArchiveWalletMap | null> | null = null

function padUint64(value: number): string {
  return value.toString(16).padStart(64, '0')
}

function decodeAddressWord(word: string): string | null {
  if (!/^0x[0-9a-fA-F]{64}$/.test(word) && !/^[0-9a-fA-F]{64}$/.test(word)) return null
  const hex = word.startsWith('0x') ? word.slice(2) : word
  const address = `0x${hex.slice(24)}`
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return null
  if (address === '0x0000000000000000000000000000000000000000') return null
  return address
}

function decodeAddressArray(data: string, expected: number): string[] | null {
  const hex = data.startsWith('0x') ? data.slice(2) : data
  if (hex.length < expected * 64) return null
  const addresses: string[] = []
  for (let i = 0; i < expected; i += 1) {
    const word = hex.slice(i * 64, (i + 1) * 64)
    const address = decodeAddressWord(word)
    if (!address) return null
    addresses.push(address)
  }
  return addresses
}

async function ethCall(rpcUrl: string, data: string): Promise<string | null> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to: CONET_GLOBAL_ARCHIVE_ROUTING_REGISTRY, data }, 'latest'],
    }),
    signal: AbortSignal.timeout(FETCH_MS),
  })
  if (!response.ok) return null
  const body: unknown = await response.json()
  if (!isRecord(body) || typeof body.result !== 'string' || !body.result.startsWith('0x')) {
    return null
  }
  return body.result
}

async function callFirstHealthy(data: string): Promise<string | null> {
  for (const rpcUrl of CONET_L1_RPC_URLS) {
    try {
      const result = await ethCall(rpcUrl, data)
      if (result) return result
    } catch {
      /* try next RPC */
    }
  }
  return null
}

async function fetchArchiveWalletsUncached(): Promise<ArchiveWalletMap | null> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(CONET_GLOBAL_ARCHIVE_ROUTING_REGISTRY)) return null
  const live = await callFirstHealthy(LIVE_GROUP_IDS_SELECTOR)
  if (live === null) return null
  const archivesHex = await callFirstHealthy(`${ARCHIVES_OF_SELECTOR}${padUint64(BOOTSTRAP_GROUP_ID)}`)
  if (archivesHex === null) return null
  const addresses = decodeAddressArray(archivesHex, ARCHIVE_ROSTER_DOMAIN_IDS.length)
  if (addresses === null) return null
  const unique = new Set(addresses.map((value) => value.toLowerCase()))
  if (unique.size !== ARCHIVE_ROSTER_DOMAIN_IDS.length) return null
  return new Map(ARCHIVE_ROSTER_DOMAIN_IDS.map((domainId, index) => [domainId, addresses[index]]))
}

export async function fetchArchiveWalletsFromL1(): Promise<ArchiveWalletMap | null> {
  const now = Date.now()
  if (cached && now - cached.at < TTL_MS) return cached.value
  if (inFlight) return inFlight
  inFlight = fetchArchiveWalletsUncached()
    .then((value) => {
      if (value) cached = { at: Date.now(), value }
      return value
    })
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

export function mergeArchivesWithL1Wallets<T extends { domainId: string; participantWallet: string }>(
  rows: T[],
  wallets: ArchiveWalletMap | null,
): T[] {
  if (wallets === null) return rows
  return rows.map((row) => {
    const next = wallets.get(row.domainId)
    if (!next) return row
    return { ...row, participantWallet: next }
  })
}
