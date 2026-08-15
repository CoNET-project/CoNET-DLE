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
