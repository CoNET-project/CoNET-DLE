import { fromHex, type Hex } from '../../shared/bytes.js'

/** Execution-layer public RPCs. Never treat these as live CL RANDAO. */
export const FORBIDDEN_EL_RPC_HOSTS = [
  'publicrpc.conet.network',
  'rpc1.conet.network',
  'rpc.conet.network',
] as const

export type ClBeaconUnavailableReason = 'no_finalized_cl_view' | 'forbidden_el_rpc_as_cl'

export type ClBeaconProbeResult =
  | {
      available: false
      reason: ClBeaconUnavailableReason
      notClRandao: true
      publicrpcNotClRandao: true
    }
  | {
      available: true
      randomness: Hex
      source: 'injected-cl-view'
      notClRandao: true
      notProductionBeacon: true
      publicrpcNotClRandao: true
    }

export function isForbiddenElRpcAsCl(urlOrHost: string): boolean {
  const lower = urlOrHost.toLowerCase()
  return FORBIDDEN_EL_RPC_HOSTS.some((host) => lower.includes(host))
}

function normalizeBeaconHex(raw: string | undefined): Hex | null {
  if (raw === undefined) return null
  const trimmed = raw.trim()
  if (trimmed === '' || isForbiddenElRpcAsCl(trimmed)) return null
  try {
    fromHex(trimmed, 32)
    const hex = trimmed.startsWith('0x') || trimmed.startsWith('0X') ? trimmed.slice(2) : trimmed
    return `0x${hex.toLowerCase()}` as Hex
  } catch {
    return null
  }
}

/**
 * Read-only probe for a finalized CoNET CL randomness view.
 * Does **not** fetch `publicrpc` / `rpc1` / `rpc.conet.network`.
 * Default: unavailable (honest lab wait). Optional injected 32-byte hex is still
 * labeled non-production — it is not live CL RANDAO.
 */
export function probeFinalizedClRandomness(input?: {
  injectedRandomness?: string
  clViewUrl?: string
  env?: NodeJS.ProcessEnv
}): ClBeaconProbeResult {
  const unavailable = (reason: ClBeaconUnavailableReason): ClBeaconProbeResult => ({
    available: false,
    reason,
    notClRandao: true,
    publicrpcNotClRandao: true,
  })
  if (input?.clViewUrl !== undefined && isForbiddenElRpcAsCl(input.clViewUrl)) {
    return unavailable('forbidden_el_rpc_as_cl')
  }
  const env = input?.env ?? process.env
  const injected = input?.injectedRandomness ?? env.DLE_ARCHIVE_CL_FINALIZED_RANDOMNESS
  if (injected !== undefined && isForbiddenElRpcAsCl(injected)) {
    return unavailable('forbidden_el_rpc_as_cl')
  }
  const hex = normalizeBeaconHex(injected)
  if (hex !== null) {
    return {
      available: true,
      randomness: hex,
      source: 'injected-cl-view',
      notClRandao: true,
      notProductionBeacon: true,
      publicrpcNotClRandao: true,
    }
  }
  return unavailable('no_finalized_cl_view')
}
