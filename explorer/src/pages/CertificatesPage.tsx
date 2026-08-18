import { HashCapsule } from '../components/HashCapsule'
import { JsonBlock } from '../components/JsonBlock'
import { OnDemandSelectionPanel } from '../components/OnDemandSelectionPanel'
import { StatusPill } from '../components/StatusPill'
import { MainPageShell } from '../components/TitleCapsule'
import {
  hashIndexCommittedInAcPill,
  officialStandbysReadyPill,
  parseClockIsNotQualification,
  parseExtraStandbyReadyDoesNotCount,
  parseHashIndexCommittedInAc,
  parseNewchainOfficialStandbysReady,
  parseNewchainStandbyReadyEip712,
  parseOfficialStandbyReadyCount,
  parseOfficialStandbysReady,
  parsePilotQualified,
  parsePilotRunning,
  parsePilotStartedAt,
  parseStandbyReadyEip712,
  parseWarmupStartedAt,
  pilotClockPill,
} from '../lib/labOverlays'
import { useExplorer } from '../providers/ExplorerProvider'

function healthCount(health: Record<string, unknown> | null, key: string): number | null {
  const value = health?.[key]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function healthFlag(health: Record<string, unknown> | null, key: string): boolean | null {
  const value = health?.[key]
  return typeof value === 'boolean' ? value : null
}

export function CertificatesPage() {
  const { snapshot } = useExplorer()
  const cert = snapshot.certificate
  const selection = snapshot.selection
  const selectionReady = selection?.available === true
  const newchainCount = healthCount(snapshot.health, 'newchainCount')
  const newchainPending = healthCount(snapshot.health, 'newchainArchivePending')
  const newchainCertified = healthCount(snapshot.health, 'newchainArchiveCertified')
  const newchainQuorum = healthCount(snapshot.health, 'newchainValidatorQuorum')
  const officialStandbysReady = parseOfficialStandbysReady(snapshot.health)
  const officialStandbyReadyCount = parseOfficialStandbyReadyCount(snapshot.health)
  const standbyReadyEip712 = parseStandbyReadyEip712(snapshot.health)
  const newchainOfficialStandbysReady = parseNewchainOfficialStandbysReady(snapshot.health)
  const newchainStandbyReadyEip712 = parseNewchainStandbyReadyEip712(snapshot.health)
  const extraStandbyReadyDoesNotCount = parseExtraStandbyReadyDoesNotCount(snapshot.health)
  const hashIndexCommittedInAc = parseHashIndexCommittedInAc(snapshot.health, cert)
  const officialReadyPill = officialStandbysReadyPill(officialStandbysReady)
  const hashIndexPill = hashIndexCommittedInAcPill(hashIndexCommittedInAc)
  const clockPill = pilotClockPill(parsePilotRunning(snapshot.health))
  const warmupStartedAt = parseWarmupStartedAt(snapshot.health)
  const pilotStartedAt = parsePilotStartedAt(snapshot.health)
  const clockIsNotQualification = parseClockIsNotQualification(snapshot.health)
  const pilotQualified = parsePilotQualified(snapshot.health)

  return (
    <MainPageShell title="Certificates">
      <div className="mb-4 flex flex-wrap gap-2">
        <StatusPill label={cert?.available ? 'Archive Certificate' : 'Empty AC'} tone={cert?.available ? 'ok' : 'warn'} />
        <StatusPill
          label={snapshot.tip?.finalized ? 'Finalized' : 'Not finalized'}
          tone={snapshot.tip?.finalized ? 'ok' : 'neutral'}
        />
        <StatusPill
          label={selectionReady && selection.endorsed ? 'SelectionLog endorsed' : 'SelectionLog pending'}
          tone={selectionReady && selection.endorsed ? 'ok' : 'warn'}
        />
        {newchainCertified !== null ? (
          <StatusPill
            label={`New-chain AC ${newchainCertified}`}
            tone={newchainCertified > 0 ? 'ok' : 'neutral'}
          />
        ) : null}
        {officialReadyPill ? <StatusPill label={officialReadyPill.label} tone={officialReadyPill.tone} /> : null}
        {hashIndexPill ? <StatusPill label={hashIndexPill.label} tone={hashIndexPill.tone} /> : null}
        {clockPill ? <StatusPill label={clockPill.label} tone={clockPill.tone} /> : null}
      </div>

      <section className="mb-6">
        <h2 className="text-sm font-semibold text-white">Archive Certificate</h2>
        <p className="mb-4 mt-2 text-sm leading-6 text-slate-400">
          {cert?.available
            ? 'This is a lab networked Archive Certificate (PrecommitQC) on TCP 27101. Votes are lab EIP-712 ArchiveBftVote. It is not a frozen EIP-712 L1 wrapper or corpus SSZ object, and it does not claim 30-day qualification. Hash-index, official-standby, and clock pills are read-only lab overlays — not seating, not production AC commitment, and not 30-day qualification.'
            : 'DLE tip finality is an Archive Certificate (PrecommitQC), not an L1 block. The empty state is honest until a lab networked AC is available. Overlay chips stay hidden when /health and the certificate omit those fields.'}
        </p>
        {typeof cert?.hash === 'string' && cert.hash.startsWith('0x') ? (
          <div className="mb-3">
            <HashCapsule value={cert.hash} to={`/hash/${cert.hash.toLowerCase()}`} />
          </div>
        ) : null}
        <div className="dle-glass rounded-2xl p-4">
          <JsonBlock
            value={{
              method: 'dle_getArchiveCertificate',
              certificate: cert,
              tip: snapshot.tip,
            }}
          />
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-semibold text-white">New-chain genesis</h2>
        <p className="mb-4 mt-2 text-sm leading-6 text-slate-400">
          Laboratory P6: Mode A replay plus a 5-of-7 validator EIP-712 ArchiveValidatorQuorumAttest
          (P18), then a per-chain 4-of-5 Archive Certificate. That AC uses the new chainNftId and
          never writes NFT 42. It is not an L1 birth certificate and not 30-day qualification.
          Clusters stay live archive groups. Official standby readiness (P22/P24) is a lab overlay:
          extra fd-08 does not count, and it is not seating.
        </p>
        <div className="dle-glass rounded-2xl p-4">
          <JsonBlock
            value={{
              source: 'GET /health',
              newchainCount,
              newchainArchivePending: newchainPending,
              newchainArchiveCertified: newchainCertified,
              newchainValidatorQuorum: newchainQuorum,
              newchainValidatorQuorumEip712: healthFlag(snapshot.health, 'newchainValidatorQuorumEip712'),
              newchainHmacForgeable: healthFlag(snapshot.health, 'newchainHmacForgeable'),
              officialStandbysReady,
              officialStandbyReadyCount,
              standbyReadyEip712,
              newchainOfficialStandbysReady,
              newchainStandbyReadyEip712,
              extraStandbyReadyDoesNotCount,
              hashIndexCommittedInAc,
              hashIndexRoot: cert?.hashIndexRoot ?? null,
              warmupStartedAt,
              pilotStartedAt,
              clockIsNotQualification,
              pilotQualified,
            }}
          />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-white">On-demand SelectionLog</h2>
        <p className="mb-4 mt-2 text-sm leading-6 text-slate-400">
          SelectionLog is the recomputable 7+2 draw after the waiting pool freezes. It is not an Archive Certificate,
          not a block, and not 30-day qualification. Lab beacon is freeze-then-bind lab keccak (P19), not CoNET L1 CL
          RANDAO. Live attests are EIP-712 ArchiveOnDemandAttest (P17). Wait hooks are not intra-group gossip
          (P20); lab HTTP is not production DePIN gossip.
        </p>
        <div className="dle-glass rounded-2xl p-4">
          <OnDemandSelectionPanel pool={snapshot.waitingPool} selection={selection} />
        </div>
        <div className="dle-glass mt-3 rounded-2xl p-4">
          <JsonBlock
            value={{
              method: 'dle_getSelectionLog',
              waitingPool: snapshot.waitingPool,
              selection,
            }}
          />
        </div>
      </section>
    </MainPageShell>
  )
}
