import type { ReactNode } from 'react'

export function MetricCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: 'default' | 'warn'
}) {
  return (
    <article className={`dle-glass rounded-2xl p-4 ${tone === 'warn' ? 'border-amber-300/30' : ''}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-200/70">{label}</p>
      <p className="dle-mono mt-2 break-all text-xl font-semibold tracking-tight text-white">{value}</p>
      {hint == null ? null : typeof hint === 'string' ? (
        <p className="mt-1 text-xs leading-5 text-slate-400">{hint}</p>
      ) : (
        <div className="mt-2">{hint}</div>
      )}
    </article>
  )
}
