import { keccak256Utf8 } from '../../shared/bytes.js'

export const OFFICIAL_ARCHIVE_NODE_COUNT = 7

export type QualificationReasonCode =
  | 'INSUFFICIENT_OFFICIAL_NODES'
  | 'INCONSISTENT_RELEASE'
  | 'INCONSISTENT_ROSTER'
  | 'INCONSISTENT_SNAPSHOT'
  | 'INCONSISTENT_FREEZE_CONFIGURATION'
  | 'STANDBY_CLASSIFICATION_DRIFT'
  | 'AC_NOT_COMMITTED'
  | 'AC_PENDING'
  | 'AC_SNAPSHOT_MISMATCH'
  | 'BFT_NOT_STARTED'
  | 'BFT_PREVOTE_INSUFFICIENT'
  | 'BFT_PRECOMMIT_INSUFFICIENT'
  | 'BFT_CERTIFICATE_UNAVAILABLE'
  | 'BFT_CERTIFICATE_STALE'
  | 'BFT_SIGNER_SET_MISMATCH'
  | 'PRODUCTION_CG_UNAVAILABLE'
  | 'LAB_BEACON_ONLY'
  | 'NON_PRODUCTION_DEPIN_GOSSIP'
  | 'TRADE_NOT_PRODUCTION'

export interface QualificationNodeEvidence {
  domainId: string
  role: 'active' | 'standby'
  releaseId: string
  commit: string
  rosterHash: string
  snapshotId: string
  freezeConfigHash: string
  officialStandby: boolean
  extraStandby: boolean
  ac: {
    committed: boolean
    pending: boolean
    snapshotId?: string
    hash?: string
    signerSet?: string[]
  }
  bft: {
    productionCertificate: boolean
    productionOperatorKey: boolean
    processStarted: boolean
    networked: boolean
    certificateAvailable: boolean
    prevoteCount: number
    precommitCount: number
    quorum: number
    certificateFresh: boolean
    signerSet?: string[]
    snapshotId?: string
    acHash?: string
  }
  cg: {
    available: boolean
    production: boolean
    labBeaconOnly: boolean
    productionDepin: boolean
  }
  trade?: {
    inScope: boolean
    production: boolean
    mock?: boolean
  }
}

export interface QualificationGateResult {
  schema: 'DlePilotQualificationGateV1'
  pilotQualified: false | true
  productionReadiness: false | true
  reasonCodes: QualificationReasonCode[]
  nodeCount: number
  officialNodeCount: number
  evidence: QualificationNodeEvidence[]
  release: { releaseId: string | null; commit: string | null; rosterHash: string | null }
  snapshot: { snapshotId: string | null; freezeConfigHash: string | null }
  trade: { inScope: boolean; production: boolean; excluded: boolean }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value !== ''))]
}

function allSame(values: readonly string[]): boolean {
  return unique(values).length <= 1 && values.length > 0
}

function addReason(reasons: QualificationReasonCode[], reason: QualificationReasonCode): void {
  if (!reasons.includes(reason)) reasons.push(reason)
}

/**
 * The gate is deliberately conservative. Missing evidence is a failure, not
 * an implicit success or a zero-valued production result.
 */
