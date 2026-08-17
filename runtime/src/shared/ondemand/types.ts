import type { Hex } from '../bytes.js'
import { DLE_LAB_GROUP_ID } from '../hashLookup.js'

export const VALIDATOR_COMMITTEE_SIZE = 7
export const VALIDATOR_STANDBY_SIZE = 2
export const VALIDATOR_QUORUM = 5
export const ARCHIVE_ATTEST_QUORUM = 4
export const MIN_WAIT_POOL = VALIDATOR_COMMITTEE_SIZE + VALIDATOR_STANDBY_SIZE

export const LAB_EPOCH = 1
export const LAB_SHARD_ID = 'dle.lab.shard.v1'
export const LAB_GROUP_ID = DLE_LAB_GROUP_ID
export const ROULETTE_DOMAIN = 'dle.roulette.v1'
export const WAIT_LEAF_DOMAIN = 'dle.wait.leaf.v1'
export const LAB_BEACON_DOMAIN = 'dle.lab.beacon.afterFreeze.v1'
export const LAB_ONDEMAND_FREEZE_DOMAIN = 'dle.lab.ondemand.freeze.v1'
export const LAB_ONDEMAND_BEACON_AFTER_FREEZE_DOMAIN = 'dle.lab.ondemand.beacon.afterFreeze.v1'
export const LAB_ONDEMAND_HONEST_WAIT_REVEAL_DOMAIN = 'dle.lab.ondemand.honestWait.reveal.v1'
export const LAB_ONDEMAND_REVEAL_AFTER_FREEZE_DOMAIN = 'dle.lab.ondemand.reveal.afterFreeze.v1'

export type OnDemandBeaconSource =
  | 'lab-after-freeze'
  | 'injected-cl-view'
  | 'options-beacon'
  | 'legacy-instant'

export const LAB_SELECTION_NOTE =
  'Lab SelectionLog. Beacon is freeze-then-bind lab keccak (P19), not CoNET L1 CL RANDAO. Instant labBeaconAfterFreeze(poolRoot) is contrast-only. Attests are EIP-712 ArchiveOnDemandAttest (P17). Not an Archive Certificate. Not 30-day qualification.'

export const ERR_ONDEMAND_HOOK_NOT_GOSSIP = 'ERR_ONDEMAND_HOOK_NOT_GOSSIP'

export const LAB_HOOK_QUEUED_NOTE =
  'Wait hook queued on this archive only. Hooks are not intra-group gossip. The miner or daemon must POST the same hook to every live archive. Laboratory HTTP is not production DePIN gossip.'

export const LAB_HOOK_FANOUT_QUEUED_NOTE =
  'Wait hook queued on every archive. Hooks are not intra-group gossip. Laboratory HTTP is not production DePIN gossip. Freeze poolRoot before drawing 7+2.'

export const LAB_HOOK_FANOUT_INCOMPLETE_NOTE =
  'Wait hook was not queued on every archive. One archive accept is not a group waiting pool. Hooks are not intra-group gossip.'

export const LAB_HOOK_SINGLE_ARCHIVE_NOTE =
  'Wait hook accepted on this archive only. One archive accept is not a group waiting pool. Use submitWaitHookToArchives for every live archive. Laboratory HTTP is not production DePIN gossip.'

export interface WaitMiner {
  address: Hex
  joinNonce: number
  joinedAt: string
}

export interface WaitingPoolView {
  schema: 'DleWaitingPoolV1'
  groupId: string
  epoch: number
  shardId: string
  frozen: boolean
  miners: Hex[]
  poolRoot: Hex | null
  freezeHex?: Hex | null
  minerCount: number
  hookNotGossip?: true
  mustFanoutToEveryActiveArchive?: true
  notProductionDepinGossip?: true
}

export interface SelectionLog {
  schema: 'DleLabSelectionLogV1'
  available: true
  endorsed: boolean
  epoch: number
  shardId: string
  groupId: string
  poolRoot: Hex
  beacon: Hex
  roulette: Hex
  committee: Hex[]
  standbys: Hex[]
  attestors: string[]
  quorum: typeof ARCHIVE_ATTEST_QUORUM
  labBeacon: true
  labOnly: true
  eip712?: true
  hmacForgeable?: false
  ondemandEip712?: true
  freezeBeforeBeacon?: true
  notProductionBeacon?: true
  ondemandLabBeaconAfterFreeze?: boolean
  ondemandBeaconSource?: OnDemandBeaconSource
  note: string
}

export interface SelectionUnavailable {
  schema: 'DleLabSelectionLogV1'
  available: false
  reason: string
}

export type SelectionView = SelectionLog | SelectionUnavailable

export interface DrawResult {
  miners: Hex[]
  poolRoot: Hex
  beacon: Hex
  roulette: Hex
  committee: Hex[]
  standbys: Hex[]
}
