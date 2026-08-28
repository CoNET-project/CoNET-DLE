import { Loader2 } from 'lucide-react'
import { AddressCapsule } from './AddressCapsule'
import type { Web3WalletStatus } from '../hooks/useWeb3Wallet'
import {
  buildMobileWalletDappLinks,
  type InjectedWalletChoice,
  type InjectedWalletChoiceId,
  openBaseWalletDappWithFallback,
  walletStaticIconPath,
} from '../lib/injectedWallets'

function resolveIcon(w: InjectedWalletChoice): string | null {
  return w.iconUrl || walletStaticIconPath(w.id)
}

function StaticWalletIcon({ id, alt }: { id: InjectedWalletChoiceId; alt: string }) {
  const src = walletStaticIconPath(id)
  if (!src) return null
  return <img src={src} alt={alt} className="h-10 w-10 object-contain" width={40} height={40} decoding="async" />
}

function MobileWalletOpenPanel() {
  const links = buildMobileWalletDappLinks()
  const btn =
    'flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/90 p-2 shadow-md transition hover:bg-white active:scale-95'

  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
      <p className="text-sm font-semibold text-slate-100">Open in a wallet app</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">
        Tap an icon to open this page inside the wallet. Then choose Connect again from the in-app browser.
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-4">
        <a href={links.metamask} target="_self" rel="noreferrer" className={btn} aria-label="Open in MetaMask">
          <StaticWalletIcon id="metamask" alt="" />
        </a>
        <button type="button" tabIndex={-1} onClick={() => openBaseWalletDappWithFallback()} className={btn} aria-label="Open in Base Wallet">
          <StaticWalletIcon id="base" alt="" />
        </button>
        <a href={links.okx} target="_self" rel="noreferrer" className={btn} aria-label="Open in OKX Wallet">
          <StaticWalletIcon id="okx" alt="" />
        </a>
        <a href={links.tp} target="_self" rel="noreferrer" className={btn} aria-label="Open in TokenPocket">
          <StaticWalletIcon id="tp" alt="" />
        </a>
      </div>
    </div>
  )
}

function InstalledWalletPicker({
  wallets,
  connecting,
  onSelect,
}: {
  wallets: InjectedWalletChoice[]
  connecting: boolean
  onSelect: (wallet: InjectedWalletChoice) => void
}) {
  if (wallets.length === 0) return null

  return (
    <div className="mt-4">
      <p className="text-sm font-semibold text-slate-100">Choose a wallet</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">
        Select an installed Web3 wallet. You will approve the connection in that wallet next.
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {wallets.map((w) => {
          const img = resolveIcon(w)
          const key = `${w.rdns || w.id}-${w.label}`
          return (
            <li key={key}>
              <button
                type="button"
                tabIndex={-1}
                disabled={connecting}
                aria-busy={connecting}
                aria-label={`Connect ${w.label}`}
                onClick={() => onSelect(w)}
                className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-left transition hover:border-cyan-400/30 hover:bg-cyan-400/5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {img ? (
                  <img
                    src={img}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-xl bg-white object-contain p-1"
                    width={40}
                    height={40}
                    decoding="async"
                  />
                ) : (
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-sm font-bold text-slate-200"
                    aria-hidden
                  >
                    {w.label.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-100">{w.label}</span>
                  <span className="mt-0.5 block text-[11px] text-slate-500">
                    {connecting ? 'Connecting…' : 'Installed in this browser'}
                  </span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-cyan-200">
                  {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                  Connect
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function Web3WalletBar({
  status,
  address,
  chainIdHex,
  error,
  walletLabel,
  installedWallets,
  discoveryReady,
  showMobileOpenPanel,
  showDesktopNoWallet,
  onConnect,
  onDisconnect,
}: {
  status: Web3WalletStatus
  address: string | null
  chainIdHex: string | null
  error: string | null
  walletLabel: string | null
  installedWallets: InjectedWalletChoice[]
  discoveryReady: boolean
  showMobileOpenPanel: boolean
  showDesktopNoWallet: boolean
  onConnect: (wallet: InjectedWalletChoice) => void
  onDisconnect: () => void
}) {
  const connecting = status === 'connecting'
  const connected = status === 'connected' && Boolean(address)

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200/70">Web3 wallet</p>
          <p className="mt-1 text-sm text-slate-400">
            Choose an installed wallet (EIP-6963), same pattern as beamio.app/usdc-topup. Address fills lab chain{' '}
            <code className="text-slate-300">user</code> — not Archive authority, not L1 mint.
          </p>
        </div>
        {connected ? (
          <button
            type="button"
            tabIndex={-1}
            onClick={onDisconnect}
            className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10"
          >
            Disconnect
          </button>
        ) : null}
      </div>

      {connected && address ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {walletLabel ? (
            <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-2.5 py-0.5 text-[11px] font-medium text-cyan-100">
              {walletLabel}
            </span>
          ) : null}
          <AddressCapsule address={address} />
          {chainIdHex ? (
            <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-0.5 text-[11px] text-slate-400">
              wallet chain {chainIdHex}
            </span>
          ) : null}
        </div>
      ) : null}

      {!connected && !discoveryReady ? (
        <p className="mt-4 inline-flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Detecting installed wallets…
        </p>
      ) : null}

      {!connected && discoveryReady && installedWallets.length > 0 ? (
        <InstalledWalletPicker wallets={installedWallets} connecting={connecting} onSelect={onConnect} />
      ) : null}

      {showMobileOpenPanel ? <MobileWalletOpenPanel /> : null}

      {showDesktopNoWallet ? (
        <p className="mt-4 text-sm text-amber-200/90">
          No injected wallet detected. Install MetaMask, Coinbase / Base Wallet, OKX, TokenPocket, or another EIP-6963
          extension, then refresh this page.
        </p>
      ) : null}

      {error ? <p className="mt-2 text-sm text-amber-200/90">{error}</p> : null}
    </section>
  )
}
