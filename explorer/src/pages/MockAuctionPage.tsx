import { useCallback, useEffect, useMemo, useState } from 'react'
import { Wallet } from 'ethers'
import { useNavigate } from 'react-router-dom'
import { DetailPageShell } from '../components/DetailPageShell'
import { HashCapsule } from '../components/HashCapsule'
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

type TradeMatchRow = {
  candidateHash: string
  phase?: string
  listTxHash?: string
  listError?: string
  settlementTxHash?: string
  settlementError?: string
  certificate?: { certificateHash?: string }
}

type TradeHealth = {
  tradeRpcCustodyMode?: string
  tradeOnChainSettleConfigured?: boolean
  tradeOnChainSettleMode?: string
  tradeListConfigured?: boolean
  tradeListMode?: string
  tradeMockL1Settlement?: string | null
}

/**
 * Local mock-L1 auction client surface.
 * Session-only lab private keys may sign submit/attest/list; never persisted.
 * Archive legality is never self-attested — custody is Archive-side when RPC configured.
 * Round 4: UI may POST /trade/settle (Archive holds authority key); shows settlementTxHash capsules.
 * Round 5: UI may POST /trade/list with session seller key so escrow exists before settle.
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
  const [executeOnChain, setExecuteOnChain] = useState(true)

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

  const tradeHealth = useMemo((): TradeHealth | null => {
    if (health === null || typeof health !== 'object') return null
    return health as TradeHealth
  }, [health])

  const matchRows = useMemo((): TradeMatchRow[] => {
    const tl = timeline as { matches?: TradeMatchRow[] } | null
    return Array.isArray(tl?.matches) ? tl.matches : []
  }, [timeline])

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
      const row = matchRows.find((m) => m.candidateHash.toLowerCase() === candidateHash.toLowerCase())
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

  const runList = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      if (!candidateHash) throw new Error('candidateHash required')
      if (!sellerPk.trim()) throw new Error('seller session private key required for list')
      // Lab only: Archive broadcasts list with request-scoped seller key (not stored).
      const out = await postJson('/trade/list', {
        candidateHash,
        sellerPrivateKey: sellerPk.trim(),
      })
      setActionLog(out)
      if (out.status >= 400) setError(String((out.body as { error?: string }).error ?? 'list failed'))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const runSettle = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      if (!candidateHash) throw new Error('candidateHash required')
      // Browser never holds certificateAuthority — Archive posts settle when executeOnChain.
      const out = await postJson('/trade/settle', {
        candidateHash,
        outcome: 'settled',
        executeOnChain,
      })
      setActionLog(out)
      if (out.status >= 400) setError(String((out.body as { error?: string }).error ?? 'settle failed'))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const inputClass =
    'w-full rounded-lg border border-slate-600 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500'

  const settleMode = tradeHealth?.tradeOnChainSettleMode ?? 'unknown'
  const custodyMode = tradeHealth?.tradeRpcCustodyMode ?? 'unknown'
  const onChainReady = tradeHealth?.tradeOnChainSettleConfigured === true
  const listMode = tradeHealth?.tradeListMode ?? 'unknown'
  const listReady = tradeHealth?.tradeListConfigured === true

  return (
    <DetailPageShell
      eyebrow="Mock L1 only"
      title="Auction match timeline"
      onBack={() => navigate('/')}
      pills={
        <>
          <StatusPill label="mockL1Only" tone="warn" />
          <StatusPill label="not production DePIN" tone="neutral" />
          <StatusPill label={`custody: ${custodyMode}`} tone="blue" />
          <StatusPill
            label={listReady ? `list: ${listMode}` : 'list: off'}
            tone={listReady ? 'ok' : 'warn'}
          />
          <StatusPill
            label={onChainReady ? `settle: ${settleMode}` : 'settle: off'}
            tone={onChainReady ? 'ok' : 'warn'}
          />
          <RefreshButton status={refreshStatus} onClick={() => void load()} />
        </>
      }
    >
      <p className="mb-6 max-w-3xl text-sm text-slate-300">
        Local archive routes <code className="text-cyan-200">/mockl1/*</code> and{' '}
        <code className="text-cyan-200">/trade/*</code>. Session private keys sign orders/attests/list only and
        are never persisted. Seller must <code className="text-cyan-200">list</code> NFT into escrow before
        Archive <code className="text-cyan-200">settle</code>. Custody and settle authority stay on Archive (
        <code className="text-cyan-200">MOCK_L1_*</code>) — this page never holds the authority key.
        WaitingPool / on-demand is not this ingress. Lab demo fake hashes ≠ local RPC{' '}
        <code className="text-cyan-200">settlementTxHash</code>.
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
        <h2 className="text-lg font-semibold text-white">
          Scan → candidate → Archive check → attest → list escrow → settle
        </h2>
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
        <label className="flex items-start gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={executeOnChain}
            onChange={(e) => setExecuteOnChain(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-500"
          />
          <span>
            Request Archive on-chain settle (
            <code className="text-cyan-200">executeOnChain</code>
            ).
            {onChainReady
              ? ' Authority key stays on Archive.'
              : ' Archive settle env not configured — expect failure if checked.'}
          </span>
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
          <button
            type="button"
            disabled={busy || !sellerPk.trim()}
            className="rounded-full bg-orange-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={() => void runList()}
            aria-label="List NFT into mock settlement escrow"
            aria-busy={busy}
          >
            List NFT escrow
          </button>
          <button
            type="button"
            disabled={busy}
            className="rounded-full bg-rose-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={() => void runSettle()}
            aria-label="Ask Archive to settle match"
          >
            Archive settle
          </button>
        </div>
        <p className="text-xs text-slate-500">
          List uses the seller session key above (must match sell maker). Required before on-chain settle.
          {listReady ? ` Archive list mode: ${listMode}.` : ' Archive list env not configured — list will fail.'}
        </p>
      </section>

      <section className="mb-8 space-y-3">
        <h2 className="text-lg font-semibold text-white">Settlement summary</h2>
        {matchRows.length === 0 ? (
          <p className="text-sm text-slate-400">No matches in last trusted timeline.</p>
        ) : (
          <ul className="space-y-3">
            {matchRows.map((m) => (
              <li
                key={m.candidateHash}
                className="rounded-xl border border-slate-700/70 bg-slate-950/50 px-4 py-3"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <StatusPill
                    label={m.phase ?? 'unknown'}
                    tone={
                      m.phase === 'settled'
                        ? 'ok'
                        : m.phase === 'settlement_failed'
                          ? 'bad'
                          : m.phase === 'match_certified' || m.phase === 'settlement_submitted'
                            ? 'warn'
                            : 'neutral'
                    }
                  />
                  <button
                    type="button"
                    className="text-xs text-cyan-300 underline-offset-2 hover:underline"
                    onClick={() => setCandidateHash(m.candidateHash)}
                  >
                    Use as candidate
                  </button>
                </div>
                <p className="mb-2 font-mono text-[11px] text-slate-400" title={m.candidateHash}>
                  candidate {m.candidateHash.slice(0, 18)}…
                </p>
                {m.listTxHash ? (
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-400">listTxHash</span>
                    <HashCapsule value={m.listTxHash} />
                  </div>
                ) : (
                  <p className="mb-2 text-xs text-slate-500">No listTxHash yet (list NFT escrow first).</p>
                )}
                {m.listError ? <p className="mb-2 text-xs text-amber-300">{m.listError}</p> : null}
                {m.settlementTxHash ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-400">settlementTxHash</span>
                    <HashCapsule value={m.settlementTxHash} />
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">No settlementTxHash yet (lab or pending).</p>
                )}
                {m.settlementError ? (
                  <p className="mt-2 text-xs text-rose-300">{m.settlementError}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
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
