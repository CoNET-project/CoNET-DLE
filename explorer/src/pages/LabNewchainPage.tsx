import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DetailPageShell } from '../components/DetailPageShell'
import { HashCapsule } from '../components/HashCapsule'
import { JsonBlock } from '../components/JsonBlock'
import { RefreshButton } from '../components/RefreshButton'
import { StatusPill } from '../components/StatusPill'
import { Web3WalletBar } from '../components/Web3WalletBar'
import { useWeb3Wallet } from '../hooks/useWeb3Wallet'
import {
  LAB_CLASS_ASSET,
  LAB_CLASS_STORAGE,
  LAB_CLASS_TRADE,
  LAB_NEWCHAIN_NOTE,
  chainsOwnedBy,
  classNameOf,
  labChainNftIdFromRequestId,
  labNewchainOwnershipMessage,
  makeNewChainRequest,
  newChainRequestId,
  parseLabNewChainList,
  randomSaltHex,
  type LabChainClassId,
  type LabNewChainListItem,
  type Hex,
} from '../lib/labNewchainWire'
import { useExplorer } from '../providers/ExplorerProvider'
import { useExplorerChrome } from '../providers/ExplorerChrome'
import type { RefreshStatus } from '../types'

type ClassChoice = {
  id: LabChainClassId
  label: string
  hint: string
}

type SubmitResult =
  | {
      ok: true
      httpStatus: number
      duplicate: boolean
      requestId: Hex
      chainNftId: string
      className: string
      valueHash?: string
    }
  | {
      ok: false
      httpStatus: number | null
      reason: string
      detail?: string
    }

const CLASS_CHOICES: ClassChoice[] = [
  { id: LAB_CLASS_ASSET, label: 'Asset', hint: 'classId=1 — lab asset chain' },
  { id: LAB_CLASS_STORAGE, label: 'Storage', hint: 'classId=2 — lab storage chain' },
  { id: LAB_CLASS_TRADE, label: 'Trade (optional)', hint: 'classId=3 — lab trade chain' },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Prefer Archive `error` / `reason`; keep HTTP status for empty bodies. */
function formatArchiveSubmitError(body: unknown, httpStatus: number): { reason: string; detail?: string } {
  if (!isRecord(body)) {
    return { reason: `HTTP ${httpStatus}`, detail: 'Non-JSON or empty Archive response' }
  }
  const errRaw =
    typeof body.error === 'string' && body.error !== ''
      ? body.error
      : typeof body.reason === 'string' && body.reason !== ''
        ? body.reason
        : `HTTP ${httpStatus}`
  // Same-origin SPA without nginx Mode A proxy: static try_files → 405 HTML, not Archive JSON.
  if (httpStatus === 405 || errRaw === 'non-JSON response' || errRaw === 'nginx_html_response') {
    return {
      reason: httpStatus === 405 ? 'ERR_GATEWAY_METHOD_NOT_ALLOWED' : errRaw,
      detail:
        'Explorer host returned non-Archive HTML (often nginx 405). Mode A needs proxy for POST /newchain/request and GET /newchain/chains — or point Archive URL at a :27101 node.',
    }
  }
  const bits: string[] = []
  if (body.inventoryFrozen === true) bits.push('inventoryFrozen=true')
  if (typeof body.code === 'string' && body.code !== '') bits.push(`code=${body.code}`)
  if (body.ok === false && errRaw === `HTTP ${httpStatus}`) bits.push('ok=false')
  return { reason: errRaw, detail: bits.length > 0 ? bits.join(' · ') : undefined }
}

async function readArchiveJsonResponse(res: Response): Promise<unknown> {
  const text = await res.text()
  const trimmed = text.trim()
  if (!trimmed) return { error: 'empty_response' }
  if (trimmed.startsWith('<') || trimmed.toLowerCase().includes('<!doctype')) {
    return { error: 'nginx_html_response', httpStatus: res.status }
  }
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return { error: 'non-JSON response', snippet: trimmed.slice(0, 120) }
  }
}

/**
 * Lab Mode A new-chain client: Connect injected Web3 wallet → POST /newchain/request.
 * Not Mock-L1 auction. Not L1 NFT mint. Not 30-day qualification.
 * Archive does not verify user signature; optional personal_sign is wallet ownership smoke only.
 */
