import { Check, Copy } from 'lucide-react'
import { useCallback, useState, type MouseEvent, type ReactNode } from 'react'
import { CONET_BLOCKSCOUT_ADDRESS_URL } from '../config/l1Routing'
import { openExternalUrl } from '../lib/openExternalUrl'

function shortAddress(address: string): string {
  if (address.length < 12) return address
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export function AddressCapsule({
  address,
  className = 'max-w-full border-cyan-400/20 bg-white/10 text-white/85',
  leadingIcon,
}: {
  address: string
  className?: string
  leadingIcon?: ReactNode
}) {
  const [copied, setCopied] = useState(false)
  const explorerUrl = `${CONET_BLOCKSCOUT_ADDRESS_URL}${address}`
  const short = shortAddress(address)

  const stop = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }

  const handleCopy = useCallback(
    async (event: MouseEvent) => {
      stop(event)
      if (address.length < 10) return
      try {
        await navigator.clipboard.writeText(address)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 2000)
      } catch {
        /* ignore */
      }
    },
    [address],
  )

  const handleOpen = (event: MouseEvent) => {
    stop(event)
    openExternalUrl(explorerUrl)
  }

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border py-1.5 pl-3 pr-2 font-mono text-[11px] font-semibold ${className}`}
    >
      {leadingIcon ? <span className="shrink-0">{leadingIcon}</span> : null}
      <button
        type="button"
        onClick={handleOpen}
        className="min-w-0 truncate hover:underline"
        aria-label="View address on CoNET Blockscout"
      >
        {short}
      </button>
      <button
        type="button"
        onClick={(event) => void handleCopy(event)}
        className="shrink-0 opacity-70 transition-opacity hover:opacity-100"
        aria-label="Copy address"
        title="Copy address"
      >
        {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} className="text-[#0051d1]" />}
      </button>
    </div>
  )
}
