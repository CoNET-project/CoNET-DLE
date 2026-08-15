import type { DleSelectionLogAvailable, DleWaitingPoolView } from '../types'

/** Copied from lab accept `ondemand-p3-accept.json`. Not a 30-day qualification claim. */
export const LAB_P3_ACCEPTED_AT = '2026-08-15T06:14:24.034Z'
export const LAB_P3_POOL_ROOT = '0x1a0895b0fb313bcf61b76b3a381d00a6ad80554ff47f2456a111ab8ca68def74'
export const LAB_P3_ROULETTE = '0x821aa566186a1608f5238778cd5788e9d8c12d328486ae27291f6510b6e61584'
export const LAB_P3_BEACON = '0x64b1ce4661950ebbb3cb8dfac57418e40e13103d216f45a209ee81bca7afe494'

const LAB_MINERS = [
  '0xa110000000000000000000000000000000000001',
  '0xa110000000000000000000000000000000000002',
  '0xa110000000000000000000000000000000000003',
  '0xa110000000000000000000000000000000000004',
  '0xa110000000000000000000000000000000000005',
  '0xa110000000000000000000000000000000000006',
  '0xa110000000000000000000000000000000000007',
  '0xa110000000000000000000000000000000000008',
  '0xa110000000000000000000000000000000000009',
] as const

const LAB_COMMITTEE = [
  '0xa110000000000000000000000000000000000002',
  '0xa110000000000000000000000000000000000001',
  '0xa110000000000000000000000000000000000005',
  '0xa110000000000000000000000000000000000008',
  '0xa110000000000000000000000000000000000007',
  '0xa110000000000000000000000000000000000004',
  '0xa110000000000000000000000000000000000006',
] as const

const LAB_STANDBYS = [
  '0xa110000000000000000000000000000000000009',
  '0xa110000000000000000000000000000000000003',
] as const

const LAB_ATTESTORS = [
  'fd-01-ionos-45',
  'fd-02-ionos-189',
  'fd-03-ionos-98',
  'fd-04-hosthatch-tokyo1',
  'fd-05-hosthatch-tokyo2',
] as const

export const LAB_WAITING_POOL_FIXTURE: DleWaitingPoolView = {
  schema: 'DleWaitingPoolV1',
  groupId: 'dle.lab.group.v1',
  epoch: 1,
  shardId: 'dle.lab.shard.v1',
  frozen: true,
  miners: [...LAB_MINERS],
  poolRoot: LAB_P3_POOL_ROOT,
  minerCount: 9,
  source: 'fixture',
}

export const LAB_SELECTION_FIXTURE: DleSelectionLogAvailable = {
  schema: 'DleLabSelectionLogV1',
  available: true,
  endorsed: true,
  epoch: 1,
  shardId: 'dle.lab.shard.v1',
  groupId: 'dle.lab.group.v1',
  poolRoot: LAB_P3_POOL_ROOT,
  beacon: LAB_P3_BEACON,
  roulette: LAB_P3_ROULETTE,
  committee: [...LAB_COMMITTEE],
  standbys: [...LAB_STANDBYS],
  attestors: [...LAB_ATTESTORS],
  quorum: 4,
  labBeacon: true,
  labOnly: true,
  note: 'Lab SelectionLog. Beacon is keccak after freeze, not CoNET L1 CL RANDAO. HMAC attests are forgeable. Not an Archive Certificate. Not 30-day qualification.',
  acceptedAt: LAB_P3_ACCEPTED_AT,
  source: 'fixture',
}
