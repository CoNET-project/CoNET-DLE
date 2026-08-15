import type { Hex } from '../bytes.js'

function labMiner(index: number): Hex {
  return `0xa11000000000000000000000000000000000000${index.toString(16)}` as Hex
}

/** Nine deterministic lab miners — enough for committee[7] + standby[2]. */
export const LAB_MINERS: readonly Hex[] = [
  labMiner(1),
  labMiner(2),
  labMiner(3),
  labMiner(4),
  labMiner(5),
  labMiner(6),
  labMiner(7),
  labMiner(8),
  labMiner(9),
]

/** Extra address used by daemon probe after the lab pool is frozen. */
export const LAB_DAEMON_PROBE_MINER = '0xa11000000000000000000000000000000000000a' as Hex

/** HTTP on-demand queue clients (not the 9 auto-seed lab miners). */
export const HTTP_QUEUE_CLIENT_COUNT = 30
const HTTP_QUEUE_MINER_PREFIX = '0xb1100000000000000000000000000000000000'

export function httpQueueMiner(index: number): Hex {
  if (!Number.isInteger(index) || index < 1 || index > HTTP_QUEUE_CLIENT_COUNT) {
    throw new Error(`http queue miner index must be 1..${HTTP_QUEUE_CLIENT_COUNT}`)
  }
  return `${HTTP_QUEUE_MINER_PREFIX}${index.toString(16).padStart(2, '0')}` as Hex
}

export const HTTP_QUEUE_MINERS: readonly Hex[] = Array.from(
  { length: HTTP_QUEUE_CLIENT_COUNT },
  (_, index) => httpQueueMiner(index + 1),
)

export function httpQueueMinersPresent(miners: readonly string[]): boolean {
  const set = new Set(miners.map((row) => row.toLowerCase()))
  return HTTP_QUEUE_MINERS.every((row) => set.has(row.toLowerCase()))
}
