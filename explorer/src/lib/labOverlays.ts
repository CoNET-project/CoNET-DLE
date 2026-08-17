/**
 * P25 lab-only Explorer overlays. Copied locally — do not import runtime.
 * Green seating pills stay in archiveSeating.ts (`seatingQualified === true` only).
 */

export const ZERO32 = `0x${'00'.repeat(32)}`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function readCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function syncQualification(health: Record<string, unknown> | null): Record<string, unknown> | null {
  if (health === null) return null
  return isRecord(health.syncQualification) ? health.syncQualification : null
}

/** True only when AC carries a non-zero bound root. Missing root is not a trusted false. */
export function hashIndexCommittedInAcFromRoot(root: unknown): boolean {
  if (typeof root !== 'string') return false
  return root.toLowerCase() !== ZERO32
}

/**
 * Prefer trusted `/health.hashIndexCommittedInAc`. Else derive from certificate.hashIndexRoot.
 * Missing both → null (keep last trusted UI; do not wipe as false).
 */
export function parseHashIndexCommittedInAc(
  health: Record<string, unknown> | null,
  certificate: { hashIndexRoot?: string } | null | undefined,
): boolean | null {
  const fromHealth = health !== null ? readBoolean(health.hashIndexCommittedInAc) : null
  if (fromHealth !== null) return fromHealth
  if (certificate && typeof certificate.hashIndexRoot === 'string') {
    return hashIndexCommittedInAcFromRoot(certificate.hashIndexRoot)
  }
  return null
}

/**
 * Official standby readiness (P22). Extra `fd-08` does not count on the archive.
 * Prefer top-level, then `syncQualification`, then new-chain alias.
 */
export function parseOfficialStandbysReady(health: Record<string, unknown> | null): boolean | null {
  if (health === null) return null
  const top = readBoolean(health.officialStandbysReady)
  if (top !== null) return top
  const nested = readBoolean(syncQualification(health)?.officialStandbysReady)
  if (nested !== null) return nested
  return readBoolean(health.newchainOfficialStandbysReady)
}

export function parseOfficialStandbyReadyCount(health: Record<string, unknown> | null): number | null {
  if (health === null) return null
  const top = readCount(health.officialStandbyReadyCount)
  if (top !== null) return top
  return readCount(syncQualification(health)?.officialStandbyReadyCount)
}

export function parseStandbyReadyEip712(health: Record<string, unknown> | null): boolean | null {
  if (health === null) return null
  const top = readBoolean(health.standbyReadyEip712)
  if (top !== null) return top
  const nested = readBoolean(syncQualification(health)?.standbyReadyEip712)
  if (nested !== null) return nested
  return readBoolean(health.newchainStandbyReadyEip712)
}

export function parseNewchainOfficialStandbysReady(health: Record<string, unknown> | null): boolean | null {
  if (health === null) return null
  return readBoolean(health.newchainOfficialStandbysReady)
}

export function parseNewchainStandbyReadyEip712(health: Record<string, unknown> | null): boolean | null {
  if (health === null) return null
  return readBoolean(health.newchainStandbyReadyEip712)
}

export function parseExtraStandbyReadyDoesNotCount(health: Record<string, unknown> | null): boolean | null {
  if (health === null) return null
  const top = readBoolean(health.extraStandbyReadyDoesNotCount)
  if (top !== null) return top
  return readBoolean(syncQualification(health)?.extraStandbyReadyDoesNotCount)
}

/** Never tone `ok` — green is reserved for seatingQualified. */
export function officialStandbysReadyPill(ready: boolean | null): {
  label: string
  tone: 'blue' | 'warn'
} | null {
  if (ready === null) return null
  if (ready === true) return { label: 'Official standbys ready (lab overlay)', tone: 'blue' }
  return { label: 'Official standbys not ready', tone: 'warn' }
}

/** Never tone `ok` — green is reserved for seatingQualified. */
export function hashIndexCommittedInAcPill(committed: boolean | null): {
  label: string
  tone: 'purple' | 'neutral'
} | null {
  if (committed === null) return null
  if (committed === true) return { label: 'Hash index bound in AC (lab overlay)', tone: 'purple' }
  return { label: 'Hash index not bound in AC', tone: 'neutral' }
}
