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

export const LAB_SELECTION_NOTE =
  'Lab SelectionLog. Beacon is keccak after freeze, not CoNET L1 CL RANDAO. HMAC attests are forgeable. Not an Archive Certificate. Not 30-day qualification.'

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
  minerCount: number
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
