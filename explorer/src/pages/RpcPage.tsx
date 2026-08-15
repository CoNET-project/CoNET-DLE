import { JsonBlock } from '../components/JsonBlock'
import { StatusPill } from '../components/StatusPill'
import { MainPageShell } from '../components/TitleCapsule'
import { useExplorer } from '../providers/ExplorerProvider'

export function RpcPage() {
  const { snapshot } = useExplorer()

  return (
    <MainPageShell title="JSON-RPC">
      <p className="mb-4 text-sm leading-6 text-slate-400">
        Read-only DLE facade, isolated from CoNET L1 <span className="dle-mono text-cyan-300">publicrpc</span>.{' '}
        <span className="dle-mono text-cyan-300">eth_call</span>,{' '}
        <span className="dle-mono text-cyan-300">eth_getBalance</span>, and write methods are rejected because there is
        no tip VM and no EVM account model. JSON-RPC 2.0 batches are accepted on <span className="dle-mono">/rpc</span>.
      </p>
      <div className="space-y-3">
        {snapshot.rpc.map((row) => (
          <article key={row.method} className="dle-glass rounded-2xl p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="dle-mono text-sm font-semibold text-white">{row.method}</p>
              <StatusPill
                label={row.status}
                tone={
                  row.status === 'ok' ? 'ok' : row.status === 'rejected' ? 'warn' : row.status === 'error' ? 'bad' : 'neutral'
                }
              />
            </div>
            <JsonBlock value={row.result} />
          </article>
        ))}
      </div>
    </MainPageShell>
  )
}
