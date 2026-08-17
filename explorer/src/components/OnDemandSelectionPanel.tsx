import { AddressCapsule } from './AddressCapsule'
import { HashCapsule } from './HashCapsule'
import { StatusPill } from './StatusPill'
import { formatInteger } from '../lib/format'
import type { DleSelectionLogView, DleWaitingPoolView } from '../types'

function MinerCapsule({ address }: { address: string }) {
  return (
    <AddressCapsule
      address={address}
      className="max-w-full border-cyan-400/25 bg-white/10 text-white/85"
    />
  )
}

export function OnDemandSelectionPanel({
  pool,
  selection,
}: {
  pool: DleWaitingPoolView | null
  selection: DleSelectionLogView | null
}) {
  const available = selection?.available === true ? selection : null
  const live = pool?.source === 'live' || selection?.source === 'live'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <StatusPill
          label={pool?.frozen === true ? 'Waiting pool frozen' : 'Waiting pool open'}
          tone={pool?.frozen === true ? 'ok' : 'warn'}
        />
        <StatusPill
          label={available?.endorsed === true ? 'Selection endorsed' : 'Selection not endorsed'}
          tone={available?.endorsed === true ? 'ok' : 'warn'}
        />
        <StatusPill label={live ? 'Live archive' : 'Lab accept snapshot'} tone={live ? 'ok' : 'neutral'} />
        <StatusPill label="Lab beacon ≠ L1 CL" tone="warn" />
        <StatusPill label="Hooks are not gossip" tone="warn" />
        <StatusPill label="Not an Archive Certificate" tone="neutral" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-200/60">poolRoot</p>
          <HashCapsule value={available?.poolRoot ?? pool?.poolRoot ?? ''} />
        </div>
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-200/60">roulette R_e</p>
          <HashCapsule value={available?.roulette ?? ''} />
        </div>
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-200/60">lab beacon</p>
          <HashCapsule value={available?.beacon ?? ''} />
        </div>
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-200/60">attestors</p>
          <p className="text-sm text-white">
            {formatInteger(available?.attestors.length ?? 0)} / Q_A {formatInteger(available?.quorum ?? 4)}
          </p>
        </div>
      </div>

      {available ? (
        <>
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-cyan-200/60">
              Committee 7
            </p>
            <div className="flex flex-wrap gap-2">
              {available.committee.map((address) => (
                <MinerCapsule key={address} address={address} />
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-cyan-200/60">
              Standbys 2
            </p>
            <div className="flex flex-wrap gap-2">
              {available.standbys.map((address) => (
                <MinerCapsule key={address} address={address} />
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-cyan-200/60">
              Active archive attestors
            </p>
            <div className="flex flex-wrap gap-2">
              {available.attestors.map((domainId) => (
                <StatusPill key={domainId} label={domainId} tone="blue" />
              ))}
            </div>
          </div>
        </>
      ) : (
        <p className="text-sm text-slate-400">
          {selection && selection.available === false
            ? selection.reason
            : 'SelectionLog is not available yet.'}
        </p>
      )}

      <p className="text-xs leading-5 text-slate-400">
        {available?.note ??
          'Lab SelectionLog. Beacon is freeze-then-bind lab keccak (P19), not CoNET L1 CL RANDAO. Instant labBeaconAfterFreeze(poolRoot) is contrast-only. Attests are EIP-712 ArchiveOnDemandAttest (P17). Wait hooks are not intra-group gossip (P20); lab HTTP is not production DePIN gossip. Not an Archive Certificate. Not 30-day qualification.'}
        {available?.acceptedAt ? ` Accepted ${available.acceptedAt}.` : ''}
      </p>
    </div>
  )
}
