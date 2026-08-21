import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DetailPageShell } from '../components/DetailPageShell'
import { JsonBlock } from '../components/JsonBlock'
import { RefreshButton } from '../components/RefreshButton'
import { StatusPill } from '../components/StatusPill'
import { useExplorer } from '../providers/ExplorerProvider'
import { useExplorerChrome } from '../providers/ExplorerChrome'
import type { RefreshStatus } from '../types'

/**
 * Local mock-L1 auction client surface.
 * Signs nothing as archive; only POSTs user-signed payloads / reads status.
 * mockL1Only — not production DePIN / not CoNET mainnet NFT.
 */
export function MockAuctionPage() {
  const navigate = useNavigate()
  const { archiveUrl } = useExplorer()
  const { setShowFooter } = useExplorerChrome()
  const [refreshStatus, setRefreshStatus] = useState<RefreshStatus>('idle')
  const [timeline, setTimeline] = useState<unknown>(null)
  const [orders, setOrders] = useState<unknown>(null)
  const [chains, setChains] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setShowFooter(false)
    return () => setShowFooter(true)
  }, [setShowFooter])

  const load = useCallback(async () => {
    setRefreshStatus('loading')
    setError(null)
    try {
      const base = archiveUrl.replace(/\/$/, '')
      const [c, o, m] = await Promise.all([
        fetch(`${base}/mockl1/chains`).then(async (r) => ({ ok: r.ok, body: await r.json() })),
        fetch(`${base}/trade/orders`).then(async (r) => ({ ok: r.ok, body: await r.json() })),
        fetch(`${base}/trade/timeline`).then(async (r) => ({ ok: r.ok, body: await r.json() })),
      ])
      if (!c.ok && !o.ok && !m.ok) {
        setRefreshStatus('error')
        setError('Archive mock-L1 / trade endpoints unavailable (keep last view if any).')
        window.setTimeout(() => setRefreshStatus('idle'), 3000)
        return
      }
      if (c.ok) setChains(c.body)
      if (o.ok) setOrders(o.body)
      if (m.ok) setTimeline(m.body)
      setRefreshStatus('success')
      window.setTimeout(() => setRefreshStatus('idle'), 3000)
    } catch {
      setRefreshStatus('error')
      setError('Fetch failed — previous trusted JSON kept when present.')
      window.setTimeout(() => setRefreshStatus('idle'), 3000)
    }
  }, [archiveUrl])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <DetailPageShell
      eyebrow="Mock L1 only"
      title="Auction match timeline"
      onBack={() => navigate('/')}
      pills={
        <>
          <StatusPill label="mockL1Only" tone="warn" />
          <StatusPill label="not production DePIN" tone="neutral" />
          <RefreshButton status={refreshStatus} onClick={() => void load()} />
        </>
      }
    >
      <p className="mb-6 max-w-3xl text-sm text-slate-300">
        Local archive routes <code className="text-cyan-200">/mockl1/*</code> and{' '}
        <code className="text-cyan-200">/trade/*</code>. This page only loads status; wallet signing and order
        submit stay in the CLI or a connected wallet. Archive legality is never self-attested here. WaitingPool
        / on-demand hook is not this ingress.
      </p>
      {error ? <p className="mb-4 text-sm text-amber-300">{error}</p> : null}
      <section className="mb-8 space-y-3">
        <h2 className="text-lg font-semibold text-white">Registered mock L1 chains</h2>
        <JsonBlock value={chains ?? { note: 'No trusted response yet' }} />
      </section>
      <section className="mb-8 space-y-3">
        <h2 className="text-lg font-semibold text-white">Open orders</h2>
        <JsonBlock value={orders ?? { note: 'No trusted response yet' }} />
      </section>
      <section className="mb-8 space-y-3">
        <h2 className="text-lg font-semibold text-white">Match / certificate / settlement timeline</h2>
        <JsonBlock value={timeline ?? { note: 'No trusted response yet' }} />
      </section>
    </DetailPageShell>
  )
}
