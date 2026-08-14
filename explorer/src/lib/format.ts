export function formatInteger(value: number): string {
  return Math.trunc(value).toLocaleString('en-US')
}

export function formatHeight(hexOrNumber: string | number | null | undefined): string {
  if (hexOrNumber === null || hexOrNumber === undefined) return '0'
  if (typeof hexOrNumber === 'number' && Number.isFinite(hexOrNumber)) return formatInteger(hexOrNumber)
  const raw = String(hexOrNumber)
  if (/^0x[0-9a-fA-F]+$/.test(raw)) {
    try {
      return formatInteger(Number(BigInt(raw)))
    } catch {
      return raw
    }
  }
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? formatInteger(parsed) : raw
}

export function shortenHash(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail + 1) return value
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

export function formatEventTime(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return iso
  const delta = Date.now() - ms
  const minutes = Math.floor(delta / 60_000)
  if (minutes < 60) return `${Math.max(0, minutes)}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  if (hours < 48) return 'Yesterday'
  return new Date(ms).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}
