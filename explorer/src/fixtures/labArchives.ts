import { LAB_ARCHIVE_WALLETS } from './labArchiveWallets'
import type { LabArchiveRow } from '../types'

function walletFor(domainId: string): string {
  const wallet = LAB_ARCHIVE_WALLETS[domainId] ?? ''
  if (wallet === '0x0000000000000000000000000000000000000000') return ''
  return wallet
}

function row(
  partial: Omit<LabArchiveRow, 'health' | 'lastQuorumOk' | 'lastPeerOk' | 'heartbeats' | 'syncPhase' | 'seatingQualified' | 'participantWallet' | 'source'> & {
    participantWallet?: string
  },
): LabArchiveRow {
  return {
    health: 'unknown',
    lastQuorumOk: null,
    lastPeerOk: null,
    heartbeats: null,
    syncPhase: null,
    seatingQualified: false,
    participantWallet: partial.participantWallet ?? walletFor(partial.domainId),
    source: 'fixture',
    ...partial,
  }
}

/**
 * Full lab archive list for `/archives` (G1 + G2 + extras).
 * Home Archives metric uses only `officialVoting === true` (G1 5+2 = 7).
 * Copied into this subproject — do not import pilot hosts via `../..`.
 */
export const LAB_ARCHIVE_FIXTURES: LabArchiveRow[] = [
  // —— G1 official voting roster (5+2) ——
  row({
    domainId: 'fd-01-ionos-45',
    operatorDomainId: 'op-hosthatch-lease-45-132-74-220',
    hostId: 'host-hosthatch-45-132-74-220',
    provider: 'HostHatch, LLC',
    region: 'us-east-ny',
    publicIp: '45.132.74.220',
    labGroup: 'g1',
    officialVoting: true,
    role: 'active',
  }),
  row({
    domainId: 'fd-02-ionos-189',
    operatorDomainId: 'op-ionos-lease-216-225-197-189',
    hostId: 'host-ionos-216-225-197-189',
    provider: 'IONOS Inc.',
    region: 'us-east-ny',
    publicIp: '216.225.197.189',
    labGroup: 'g1',
    officialVoting: true,
    role: 'active',
  }),
  row({
    domainId: 'fd-03-ionos-98',
    operatorDomainId: 'op-hosthatch-lease-45-132-74-221',
    hostId: 'host-hosthatch-45-132-74-221',
    provider: 'HostHatch, LLC',
    region: 'us-east-ny',
    publicIp: '45.132.74.221',
    labGroup: 'g1',
    officialVoting: true,
    role: 'active',
  }),
  row({
    domainId: 'fd-04-hosthatch-tokyo1',
    operatorDomainId: 'op-hosthatch-lease-167-254-243-38',
    hostId: 'host-hosthatch-tokyo1-167-254-243-38',
    provider: 'HostHatch, LLC',
    region: 'ap-northeast-tokyo',
    publicIp: '167.254.243.38',
    labGroup: 'g1',
    officialVoting: true,
    role: 'active',
  }),
  row({
    domainId: 'fd-05-hosthatch-tokyo2',
    operatorDomainId: 'op-hosthatch-lease-170-205-39-67',
    hostId: 'host-hosthatch-tokyo2-170-205-39-67',
    provider: 'HostHatch, LLC',
    region: 'ap-northeast-tokyo',
    publicIp: '170.205.39.67',
    labGroup: 'g1',
    officialVoting: true,
    role: 'active',
  }),
  row({
    domainId: 'fd-06-ionos-174',
    operatorDomainId: 'op-lab-lease-70-35-205-77',
    hostId: 'host-lab-70-35-205-77',
    provider: 'IONOS Inc.',
    region: 'us-east-ny',
    publicIp: '70.35.205.77',
    labGroup: 'g1',
    officialVoting: true,
    role: 'standby',
  }),
  row({
    domainId: 'fd-07-ionos-207',
    operatorDomainId: 'op-ionos-lease-212-227-242-207',
    hostId: 'host-ionos-212-227-242-207',
    provider: 'IONOS Inc.',
    region: 'us-east-ny',
    publicIp: '212.227.242.207',
    labGroup: 'g1',
    officialVoting: true,
    role: 'standby',
  }),
  // —— G2 second lab group (M6; not Home voting seats) ——
  row({
    domainId: 'fd-g2-01-tokyo4',
    operatorDomainId: 'op-hosthatch-lease-170-205-39-135',
    hostId: 'host-hosthatch-tokyo4-170-205-39-135',
    provider: 'HostHatch, LLC',
    region: 'ap-northeast-tokyo',
    publicIp: '170.205.39.135',
    labGroup: 'g2',
    officialVoting: false,
    role: 'active',
  }),
  row({
    domainId: 'fd-g2-02-tokyo3',
    operatorDomainId: 'op-hosthatch-lease-167-254-243-162',
    hostId: 'host-hosthatch-tokyo3-167-254-243-162',
    provider: 'HostHatch, LLC',
    region: 'ap-northeast-tokyo',
    publicIp: '167.254.243.162',
    labGroup: 'g2',
    officialVoting: false,
    role: 'active',
  }),
  row({
    domainId: 'fd-g2-03-tokyo9',
    operatorDomainId: 'op-lab-lease-212-52-0-166',
    hostId: 'host-tokyo9-212-52-0-166',
    provider: 'HostHatch, LLC',
    region: 'ap-northeast-tokyo',
    publicIp: '212.52.0.166',
    labGroup: 'g2',
    officialVoting: false,
    role: 'active',
  }),
  row({
    domainId: 'fd-g2-04-tokyo8',
    operatorDomainId: 'op-lab-lease-212-52-0-165',
    hostId: 'host-tokyo8-212-52-0-165',
    provider: 'HostHatch, LLC',
    region: 'ap-northeast-tokyo',
    publicIp: '212.52.0.165',
    labGroup: 'g2',
    officialVoting: false,
    role: 'active',
  }),
  row({
    domainId: 'fd-g2-05-tokyo7',
    operatorDomainId: 'op-lab-lease-212-52-0-164',
    hostId: 'host-tokyo7-212-52-0-164',
    provider: 'HostHatch, LLC',
    region: 'ap-northeast-tokyo',
    publicIp: '212.52.0.164',
    labGroup: 'g2',
    officialVoting: false,
    role: 'active',
  }),
  row({
    domainId: 'fd-g2-06-tokyo6',
    operatorDomainId: 'op-lab-lease-212-52-0-160',
    hostId: 'host-tokyo6-212-52-0-160',
    provider: 'HostHatch, LLC',
    region: 'ap-northeast-tokyo',
    publicIp: '212.52.0.160',
    labGroup: 'g2',
    officialVoting: false,
    role: 'standby',
  }),
  row({
    domainId: 'fd-g2-07-tokyo5',
    operatorDomainId: 'op-lab-lease-212-52-0-149',
    hostId: 'host-tokyo5-212-52-0-149',
    provider: 'HostHatch, LLC',
    region: 'ap-northeast-tokyo',
    publicIp: '212.52.0.149',
    labGroup: 'g2',
    officialVoting: false,
    role: 'standby',
  }),
  // —— Extra joiners (P11 + Seoul; not official 5+2) ——
  row({
    domainId: 'fd-08-hosthatch-hk1',
    operatorDomainId: 'op-hosthatch-lease-167-104-98-104',
    hostId: 'host-hosthatch-hk1-167-104-98-104',
    provider: 'HostHatch, LLC',
    region: 'ap-east-hk',
    publicIp: '167.104.98.104',
    labGroup: 'extra',
    officialVoting: false,
    role: 'standby',
  }),
  row({
    domainId: 'fd-09-seoul-85-155-176-217',
    operatorDomainId: 'op-seoul-lease-85-155-176-217',
    hostId: 'host-seoul-85-155-176-217',
    provider: 'Lab Seoul',
    region: 'ap-northeast-seoul',
    publicIp: '85.155.176.217',
    labGroup: 'extra',
    officialVoting: false,
    role: 'standby',
  }),
  row({
    domainId: 'fd-10-seoul-85-155-176-5',
    operatorDomainId: 'op-seoul-lease-85-155-176-5',
    hostId: 'host-seoul-85-155-176-5',
    provider: 'Lab Seoul',
    region: 'ap-northeast-seoul',
    publicIp: '85.155.176.5',
    labGroup: 'extra',
    officialVoting: false,
    role: 'standby',
  }),
]

/** Official G1 seats for Home Archives KPI (always 7). */
export function officialVotingArchives(rows: LabArchiveRow[]): LabArchiveRow[] {
  return rows.filter((row) => row.officialVoting === true)
}
