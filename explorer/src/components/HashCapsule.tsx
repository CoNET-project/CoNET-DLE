import { Check, Copy } from 'lucide-react'
import { useCallback, useState, type MouseEvent } from 'react'
import { shortenHash } from '../lib/format'

export function HashCapsule({
  value,
  className = 'max-w-full border-cyan-400/20 bg-white/10 text-white/85',
}: {
  value: string
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

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border py-1.5 pl-3 pr-2 font-mono text-[11px] font-semibold ${className}`}
    >
      <span className="min-w-0 truncate" title={value}>
        {short}
      </span>
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
