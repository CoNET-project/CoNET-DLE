/** Operator-stamped 30-day lab clock. Opening the clock is not qualification. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const OPERATOR_PILOT_CLOCK_FILENAME = 'operator-pilot-clock.json'
export const OPERATOR_PILOT_CLOCK_SCHEMA = 'DleLabOperatorPilotClockV1' as const
export const OPERATOR_PILOT_WARMUP_WINDOW_MS = 72 * 60 * 60 * 1_000
export const ERR_OPERATOR_PILOT_CLOCK_BODY = 'ERR_OPERATOR_PILOT_CLOCK_BODY' as const
export const ERR_OPERATOR_PILOT_CLOCK_REQUIRED = 'ERR_OPERATOR_PILOT_CLOCK_REQUIRED' as const
export const ERR_OPERATOR_PILOT_CLOCK_WARMUP = 'ERR_OPERATOR_PILOT_CLOCK_WARMUP' as const
export const ERR_OPERATOR_PILOT_CLOCK_MISMATCH = 'ERR_OPERATOR_PILOT_CLOCK_MISMATCH' as const

export interface OperatorPilotClockV1 {
  schema: typeof OPERATOR_PILOT_CLOCK_SCHEMA
  warmupStartedAt: string
  pilotStartedAt: string
  epoch: number
  resetCount: number
  counters: { rotations: number; rehomes: number; takeovers: number }
  labOnly: true
  notThirtyDayQualification: true
  clockIsNotQualification: true
  at: string
}

export interface OperatorPilotClockPost {
  start: true
  warmupStartedAt: string
  pilotStartedAt: string
}

let clock: OperatorPilotClockV1 | null = null

export function resetOperatorPilotClockForTests(): void {
  clock = null
}

export function operatorPilotClock(): OperatorPilotClockV1 | null {
  return clock
}

export function operatorPilotClockHealth(atMs = Date.now()): {
  warmupStartedAt: string | null
  pilotStartedAt: string | null
  warmupComplete: boolean
  pilotRunning: boolean
  pilotQualified: false
  pilotClockLabOnly: true
  notThirtyDayQualification: true
  clockIsNotQualification: true
} {
  const warmupStartedAt = clock?.warmupStartedAt ?? null
  const pilotStartedAt = clock?.pilotStartedAt ?? null
  const warmupMs = warmupStartedAt === null ? Number.NaN : Date.parse(warmupStartedAt)
  return {
    warmupStartedAt,
    pilotStartedAt,
    warmupComplete: Number.isFinite(warmupMs) && atMs - warmupMs >= OPERATOR_PILOT_WARMUP_WINDOW_MS,
    pilotRunning: pilotStartedAt !== null,
    pilotQualified: false,
    pilotClockLabOnly: true,
    notThirtyDayQualification: true,
    clockIsNotQualification: true,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requiredIsoTime(value: unknown, field: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be a valid ISO time`)
  }
  return value
}

function requiredInteger(value: unknown, field: string, minimum = 0): number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new Error(`${field} must be an integer >= ${minimum}`)
  }
  return value as number
}

export function parseOperatorPilotClockDocument(raw: unknown): OperatorPilotClockV1 {
  if (!isRecord(raw)) throw new Error('operator pilot clock must be an object')
  if (raw.schema !== OPERATOR_PILOT_CLOCK_SCHEMA) throw new Error('operator pilot clock schema is invalid')
  const countersRaw = raw.counters
  if (!isRecord(countersRaw)) throw new Error('operator pilot clock counters must be an object')
  const warmupStartedAt = requiredIsoTime(raw.warmupStartedAt, 'warmupStartedAt')
  const pilotStartedAt = requiredIsoTime(raw.pilotStartedAt, 'pilotStartedAt')
  if (Date.parse(pilotStartedAt) - Date.parse(warmupStartedAt) < OPERATOR_PILOT_WARMUP_WINDOW_MS) {
    throw new Error(ERR_OPERATOR_PILOT_CLOCK_WARMUP)
  }
  return {
    schema: OPERATOR_PILOT_CLOCK_SCHEMA,
    warmupStartedAt,
    pilotStartedAt,
    epoch: requiredInteger(raw.epoch, 'epoch', 1),
    resetCount: requiredInteger(raw.resetCount, 'resetCount'),
    counters: {
      rotations: requiredInteger(countersRaw.rotations, 'counters.rotations'),
      rehomes: requiredInteger(countersRaw.rehomes, 'counters.rehomes'),
      takeovers: requiredInteger(countersRaw.takeovers, 'counters.takeovers'),
    },
    labOnly: true,
    notThirtyDayQualification: true,
    clockIsNotQualification: true,
    at: requiredIsoTime(raw.at, 'at'),
  }
}

export function operatorPilotClockDocument(input: {
  warmupStartedAt: string
  pilotStartedAt: string
  epoch?: number
  resetCount?: number
  counters?: { rotations: number; rehomes: number; takeovers: number }
  at?: string
}): string {
  return `${JSON.stringify(
    parseOperatorPilotClockDocument({
      schema: OPERATOR_PILOT_CLOCK_SCHEMA,
      warmupStartedAt: input.warmupStartedAt,
      pilotStartedAt: input.pilotStartedAt,
      epoch: input.epoch ?? 1,
      resetCount: input.resetCount ?? 0,
      counters: input.counters ?? { rotations: 0, rehomes: 0, takeovers: 0 },
      labOnly: true,
      notThirtyDayQualification: true,
      clockIsNotQualification: true,
      at: input.at ?? input.pilotStartedAt,
    }),
    null,
    2,
  )}\n`
}

export function parseOperatorPilotClockPost(
  body: unknown,
): { ok: true; value: OperatorPilotClockPost } | { ok: false; error: string } {
  if (!isRecord(body)) return { ok: false, error: ERR_OPERATOR_PILOT_CLOCK_BODY }
  if (body.start !== true) return { ok: false, error: ERR_OPERATOR_PILOT_CLOCK_REQUIRED }
  if (body.warmupStartedAt === undefined || body.pilotStartedAt === undefined) {
    return { ok: false, error: ERR_OPERATOR_PILOT_CLOCK_REQUIRED }
  }
  try {
    const warmupStartedAt = requiredIsoTime(body.warmupStartedAt, 'warmupStartedAt')
    const pilotStartedAt = requiredIsoTime(body.pilotStartedAt, 'pilotStartedAt')
    if (Date.parse(pilotStartedAt) - Date.parse(warmupStartedAt) < OPERATOR_PILOT_WARMUP_WINDOW_MS) {
      return { ok: false, error: ERR_OPERATOR_PILOT_CLOCK_WARMUP }
    }
    return { ok: true, value: { start: true, warmupStartedAt, pilotStartedAt } }
  } catch {
    return { ok: false, error: ERR_OPERATOR_PILOT_CLOCK_BODY }
  }
}

export function applyOperatorPilotClock(next: OperatorPilotClockV1): { ok: true } | { ok: false; error: string } {
  if (clock !== null) {
    if (clock.warmupStartedAt !== next.warmupStartedAt || clock.pilotStartedAt !== next.pilotStartedAt) {
      return { ok: false, error: ERR_OPERATOR_PILOT_CLOCK_MISMATCH }
    }
    return { ok: true }
  }
  clock = next
  return { ok: true }
}

export function operatorPilotClockFromPost(
  post: OperatorPilotClockPost,
  existing: OperatorPilotClockV1 | null = operatorPilotClock(),
): OperatorPilotClockV1 {
  return parseOperatorPilotClockDocument({
    schema: OPERATOR_PILOT_CLOCK_SCHEMA,
    warmupStartedAt: post.warmupStartedAt,
    pilotStartedAt: post.pilotStartedAt,
    epoch: existing?.epoch ?? 1,
    resetCount: existing?.resetCount ?? 0,
    counters: existing?.counters ?? { rotations: 0, rehomes: 0, takeovers: 0 },
    labOnly: true,
    notThirtyDayQualification: true,
    clockIsNotQualification: true,
    at: existing?.at ?? post.pilotStartedAt,
  })
}

export function commitOperatorPilotClock(
  dataDir: string,
  next: OperatorPilotClockV1,
): { ok: true } | { ok: false; error: string } {
  const applied = applyOperatorPilotClock(next)
  if (!applied.ok) return applied
  persistOperatorPilotClock(dataDir, operatorPilotClock() ?? next)
  return { ok: true }
}

export function persistOperatorPilotClock(dataDir: string, next: OperatorPilotClockV1): void {
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(join(dataDir, OPERATOR_PILOT_CLOCK_FILENAME), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
}

export function loadOperatorPilotClock(dataDir: string): OperatorPilotClockV1 | null {
  const path = join(dataDir, OPERATOR_PILOT_CLOCK_FILENAME)
  if (!existsSync(path)) {
    clock = null
    return null
  }
  try {
    const loaded = parseOperatorPilotClockDocument(JSON.parse(readFileSync(path, 'utf8')))
    clock = loaded
    return loaded
  } catch {
    clock = null
    return null
  }
}
