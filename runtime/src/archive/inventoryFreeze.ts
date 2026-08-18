/** Process-wide freeze for *new* hash catalogue writes (P8a). */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const ERR_INVENTORY_FROZEN = 'ERR_INVENTORY_FROZEN' as const
export const OPERATOR_INVENTORY_FREEZE_FILENAME = 'operator-inventory-freeze.json'
export const OPERATOR_INVENTORY_FREEZE_SCHEMA = 'DleLabOperatorInventoryFreezeV1' as const
export const ERR_OPERATOR_INVENTORY_FREEZE_BODY = 'ERR_OPERATOR_INVENTORY_FREEZE_BODY' as const
export const ERR_OPERATOR_INVENTORY_FREEZE_REQUIRED = 'ERR_OPERATOR_INVENTORY_FREEZE_REQUIRED' as const

let frozen = false
let reason: string | undefined
let operatorFrozen = false

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

export function operatorInventoryFrozen(): boolean {
  return operatorFrozen
}

export function setOperatorInventoryFreeze(next: boolean): void {
  operatorFrozen = next
}

export function resetInventoryFreezeForTests(): void {
  frozen = false
  reason = undefined
  operatorFrozen = false
}

export function resolveInventoryFreezeState(
  autoFrozen: boolean,
  autoReason?: string,
): { frozen: boolean; reason?: string } {
  if (operatorFrozen) return { frozen: true, reason: 'operator' }
  if (autoFrozen) {
    return autoReason === undefined ? { frozen: true } : { frozen: true, reason: autoReason }
  }
  return { frozen: false }
}

export function parseOperatorInventoryFreezePost(
  body: unknown,
): { ok: true; frozen: true } | { ok: false; error: string } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: ERR_OPERATOR_INVENTORY_FREEZE_BODY }
  }
  if ((body as { frozen?: unknown }).frozen !== true) {
    return { ok: false, error: ERR_OPERATOR_INVENTORY_FREEZE_REQUIRED }
  }
  return { ok: true, frozen: true }
}

export function operatorInventoryFreezeDocument(at = new Date().toISOString()): string {
  return `${JSON.stringify(
    {
      schema: OPERATOR_INVENTORY_FREEZE_SCHEMA,
      frozen: true,
      reason: 'operator',
      labOnly: true,
      notThirtyDayQualification: true,
      at,
    },
    null,
    2,
  )}\n`
}

export function persistOperatorInventoryFreeze(dataDir: string, next: boolean): void {
  mkdirSync(dataDir, { recursive: true })
  const path = join(dataDir, OPERATOR_INVENTORY_FREEZE_FILENAME)
  if (!next) {
    if (existsSync(path)) unlinkSync(path)
    return
  }
  writeFileSync(path, operatorInventoryFreezeDocument(), 'utf8')
}

export function loadOperatorInventoryFreeze(dataDir: string): boolean {
  const path = join(dataDir, OPERATOR_INVENTORY_FREEZE_FILENAME)
  if (!existsSync(path)) {
    operatorFrozen = false
    return false
  }
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
    operatorFrozen =
      raw !== null &&
      typeof raw === 'object' &&
      !Array.isArray(raw) &&
      (raw as { frozen?: unknown }).frozen === true
    return operatorFrozen
  } catch {
    operatorFrozen = false
    return false
  }
}
