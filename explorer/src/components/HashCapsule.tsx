import { Check, Copy } from 'lucide-react'
import { useCallback, useState, type MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { shortenHash } from '../lib/format'
import { openExternalUrl } from '../lib/openExternalUrl'

export function HashCapsule({
  value,
  to,
  href,
  className = 'max-w-full border-cyan-400/20 bg-white/10 text-white/85',
}: {
  value: string
  to?: string
  href?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const short = shortenHash(value, 10, 8)

  const handleCopy = useCallback(
    async (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (value.length < 10) return
      try {
        await navigator.clipboard.writeText(value)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 2000)
      } catch {
        /* ignore */
      }
    },
    [value],
  )

  const handleOpenExternal = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (href) openExternalUrl(href)
  }

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border py-1.5 pl-3 pr-2 font-mono text-[11px] font-semibold ${className}`}
    >
      {href !== undefined ? (
        <button
          type="button"
          onClick={handleOpenExternal}
          className="min-w-0 truncate hover:text-white hover:underline"
          title={value}
          aria-label="View hash on CoNET L1 Blockscout"
        >
          {short}
        </button>
      ) : to !== undefined ? (
        <Link to={to} className="min-w-0 truncate hover:text-white" title={value}>
          {short}
        </Link>
      ) : (
        <span className="min-w-0 truncate" title={value}>
          {short}
        </span>
      )}
      <button
        type="button"
        onClick={(event) => void handleCopy(event)}
        className="shrink-0 opacity-70 transition-opacity hover:opacity-100"
        aria-label="Copy hash"
        title="Copy hash"
      >
        {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} className="text-[#00b4ff]" />}
      </button>
    </div>
  )
}
