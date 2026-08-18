/** User-visible lab seating copy. After P12 this is EIP-712, never HMAC. Not production OperatorDomain. */

export function labSeatingGaugeHint(seatedCount: number): string {
  return seatedCount > 0 ? 'Lab EIP-712 seated' : 'Not seated'
}

export function labSeatingDetailLabel(
  seatingQualified: boolean,
  syncPhase: string | null | undefined,
): string {
  if (seatingQualified) return 'seated (lab EIP-712)'
  return syncPhase ?? 'not seated'
}
