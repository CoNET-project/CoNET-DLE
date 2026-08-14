import { AlertTriangle, Check, Loader2, RefreshCw } from 'lucide-react'
import type { RefreshStatus } from '../types'

export function RefreshButton({
  status,
  onClick,
}: {
  status: RefreshStatus
  onClick: () => void
}) {
  const disabled = status !== 'idle'
  return (
    <button
      type="button"
      aria-label="Refresh"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-cyan-400/25 bg-[#07111f]/80 text-cyan-100 shadow-[0_0_24px_rgba(0,180,255,0.22)] backdrop-blur-md disabled:cursor-not-allowed"
    >
      {status === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {status === 'success' ? <Check className="h-4 w-4 text-emerald-400" aria-hidden /> : null}
      {status === 'error' ? <AlertTriangle className="h-4 w-4 text-amber-400" aria-hidden /> : null}
      {status === 'idle' ? <RefreshCw className="h-4 w-4" aria-hidden /> : null}
    </button>
  )
}
