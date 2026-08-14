import { JsonBlock } from '../components/JsonBlock'
import { StatusPill } from '../components/StatusPill'
import { MainPageShell } from '../components/TitleCapsule'
import { useExplorer } from '../providers/ExplorerProvider'

export function CertificatesPage() {
  const { snapshot } = useExplorer()
  const cert = snapshot.certificate

  return (
    <MainPageShell title="Certificates">
      <div className="mb-4 flex flex-wrap gap-2">
        <StatusPill label={cert?.available ? 'Archive Certificate' : 'Empty AC'} tone={cert?.available ? 'ok' : 'warn'} />
        <StatusPill
          label={snapshot.tip?.finalized ? 'Finalized' : 'Not finalized'}
          tone={snapshot.tip?.finalized ? 'ok' : 'neutral'}
        />
      </div>
      <p className="mb-4 text-sm leading-6 text-slate-400">
        DLE tip finality is an Archive Certificate (PrecommitQC), not an L1 block. This scaffold has not produced a
        networked AC yet — the empty state is honest.
      </p>
      <div className="dle-glass rounded-2xl p-4">
        <JsonBlock
          value={{
            method: 'dle_getArchiveCertificate',
            certificate: cert,
            tip: snapshot.tip,
          }}
        />
      </div>
    </MainPageShell>
  )
}
