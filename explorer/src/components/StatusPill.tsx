export function StatusPill({
  label,
  tone = 'neutral',
}: {
  label: string
  tone?: 'ok' | 'warn' | 'bad' | 'neutral' | 'blue' | 'purple'
}) {
  const tones: Record<string, string> = {
    ok: 'border-[#00ffa3]/35 bg-[#00ffa3]/10 text-[#00ffa3]',
    warn: 'border-amber-300/35 bg-amber-300/10 text-amber-200',
    bad: 'border-rose-400/40 bg-rose-400/10 text-rose-200',
    blue: 'border-[#00b4ff]/40 bg-[#00b4ff]/10 text-[#7de3ff]',
    purple: 'border-violet-300/35 bg-violet-400/10 text-violet-200',
    neutral: 'border-white/10 bg-white/5 text-slate-300',
  }
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>
      {label}
    </span>
  )
}
