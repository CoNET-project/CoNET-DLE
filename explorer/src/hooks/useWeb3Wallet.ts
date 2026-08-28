import { BrowserProvider } from 'ethers'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type Eip1193Provider,
  type InjectedWalletChoice,
  isMobileDeviceForWalletApps,
  subscribeInstalledInjectedWallets,
} from '../lib/injectedWallets'

export type Web3WalletStatus = 'disconnected' | 'connecting' | 'connected' | 'unavailable'

function normalizeAddress(value: unknown): string | null {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) return null
  return value.toLowerCase()
}

/**
 * Injected Web3 wallet via EIP-6963 picker (usdc-topup pattern).
 * Session-only — no private key persistence. Address may fill lab new-chain `user`.
 */
export function useWeb3Wallet() {
  const [installedWallets, setInstalledWallets] = useState<InjectedWalletChoice[]>([])
  const [discoveryReady, setDiscoveryReady] = useState(false)
  const [status, setStatus] = useState<Web3WalletStatus>('disconnected')
  const [address, setAddress] = useState<string | null>(null)
  const [chainIdHex, setChainIdHex] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [walletLabel, setWalletLabel] = useState<string | null>(null)
  const activeProviderRef = useRef<Eip1193Provider | null>(null)

  useEffect(() => {
    return subscribeInstalledInjectedWallets((wallets) => {
      setInstalledWallets(wallets)
      setDiscoveryReady(true)
    })
  }, [])

  useEffect(() => {
    if (!discoveryReady) return
    if (activeProviderRef.current) return
    if (installedWallets.length === 0 && !isMobileDeviceForWalletApps()) {
      setStatus((prev) => (prev === 'connected' || prev === 'connecting' ? prev : 'unavailable'))
    } else {
      setStatus((prev) => (prev === 'unavailable' ? 'disconnected' : prev))
    }
  }, [discoveryReady, installedWallets.length])

  useEffect(() => {
    if (status !== 'connected') return
    const eth = activeProviderRef.current
    if (!eth?.on) return
    const onAccounts = (...args: unknown[]) => {
      const list = Array.isArray(args[0]) ? (args[0] as unknown[]) : []
      const next = normalizeAddress(list[0])
      if (next) {
        setAddress(next)
        setStatus('connected')
      } else {
        setAddress(null)
        setStatus('disconnected')
      }
    }
    const onChain = (...args: unknown[]) => {
      const id = args[0]
      if (typeof id === 'string') setChainIdHex(id)
    }
    eth.on('accountsChanged', onAccounts)
    eth.on('chainChanged', onChain)
    return () => {
      eth.removeListener?.('accountsChanged', onAccounts)
      eth.removeListener?.('chainChanged', onChain)
    }
  }, [status, walletLabel])

  const connect = useCallback(async (choice: InjectedWalletChoice) => {
    const provider = choice.provider
    if (!provider) {
      setError('Selected wallet has no EIP-1193 provider')
      return
    }
    setError(null)
    setStatus('connecting')
    activeProviderRef.current = provider
    setWalletLabel(choice.label)
    try {
      const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as unknown[]
      const next = normalizeAddress(accounts[0])
      if (!next) throw new Error('Wallet returned no account')
      const chainId = (await provider.request({ method: 'eth_chainId' })) as string
      setAddress(next)
      setChainIdHex(typeof chainId === 'string' ? chainId : null)
      setStatus('connected')
    } catch (e) {
      activeProviderRef.current = null
      setWalletLabel(null)
      setAddress(null)
      setChainIdHex(null)
      setStatus(installedWallets.length > 0 || isMobileDeviceForWalletApps() ? 'disconnected' : 'unavailable')
      setError(e instanceof Error ? e.message : 'Wallet connect failed')
    }
  }, [installedWallets.length])

  const disconnect = useCallback(() => {
    activeProviderRef.current = null
    setAddress(null)
    setChainIdHex(null)
    setWalletLabel(null)
    setError(null)
    setStatus(installedWallets.length > 0 || isMobileDeviceForWalletApps() ? 'disconnected' : 'unavailable')
  }, [installedWallets.length])

  const personalSign = useCallback(async (message: string): Promise<string> => {
    const eth = activeProviderRef.current
    if (!eth || !address) throw new Error('Connect a Web3 wallet first')
    const provider = new BrowserProvider(eth as never)
    const signer = await provider.getSigner()
    return signer.signMessage(message)
  }, [address])

  const hasInstalledWallets = installedWallets.length > 0
  const showMobileOpenPanel =
    discoveryReady && !hasInstalledWallets && isMobileDeviceForWalletApps() && status !== 'connected'
  const showDesktopNoWallet =
    discoveryReady && !hasInstalledWallets && !isMobileDeviceForWalletApps() && status !== 'connected'

  return {
    status,
    address,
    chainIdHex,
    error,
    walletLabel,
    installedWallets,
    discoveryReady,
    hasInstalledWallets,
    showMobileOpenPanel,
    showDesktopNoWallet,
    connect,
    disconnect,
    personalSign,
  }
}
