import type { PilotCountersV1, PilotGateSnapshotV1 } from './model.js'

export const WARMUP_WINDOW_MS = 72 * 60 * 60 * 1_000
export const PILOT_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000
export const REQUIRED_COUNTERS: Readonly<PilotCountersV1> = {
  rotations: 100,
  rehomes: 30,
  takeovers: 100,
}

export interface GateEvaluation {
  warmupComplete: boolean
  pilotRunning: boolean
  continuousWindowComplete: boolean
  countersComplete: boolean
  qualified: boolean
  remaining: PilotCountersV1
}

export class PilotQualificationGate {
  #epoch = 1
  #warmupStartedAtMs: number
  #pilotStartedAtMs: number | null = null
  #lastSafetyFailureAtMs: number | null = null
  #lastObservedAtMs: number
  #resetCount = 0
  #counters: PilotCountersV1 = { rotations: 0, rehomes: 0, takeovers: 0 }

  constructor(startedAtMs: number = Date.now()) {
    this.#warmupStartedAtMs = startedAtMs
    this.#lastObservedAtMs = startedAtMs
  }

  static fromSnapshot(snapshot: PilotGateSnapshotV1): PilotQualificationGate {
    const parsed = parsePilotGateSnapshot(snapshot)
    const warmupMs = Date.parse(parsed.warmupStartedAt)
    const gate = new PilotQualificationGate(warmupMs)
    gate.#epoch = parsed.epoch
    gate.#resetCount = parsed.resetCount
    gate.#counters = { ...parsed.counters }
    gate.#pilotStartedAtMs = parsed.pilotStartedAt === null ? null : Date.parse(parsed.pilotStartedAt)
    gate.#lastSafetyFailureAtMs =
      parsed.lastSafetyFailureAt === null ? null : Date.parse(parsed.lastSafetyFailureAt)
    const observed = [warmupMs]
    if (gate.#pilotStartedAtMs !== null) observed.push(gate.#pilotStartedAtMs)
    if (gate.#lastSafetyFailureAtMs !== null) observed.push(gate.#lastSafetyFailureAtMs)
    gate.#lastObservedAtMs = Math.max(...observed)
    return gate
  }

  startPilotClock(atMs: number = Date.now()): PilotGateSnapshotV1 {
    this.#observe(atMs)
    if (atMs - this.#warmupStartedAtMs < WARMUP_WINDOW_MS) {
      throw new Error('warmup window is not complete')
    }
    if (this.#pilotStartedAtMs === null) this.#pilotStartedAtMs = atMs
    return this.snapshot()
  }

  evaluate(atMs: number = Date.now()): GateEvaluation {
    this.#observe(atMs)
    const warmupComplete = atMs - this.#warmupStartedAtMs >= WARMUP_WINDOW_MS
    if (warmupComplete && this.#pilotStartedAtMs === null) this.#pilotStartedAtMs = atMs
    const continuousWindowComplete =
      this.#pilotStartedAtMs !== null && atMs - this.#pilotStartedAtMs >= PILOT_WINDOW_MS
    const remaining: PilotCountersV1 = {
      rotations: Math.max(0, REQUIRED_COUNTERS.rotations - this.#counters.rotations),
      rehomes: Math.max(0, REQUIRED_COUNTERS.rehomes - this.#counters.rehomes),
      takeovers: Math.max(0, REQUIRED_COUNTERS.takeovers - this.#counters.takeovers),
    }
    const countersComplete = Object.values(remaining).every((value) => value === 0)
    return {
      warmupComplete,
      pilotRunning: this.#pilotStartedAtMs !== null,
      continuousWindowComplete,
      countersComplete,
      qualified: continuousWindowComplete && countersComplete,
      remaining,
    }
  }

  recordCounter(kind: keyof PilotCountersV1, amount = 1, atMs: number = Date.now()): void {
    if (!Number.isInteger(amount) || amount <= 0) throw new Error('counter amount must be positive integer')
    const status = this.evaluate(atMs)
    if (!status.pilotRunning) throw new Error('counter cannot be recorded before warmup gate')
    this.#counters[kind] += amount
  }

  recordSafetyFailure(atMs: number = Date.now()): PilotGateSnapshotV1 {
    this.#observe(atMs)
    this.#lastSafetyFailureAtMs = atMs
    this.#epoch += 1
    this.#resetCount += 1
    this.#warmupStartedAtMs = atMs
    this.#pilotStartedAtMs = null
    this.#counters = { rotations: 0, rehomes: 0, takeovers: 0 }
    return this.snapshot()
  }

  snapshot(): PilotGateSnapshotV1 {
    return {
      schema: 'PilotGateSnapshotV1',
      epoch: this.#epoch,
      warmupStartedAt: new Date(this.#warmupStartedAtMs).toISOString(),
      pilotStartedAt:
        this.#pilotStartedAtMs === null ? null : new Date(this.#pilotStartedAtMs).toISOString(),
      lastSafetyFailureAt:
        this.#lastSafetyFailureAtMs === null
          ? null
          : new Date(this.#lastSafetyFailureAtMs).toISOString(),
      resetCount: this.#resetCount,
      counters: { ...this.#counters },
    }
  }

  #observe(atMs: number): void {
    if (!Number.isFinite(atMs) || atMs < this.#lastObservedAtMs) {
      throw new Error('gate observation time must be monotonic')
    }
    this.#lastObservedAtMs = atMs
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

export function parsePilotGateSnapshot(raw: unknown): PilotGateSnapshotV1 {
  if (!isRecord(raw)) throw new Error('gate snapshot must be an object')
  if (raw.schema !== 'PilotGateSnapshotV1') throw new Error('gate snapshot schema is invalid')
  const countersRaw = raw.counters
  if (!isRecord(countersRaw)) throw new Error('gate snapshot counters must be an object')
  const counters = {
    rotations: requiredInteger(countersRaw.rotations, 'counters.rotations'),
    rehomes: requiredInteger(countersRaw.rehomes, 'counters.rehomes'),
    takeovers: requiredInteger(countersRaw.takeovers, 'counters.takeovers'),
  }
  return {
    schema: 'PilotGateSnapshotV1',
    epoch: requiredInteger(raw.epoch, 'epoch', 1),
    warmupStartedAt: requiredIsoTime(raw.warmupStartedAt, 'warmupStartedAt'),
    pilotStartedAt: raw.pilotStartedAt === null ? null : requiredIsoTime(raw.pilotStartedAt, 'pilotStartedAt'),
    lastSafetyFailureAt:
      raw.lastSafetyFailureAt === null ? null : requiredIsoTime(raw.lastSafetyFailureAt, 'lastSafetyFailureAt'),
    resetCount: requiredInteger(raw.resetCount, 'resetCount'),
    counters,
  }
}
