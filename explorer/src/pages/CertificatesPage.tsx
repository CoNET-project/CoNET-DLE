import { HashCapsule } from '../components/HashCapsule'
import { JsonBlock } from '../components/JsonBlock'
import { OnDemandSelectionPanel } from '../components/OnDemandSelectionPanel'
import { StatusPill } from '../components/StatusPill'
import { MainPageShell } from '../components/TitleCapsule'
import { useExplorer } from '../providers/ExplorerProvider'

export function CertificatesPage() {
  const { snapshot } = useExplorer()
  const cert = snapshot.certificate
  const selection = snapshot.selection
  const selectionReady = selection?.available === true

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
      </div>

      <section className="mb-6">
        <h2 className="text-sm font-semibold text-white">Archive Certificate</h2>
        <p className="mb-4 mt-2 text-sm leading-6 text-slate-400">
          {cert?.available
            ? 'This is a lab networked Archive Certificate (PrecommitQC) on TCP 27101. It is not a frozen EIP-712 L1 wrapper or corpus SSZ object, and it does not claim 30-day qualification.'
            : 'DLE tip finality is an Archive Certificate (PrecommitQC), not an L1 block. The empty state is honest until a lab networked AC is available.'}
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

      <section>
        <h2 className="text-sm font-semibold text-white">On-demand SelectionLog</h2>
        <p className="mb-4 mt-2 text-sm leading-6 text-slate-400">
          SelectionLog is the recomputable 7+2 draw after the waiting pool freezes. It is not an Archive Certificate,
          not a block, and not 30-day qualification. Lab beacon is keccak after freeze, not CoNET L1 CL RANDAO. HMAC
          attests are forgeable.
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
