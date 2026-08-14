export function ClusterGauge({
  label,
  value,
  hint,
  healthy,
}: {
  label: string
  value: number
  hint: string
  healthy: boolean
}) {
  const clamped = Math.max(0, Math.min(100, value))
  const angle = (clamped / 100) * 360

  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <div
        className="flex h-20 w-20 items-center justify-center rounded-full"
        style={{
          background: `conic-gradient(#00b4ff ${angle}deg, rgba(255,255,255,0.08) ${angle}deg)`,
          boxShadow: '0 0 18px rgba(0,180,255,0.2)',
        }}
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#07111f] text-xs font-semibold text-white">
          {Math.round(clamped)}%
        </div>
      </div>
      <p className="text-sm font-semibold text-white">{label}</p>
      <p className={`text-xs ${healthy ? 'text-[#00ffa3]' : 'text-amber-200'}`}>{hint}</p>
    </div>
  )
}