export function evaluatePilotQualification(
  nodes: readonly QualificationNodeEvidence[],
): QualificationGateResult {
  const reasons: QualificationReasonCode[] = []
  const official = nodes.filter((node) => node.officialStandby || node.role === 'active')
  if (official.length < OFFICIAL_ARCHIVE_NODE_COUNT) addReason(reasons, 'INSUFFICIENT_OFFICIAL_NODES')

  if (!allSame(official.map((node) => node.releaseId)) || !allSame(official.map((node) => node.commit))) {
    addReason(reasons, 'INCONSISTENT_RELEASE')
  }
  if (!allSame(official.map((node) => node.rosterHash))) addReason(reasons, 'INCONSISTENT_ROSTER')
  if (!allSame(official.map((node) => node.snapshotId))) addReason(reasons, 'INCONSISTENT_SNAPSHOT')
  if (!allSame(official.map((node) => node.freezeConfigHash))) {
    addReason(reasons, 'INCONSISTENT_FREEZE_CONFIGURATION')
  }
  if (nodes.some((node) =>
    node.extraStandby ||
    node.role === 'active' && node.officialStandby ||
    node.role === 'standby' && !node.officialStandby && !node.extraStandby
  )) {
    addReason(reasons, 'STANDBY_CLASSIFICATION_DRIFT')
  }

  for (const node of official) {
    if (!node.ac.committed) addReason(reasons, 'AC_NOT_COMMITTED')
    if (node.ac.pending) addReason(reasons, 'AC_PENDING')
    if (node.ac.snapshotId !== undefined && node.ac.snapshotId !== node.snapshotId) {
      addReason(reasons, 'AC_SNAPSHOT_MISMATCH')
    }
    if (node.ac.signerSet !== undefined && node.bft.signerSet !== undefined) {
      const acSigners = [...node.ac.signerSet].sort()
      const bftSigners = [...node.bft.signerSet].sort()
      if (acSigners.length !== bftSigners.length || acSigners.some((signer, index) => signer !== bftSigners[index])) {
        addReason(reasons, 'BFT_SIGNER_SET_MISMATCH')
      }
    } else if (node.ac.committed) {
      addReason(reasons, 'BFT_SIGNER_SET_MISMATCH')
    }
    if (!node.bft.processStarted) addReason(reasons, 'BFT_NOT_STARTED')
    if (!node.bft.networked) addReason(reasons, 'BFT_NOT_STARTED')
    if (node.bft.prevoteCount < node.bft.quorum) addReason(reasons, 'BFT_PREVOTE_INSUFFICIENT')
    if (node.bft.precommitCount < node.bft.quorum) addReason(reasons, 'BFT_PRECOMMIT_INSUFFICIENT')
    if (!node.bft.certificateAvailable) addReason(reasons, 'BFT_CERTIFICATE_UNAVAILABLE')
    if (!node.bft.productionCertificate) addReason(reasons, 'BFT_CERTIFICATE_UNAVAILABLE')
    if (!node.bft.productionOperatorKey) addReason(reasons, 'BFT_CERTIFICATE_UNAVAILABLE')
    if (!node.bft.certificateFresh) addReason(reasons, 'BFT_CERTIFICATE_STALE')
    if (node.bft.snapshotId !== undefined && node.bft.snapshotId !== node.snapshotId) {
      addReason(reasons, 'BFT_SIGNER_SET_MISMATCH')
    }
    if (!node.cg.available || !node.cg.production) addReason(reasons, 'PRODUCTION_CG_UNAVAILABLE')
    if (node.cg.labBeaconOnly) addReason(reasons, 'LAB_BEACON_ONLY')
    if (!node.cg.productionDepin) addReason(reasons, 'NON_PRODUCTION_DEPIN_GOSSIP')
  }

  const trade = nodes.find((node) => node.trade !== undefined)?.trade ?? {
    inScope: false,
    production: false,
    mock: true,
  }
  if (trade.inScope && !trade.production) addReason(reasons, 'TRADE_NOT_PRODUCTION')
  const tradeExcluded = !trade.inScope

  const releaseId = official[0]?.releaseId || null
  const commit = official[0]?.commit || null
  const rosterHash = official[0]?.rosterHash || null
  const snapshotId = official[0]?.snapshotId || null
  const freezeConfigHash = official[0]?.freezeConfigHash || null
  return {
    schema: 'DlePilotQualificationGateV1',
    pilotQualified: reasons.length === 0,
    productionReadiness: reasons.length === 0,
    reasonCodes: reasons,
    nodeCount: nodes.length,
    officialNodeCount: official.length,
    evidence: [...nodes],
    release: { releaseId, commit, rosterHash },
    snapshot: { snapshotId, freezeConfigHash },
    trade: { ...trade, excluded: tradeExcluded },
  }
}

export function snapshotIdOf(input: {
  rosterHash: string
  groupId: string
  hostedChainSetRoot: string
  lastACRef: string
  membershipRoot: string
  hashIndexRoot: string
  leafCount: number
}): string {
  return keccak256Utf8(JSON.stringify(input))
}
