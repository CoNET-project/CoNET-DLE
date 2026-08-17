/** Process-wide freeze for *new* hash catalogue writes (P8a). */

export const ERR_INVENTORY_FROZEN = 'ERR_INVENTORY_FROZEN' as const

let frozen = false
let reason: string | undefined

export function setInventoryCatalogFrozen(next: boolean, nextReason?: string): void {
  frozen = next
  reason = next ? nextReason : undefined
}

export function inventoryCatalogFrozen(): boolean {
  return frozen
}

export function inventoryCatalogFreezeReason(): string | undefined {
  return reason
}

export function inventoryCatalogFreezeSnapshot(): { frozen: boolean; reason?: string } {
  return reason === undefined ? { frozen } : { frozen, reason }
}