export function LabNewchainPage() {
  const navigate = useNavigate()
  const { archiveUrl } = useExplorer()
  const { setShowFooter } = useExplorerChrome()
  const wallet = useWeb3Wallet()

  const [classId, setClassId] = useState<LabChainClassId>(LAB_CLASS_ASSET)
  /** Internal only — not shown; rotated after each successful submit. */
  const [nonce, setNonce] = useState(() => String(Date.now()))
  const [salt, setSalt] = useState<Hex>(() => randomSaltHex())
  const [signBeforeSubmit, setSignBeforeSubmit] = useState(true)

  const [refreshStatus, setRefreshStatus] = useState<RefreshStatus>('idle')
  const [chainsRaw, setChainsRaw] = useState<unknown>(null)
  const [chainRows, setChainRows] = useState<LabNewChainListItem[]>([])
  const [healthSnippet, setHealthSnippet] = useState<unknown>(null)
  const [actionLog, setActionLog] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  /** Last Submit outcome — not cleared by list/health refresh (`load`). */
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null)
  const [busy, setBusy] = useState(false)

  const ownedChains = useMemo(
    () => chainsOwnedBy(chainRows, wallet.address),
    [chainRows, wallet.address],
  )

  const rotateNonceSalt = useCallback(() => {
    setNonce(String(Date.now()))
    setSalt(randomSaltHex())
  }, [])

  useEffect(() => {
    setShowFooter(false)
    return () => setShowFooter(true)
  }, [setShowFooter])

  const draftRequest = useMemo(() => {
    if (!wallet.address) return null
    try {
      return makeNewChainRequest({
        classId,
        nonce,
        salt,
        user: wallet.address as Hex,
      })
    } catch {
      return null
    }
  }, [classId, nonce, salt, wallet.address])

  const previewIds = useMemo(() => {
    if (!draftRequest) return null
    const requestId = newChainRequestId(draftRequest)
    return {
      requestId,
      chainNftId: labChainNftIdFromRequestId(requestId),
      className: classNameOf(draftRequest.classId),
    }
  }, [draftRequest])

  const load = useCallback(async () => {
    setRefreshStatus('loading')
    setError(null)
    try {
      const base = archiveUrl.replace(/\/$/, '')
      const [c, h] = await Promise.all([
        fetch(`${base}/newchain/chains`).then(async (r) => ({
          ok: r.ok,
          status: r.status,
          body: await r.json().catch(() => null),
        })),
        fetch(`${base}/health`)
          .then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => null) }))
          .catch(() => ({ ok: false, body: null })),
      ])
      if (!c.ok && !h.ok) {
        setRefreshStatus('error')
        setError(
          'Archive /newchain/chains unavailable. Point Archive URL at a node that exposes Mode A (often local :27101). Keep last trusted view if any.',
        )
        window.setTimeout(() => setRefreshStatus('idle'), 3000)
        return
      }
      if (c.ok) {
        setChainsRaw(c.body)
        setChainRows(parseLabNewChainList(c.body))
      }
      if (h.ok && h.body !== null && typeof h.body === 'object') {
        const health = h.body as Record<string, unknown>
        setHealthSnippet({
          newchainCount: health.newchainCount,
          newchainArchivePending: health.newchainArchivePending,
          newchainArchiveCertified: health.newchainArchiveCertified,
          newchainOfficialStandbysReady: health.newchainOfficialStandbysReady,
          newchainStandbyReadyEip712: health.newchainStandbyReadyEip712,
        })
      }
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
  }, [load, wallet.address])

  const submit = async () => {
    if (busy) return
    if (!wallet.address) {
      setError('Connect a Web3 wallet first')
      setSubmitResult({ ok: false, httpStatus: null, reason: 'Connect a Web3 wallet first' })
      return
    }
    if (!draftRequest || !previewIds) {
      setError('Connect a Web3 wallet first')
      setSubmitResult({ ok: false, httpStatus: null, reason: 'Connect a Web3 wallet first' })
      return
    }
    /** Capture before rotate — success response may omit fields; preview is authoritative for hashes. */
    const submitted = {
      requestId: previewIds.requestId,
      chainNftId: previewIds.chainNftId,
      className: previewIds.className ?? 'unknown',
    }
    setBusy(true)
    setError(null)
    setSubmitResult(null)
    try {
      if (signBeforeSubmit) {
        await wallet.personalSign(labNewchainOwnershipMessage(draftRequest))
      }
      const body = {
        ...draftRequest,
        createdAt: new Date().toISOString(),
      }
      const res = await fetch(`${archiveUrl.replace(/\/$/, '')}/newchain/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await readArchiveJsonResponse(res)
      setActionLog({ status: res.status, body: json })
      if (res.status >= 400) {
        const formatted = formatArchiveSubmitError(json, res.status)
        setError(formatted.reason)
        setSubmitResult({
          ok: false,
          httpStatus: res.status,
          reason: formatted.reason,
          detail: formatted.detail,
        })
      } else {
        const duplicate = isRecord(json) && json.duplicate === true
        const requestId =
          isRecord(json) && typeof json.requestId === 'string' && /^0x[0-9a-fA-F]{64}$/.test(json.requestId)
            ? (json.requestId.toLowerCase() as Hex)
            : submitted.requestId
        const chainNftId =
          isRecord(json) && typeof json.chainNftId === 'string' && /^\d+$/.test(json.chainNftId)
            ? json.chainNftId
            : submitted.chainNftId
        const className =
          isRecord(json) && typeof json.className === 'string' && json.className !== ''
            ? json.className
            : submitted.className
        const valueHash =
          isRecord(json) && typeof json.valueHash === 'string' && json.valueHash.startsWith('0x')
            ? json.valueHash
            : undefined
        setSubmitResult({
          ok: true,
          httpStatus: res.status,
          duplicate,
          requestId,
          chainNftId,
          className,
          valueHash,
        })
        rotateNonceSalt()
      }
      await load()
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      setError(reason)
      setSubmitResult({
        ok: false,
        httpStatus: null,
        reason,
        detail: 'Request did not reach Archive (network, mixed content, or wallet sign rejected)',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <DetailPageShell
      eyebrow="Lab Mode A"
      title="New chain (Web3)"
      onBack={() => navigate('/')}
      pills={
        <>
          <StatusPill label="not L1 NFT" tone="warn" />
          <StatusPill label="not mock auction" tone="neutral" />
          <StatusPill label="labOnly" tone="ok" />
          <RefreshButton status={refreshStatus} onClick={() => void load()} />
        </>
      }
    >
      <p className="mb-4 text-sm leading-6 text-slate-400">
        Connect an injected wallet, then submit a{' '}
        <span className="dle-mono text-cyan-300">DleLabNewChainRequestV1</span> to Archive{' '}
        <span className="dle-mono text-cyan-300">POST /newchain/request</span>. Primary test classes are{' '}
        <strong className="font-semibold text-slate-200">Asset</strong> and{' '}
        <strong className="font-semibold text-slate-200">Storage</strong>. This is not the Mock-L1 auction page and not
        an L1 birth certificate. {LAB_NEWCHAIN_NOTE}
      </p>

      <div className="mb-4 space-y-4">
        <Web3WalletBar
          status={wallet.status}
          address={wallet.address}
          chainIdHex={wallet.chainIdHex}
          error={wallet.error}
          walletLabel={wallet.walletLabel}
          installedWallets={wallet.installedWallets}
          discoveryReady={wallet.discoveryReady}
          showMobileOpenPanel={wallet.showMobileOpenPanel}
          showDesktopNoWallet={wallet.showDesktopNoWallet}
          onConnect={(choice) => void wallet.connect(choice)}
          onDisconnect={wallet.disconnect}
        />

        {wallet.address ? (
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200/70">
                Your chains (owner)
              </p>
              <StatusPill
                label={`${ownedChains.length} owned`}
                tone={ownedChains.length > 0 ? 'ok' : 'neutral'}
              />
            </div>
            <p className="mt-2 text-[11px] leading-5 text-slate-500">
              Lab Mode A records where <span className="dle-mono text-slate-400">user</span> equals the connected
              wallet (not L1 <span className="dle-mono">ownerOf</span>). From trusted{' '}
              <span className="dle-mono text-cyan-300">GET /newchain/chains</span>.
            </p>
            {ownedChains.length === 0 ? (
              <p className="mt-3 text-sm text-slate-400">
                No lab chains for this wallet yet. Submit an Asset or Storage request below.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {ownedChains.map((row) => (
                  <li
                    key={row.requestId}
                    className="rounded-xl border border-white/10 bg-black/25 px-3 py-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill label={row.className} tone="ok" />
                      <span className="dle-mono text-xs text-cyan-200">chainNftId {row.chainNftId}</span>
                      {row.hasArchiveCertificate ? (
                        <StatusPill label="AC" tone="ok" />
                      ) : row.archiveCertificatePending ? (
                        <StatusPill label="AC pending" tone="warn" />
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-slate-500">requestId</span>
                      <HashCapsule value={row.requestId} />
                    </div>
                    <p className="mt-2 text-[11px] text-slate-500">
                      Accepted {row.acceptedAt}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200/70">Chain class</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {CLASS_CHOICES.map((choice) => {
              const active = classId === choice.id
              return (
                <button
                  key={choice.id}
                  type="button"
                  tabIndex={-1}
                  onClick={() => setClassId(choice.id)}
                  className={`rounded-xl border px-3 py-3 text-left transition ${
                    active
                      ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-50'
                      : 'border-white/10 bg-black/20 text-slate-300 hover:border-white/20'
                  }`}
                >
                  <p className="text-sm font-semibold">{choice.label}</p>
                  <p className="mt-1 text-[11px] text-slate-400">{choice.hint}</p>
                </button>
              )
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200/70">Submit</p>
          <p className="mt-2 text-[11px] leading-5 text-slate-500">
            Nonce and salt are generated internally (not editable) and rotate after each successful submit.
          </p>
          <label className="mt-3 flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={signBeforeSubmit}
              onChange={(e) => setSignBeforeSubmit(e.target.checked)}
              className="rounded border-white/20"
            />
            Optional <span className="dle-mono text-cyan-300">personal_sign</span> ownership smoke (Archive ignores)
          </label>

          {previewIds ? (
            <div className="mt-4 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Local preview ({previewIds.className})
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-400">requestId</span>
                <HashCapsule value={previewIds.requestId} />
              </div>
              <p className="text-xs text-slate-400">
                Predicted lab <span className="dle-mono text-slate-300">chainNftId</span> ={' '}
                <span className="dle-mono text-cyan-200">{previewIds.chainNftId}</span> (never tip NFT 42)
              </p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-amber-200/80">Connect wallet to preview request IDs.</p>
          )}

          <button
            type="button"
            tabIndex={-1}
            disabled={busy || !draftRequest}
            aria-busy={busy}
            onClick={() => void submit()}
            className="mt-4 inline-flex items-center justify-center rounded-full border border-cyan-400/35 bg-cyan-400/15 px-5 py-2 text-sm font-semibold text-cyan-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Submitting…' : 'Submit new-chain request'}
          </button>

          {busy ? (
            <p className="mt-3 text-sm text-slate-400" aria-live="polite">
              Submitting to Archive…
            </p>
          ) : null}

          {submitResult?.ok === true ? (
            <div
              className="mt-4 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-3"
              role="status"
              aria-live="polite"
            >
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill label={submitResult.duplicate ? 'Accepted (duplicate)' : 'Accepted'} tone="ok" />
                <StatusPill label={submitResult.className} tone="ok" />
                <span className="text-[11px] text-emerald-100/70">HTTP {submitResult.httpStatus}</span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-emerald-100/80">requestId</span>
                <HashCapsule value={submitResult.requestId} />
              </div>
              <p className="mt-2 text-xs text-emerald-50/90">
                lab <span className="dle-mono">chainNftId</span> ={' '}
                <span className="dle-mono text-emerald-100">{submitResult.chainNftId}</span>
              </p>
              {submitResult.valueHash ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-emerald-100/80">valueHash</span>
                  <HashCapsule value={submitResult.valueHash} />
                </div>
              ) : null}
              {submitResult.duplicate ? (
                <p className="mt-2 text-[11px] leading-5 text-emerald-100/70">
                  Same requestId was already on this Archive — no new inventory write.
                </p>
              ) : null}
            </div>
          ) : null}

          {submitResult?.ok === false ? (
            <div
              className="mt-4 rounded-xl border border-amber-400/35 bg-amber-400/10 px-3 py-3"
              role="alert"
              aria-live="assertive"
            >
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill label="Rejected" tone="warn" />
                {submitResult.httpStatus !== null ? (
                  <span className="text-[11px] text-amber-100/70">HTTP {submitResult.httpStatus}</span>
                ) : (
                  <span className="text-[11px] text-amber-100/70">no HTTP response</span>
                )}
              </div>
              <p className="mt-2 text-sm font-medium text-amber-50">{submitResult.reason}</p>
              {submitResult.detail ? (
                <p className="mt-1 text-[11px] leading-5 text-amber-100/75">{submitResult.detail}</p>
              ) : null}
              {submitResult.reason === 'ERR_INVENTORY_FROZEN' ? (
                <p className="mt-2 text-[11px] leading-5 text-amber-100/75">
                  Archive inventory is frozen — Mode A will not accept new chains until operators unfreeze. Your
                  wallet will not appear under Your chains until a request returns HTTP 200.
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>

      {error && submitResult === null ? <p className="mb-4 text-sm text-amber-200/90">{error}</p> : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <article className="dle-glass rounded-2xl p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200/70">Last action</p>
          <JsonBlock value={actionLog} />
        </article>
        <article className="dle-glass rounded-2xl p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200/70">Health (new-chain)</p>
          <JsonBlock value={healthSnippet} />
        </article>
      </div>
      <article className="dle-glass mt-3 rounded-2xl p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200/70">
          GET /newchain/chains (all)
        </p>
        <JsonBlock value={chainsRaw} />
      </article>
    </DetailPageShell>
  )
}
