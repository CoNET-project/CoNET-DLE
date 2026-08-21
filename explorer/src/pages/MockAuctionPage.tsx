import { useCallback, useEffect, useState } from 'react'
import { Wallet } from 'ethers'
import { useNavigate } from 'react-router-dom'
import { DetailPageShell } from '../components/DetailPageShell'
import { JsonBlock } from '../components/JsonBlock'
import { RefreshButton } from '../components/RefreshButton'
import { StatusPill } from '../components/StatusPill'
import { useExplorer } from '../providers/ExplorerProvider'
import { useExplorerChrome } from '../providers/ExplorerChrome'
import type { RefreshStatus } from '../types'
import {
  buildUnsignedTradeOrder,
  certPersonalSignMessage,
  matchCandidateHashLocal,
  mockL1FeePolicyHashLocal,
  orderPersonalSignMessage,
  ORDER_SIDE_BUY,
  ORDER_SIDE_SELL,
} from '../lib/mockAuctionWire'

/**
 * Local mock-L1 auction client surface.
 * Session-only lab private keys may sign submit/attest; never persisted.
 * Archive legality is never self-attested — custody is Archive-side when RPC configured.
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
  const [health, setHealth] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionLog, setActionLog] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  // Session-only — never write to localStorage / IndexedDB.
  const [sellerPk, setSellerPk] = useState('')
  const [buyerPk, setBuyerPk] = useState('')
  const [attestPk, setAttestPk] = useState('')
  const [subjectNft, setSubjectNft] = useState('0x2222222222222222222222222222222222222222')
  const [subjectId, setSubjectId] = useState('1')
  const [quote, setQuote] = useState('0x3333333333333333333333333333333333333333')
  const [price, setPrice] = useState('1000000')
  const [chainNftId, setChainNftId] = useState('1')
  const [candidateHash, setCandidateHash] = useState('')
  const [scanner, setScanner] = useState('0x1111111111111111111111111111111111111111')

  useEffect(() => {
    setShowFooter(false)
    return () => setShowFooter(true)
  }, [setShowFooter])

  const load = useCallback(async () => {
    setRefreshStatus('loading')
    setError(null)
    try {
      const base = archiveUrl.replace(/\/$/, '')
      const [c, o, m, h] = await Promise.all([
        fetch(`${base}/mockl1/chains`).then(async (r) => ({ ok: r.ok, body: await r.json() })),
        fetch(`${base}/trade/orders`).then(async (r) => ({ ok: r.ok, body: await r.json() })),
        fetch(`${base}/trade/timeline`).then(async (r) => ({ ok: r.ok, body: await r.json() })),
        fetch(`${base}/health`).then(async (r) => ({ ok: r.ok, body: await r.json() })).catch(() => ({
          ok: false,
          body: null,
        })),
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
      if (h.ok) setHealth(h.body)
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

  const postJson = async (path: string, body: unknown) => {
    const res = await fetch(`${archiveUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    return { status: res.status, body: json }
  }

  const submitSide = async (side: 'sell' | 'buy') => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const pk = side === 'sell' ? sellerPk.trim() : buyerPk.trim()
      if (!pk) throw new Error(`${side} session private key required (lab only, not stored)`)
      const wallet = new Wallet(pk)
      const unsigned = buildUnsignedTradeOrder({
        side: side === 'sell' ? ORDER_SIDE_SELL : ORDER_SIDE_BUY,
        chainNftId,
        maker: wallet.address,
        subjectNftContract: subjectNft,
        subjectNftId: subjectId,
        quoteAsset: quote,
        price,
        amount: '1',
        nonce: String(Date.now()),
        deadline: String(Math.floor(Date.now() / 1000) + 3600),
        feePolicyHash: mockL1FeePolicyHashLocal(),
      })
      const signature = await wallet.signMessage(orderPersonalSignMessage(unsigned.orderHash))
      const out = await postJson('/trade/submit', { ...unsigned, signature })
      setActionLog(out)
      if (out.status >= 400) setError(String((out.body as { error?: string }).error ?? 'submit failed'))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const runScanAndCandidate = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const scan = await postJson('/trade/scan', { scanner })
      setActionLog(scan)
      const match = (scan.body as { match?: Record<string, unknown> }).match
      if (scan.status !== 200 || match === undefined) {
        setError(String((scan.body as { error?: string }).error ?? 'scan found no match'))
        return
      }
      const candidateHashValue = matchCandidateHashLocal({
        scanner: String(match.scanner),
        sellOrderHash: String(match.sellOrderHash),
        buyOrderHash: String(match.buyOrderHash),
        clearingPrice: String(match.clearingPrice),
      })
      const cand = { ...match, candidateHash: candidateHashValue }
      const out = await postJson('/trade/candidate', cand)
      setActionLog({ scan, candidate: out })
      setCandidateHash(candidateHashValue)
      if (out.status >= 400) setError(String((out.body as { error?: string }).error ?? 'candidate failed'))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const runCheck = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      if (!candidateHash) throw new Error('candidateHash required')
      // When Archive has MOCK_L1_RPC_*, client flags are ignored.
      const out = await postJson('/trade/check', {
        candidateHash,
        l1EscrowCustody: true,
        buyerBalanceOk: true,
        buyerAllowanceOk: true,
      })
      setActionLog(out)
      if (out.status >= 400) setError(String((out.body as { error?: string }).error ?? 'check failed'))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const runAttest = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      if (!candidateHash || !attestPk.trim()) throw new Error('candidateHash + committee session pk required')
      const wallet = new Wallet(attestPk.trim())
      const tl = timeline as { matches?: Array<{ candidateHash: string; certificate?: { certificateHash: string } }> } | null
      const row = tl?.matches?.find((m) => m.candidateHash.toLowerCase() === candidateHash.toLowerCase())
      const certHash = row?.certificate?.certificateHash
      if (!certHash) throw new Error('certificate not proposed yet — run Archive check first')
      const signature = await wallet.signMessage(certPersonalSignMessage(certHash))
      const out = await postJson('/trade/attest', {
        candidateHash,
        signer: wallet.address,
        signature,
      })
      setActionLog(out)
      if (out.status >= 400) setError(String((out.body as { error?: string }).error ?? 'attest failed'))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const inputClass =
    'w-full rounded-lg border border-slate-600 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500'

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
        <code className="text-cyan-200">/trade/*</code>. Session private keys sign orders here only for lab
        demos and are never persisted. Archive legality (custody) is Archive-side when{' '}
        <code className="text-cyan-200">MOCK_L1_RPC_URL</code> is set — this page does not self-attest
        escrow. WaitingPool / on-demand is not this ingress.
      </p>
      {error ? <p className="mb-4 text-sm text-amber-300">{error}</p> : null}

      <section className="mb-8 space-y-4 rounded-2xl border border-slate-700/80 bg-slate-900/40 p-4">
        <h2 className="text-lg font-semibold text-white">Submit signed orders (session keys)</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-slate-400">
            Seller private key (session)
            <input
              className={`${inputClass} mt-1 font-mono`}
              type="password"
              autoComplete="off"
              value={sellerPk}
              onChange={(e) => setSellerPk(e.target.value)}
              placeholder="0x… lab only"
            />
          </label>
          <label className="block text-xs text-slate-400">
            Buyer private key (session)
            <input
              className={`${inputClass} mt-1 font-mono`}
              type="password"
              autoComplete="off"
              value={buyerPk}
              onChange={(e) => setBuyerPk(e.target.value)}
              placeholder="0x… lab only"
            />
          </label>
          <label className="block text-xs text-slate-400">
            Subject NFT
            <input className={`${inputClass} mt-1`} value={subjectNft} onChange={(e) => setSubjectNft(e.target.value)} />
          </label>
          <label className="block text-xs text-slate-400">
            Subject token id
            <input className={`${inputClass} mt-1`} value={subjectId} onChange={(e) => setSubjectId(e.target.value)} />
          </label>
          <label className="block text-xs text-slate-400">
            Quote ERC-20
            <input className={`${inputClass} mt-1`} value={quote} onChange={(e) => setQuote(e.target.value)} />
          </label>
          <label className="block text-xs text-slate-400">
            Price (wei decimal)
            <input className={`${inputClass} mt-1`} value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
          <label className="block text-xs text-slate-400">
            Chain NFT id (mock L1)
            <input className={`${inputClass} mt-1`} value={chainNftId} onChange={(e) => setChainNftId(e.target.value)} />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            className="rounded-full bg-cyan-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={() => void submitSide('sell')}
          >
            Sign &amp; submit sell
          </button>
          <button
            type="button"
            disabled={busy}
            className="rounded-full bg-violet-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={() => void submitSide('buy')}
          >
            Sign &amp; submit buy
          </button>
        </div>
      </section>

      <section className="mb-8 space-y-4 rounded-2xl border border-slate-700/80 bg-slate-900/40 p-4">
        <h2 className="text-lg font-semibold text-white">Scan → candidate → Archive check → attest</h2>
        <label className="block text-xs text-slate-400">
          Scanner address
          <input className={`${inputClass} mt-1`} value={scanner} onChange={(e) => setScanner(e.target.value)} />
        </label>
        <label className="block text-xs text-slate-400">
          Candidate hash
          <input
            className={`${inputClass} mt-1 font-mono`}
            value={candidateHash}
            onChange={(e) => setCandidateHash(e.target.value)}
            placeholder="filled by scan+candidate"
          />
        </label>
        <label className="block text-xs text-slate-400">
          Committee signer private key (session)
          <input
            className={`${inputClass} mt-1 font-mono`}
            type="password"
            autoComplete="off"
            value={attestPk}
            onChange={(e) => setAttestPk(e.target.value)}
            placeholder="must be on drawn committee"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            className="rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-900 disabled:opacity-50"
            onClick={() => void runScanAndCandidate()}
          >
            Scan + candidate
          </button>
          <button
            type="button"
            disabled={busy}
            className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={() => void runCheck()}
          >
            Archive check
          </button>
          <button
            type="button"
            disabled={busy}
            className="rounded-full bg-amber-500 px-4 py-2 text-sm font-medium text-slate-900 disabled:opacity-50"
            onClick={() => void runAttest()}
          >
            Attest (committee)
          </button>
        </div>
      </section>

      <section className="mb-8 space-y-3">
        <h2 className="text-lg font-semibold text-white">Last action response</h2>
        <JsonBlock value={actionLog ?? { note: 'No action yet' }} />
      </section>
      <section className="mb-8 space-y-3">
        <h2 className="text-lg font-semibold text-white">Archive health (trade custody mode)</h2>
        <JsonBlock value={health ?? { note: 'No trusted response yet' }} />
      </section>
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
