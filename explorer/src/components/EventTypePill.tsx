export function EventTypePill({ type, ok }: { type: string; ok?: boolean }) {
  const tone =
    ok === false
      ? 'border-amber-300/35 bg-amber-300/10 text-amber-100'
      : type === 'heartbeat'
        ? 'border-[#00b4ff]/40 bg-[#00b4ff]/12 text-[#7de3ff]'
        : type === 'rpc'
          ? 'border-sky-300/35 bg-sky-400/10 text-sky-100'
          : type === 'lab-start'
            ? 'border-[#00ffa3]/35 bg-[#00ffa3]/10 text-[#00ffa3]'
            : 'border-white/15 bg-white/5 text-slate-100'

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold capitalize ${tone}`}>
      {type}
    </span>
  )
}
