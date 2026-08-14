export function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="dle-mono overflow-x-auto rounded-2xl border border-cyan-400/15 bg-[#050910] p-4 text-xs leading-5 text-cyan-50/90">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}
