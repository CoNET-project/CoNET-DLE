import type { OperatorDomainV1 } from './model.js'
import { assertOperatorDomainPreflight } from './inventory.js'

export interface SchedulerTick {
  tick: number
  activeDomain: OperatorDomainV1
  activeDomains: readonly OperatorDomainV1[]
  standbyDomains: readonly OperatorDomainV1[]
  startedAt: string
}

export type SchedulerWork = (tick: SchedulerTick) => Promise<void>

export class SerialPilotScheduler {
  readonly #delayMs: number
  readonly #work: SchedulerWork
  #active: OperatorDomainV1[]
  #standby: OperatorDomainV1[]
  #timer: NodeJS.Timeout | undefined
  #running = false
  #inFlight = false
  #tick = 0
  #idleWaiters: Array<() => void> = []

  constructor(domains: readonly OperatorDomainV1[], delayMs: number, work: SchedulerWork) {
    if (!Number.isFinite(delayMs) || delayMs < 0) throw new Error('delayMs must be non-negative')
    assertOperatorDomainPreflight({
      schema: 'PilotInventoryV1',
      pilotId: 'scheduler-preflight',
      generatedAt: new Date().toISOString(),
      domains: [...domains],
    })
    this.#active = domains.filter((domain) => domain.role === 'active')
    this.#standby = domains.filter((domain) => domain.role === 'standby')
    if (this.#active.length !== 5 || this.#standby.length !== 2) {
      throw new Error('scheduler requires exactly five active and two standby domains')
    }
    this.#delayMs = delayMs
    this.#work = work
  }

  get topology(): { active: readonly OperatorDomainV1[]; standby: readonly OperatorDomainV1[] } {
    return { active: [...this.#active], standby: [...this.#standby] }
  }

  start(): void {
    if (this.#running) return
    this.#running = true
    this.#schedule(0)
  }

  stop(): void {
    this.#running = false
    if (this.#timer !== undefined) clearTimeout(this.#timer)
    this.#timer = undefined
  }

  waitForIdle(): Promise<void> {
    if (!this.#inFlight) return Promise.resolve()
    return new Promise<void>((resolve) => {
      this.#idleWaiters.push(resolve)
    })
  }

  async runOnce(): Promise<void> {
    if (this.#inFlight) throw new Error('scheduler overlap rejected')
    this.#inFlight = true
    const tick = this.#tick
    const activeDomain = this.#active[tick % this.#active.length]
    if (activeDomain === undefined) throw new Error('active topology is empty')
    this.#tick += 1
    try {
      await this.#work({
        tick,
        activeDomain,
        activeDomains: [...this.#active],
        standbyDomains: [...this.#standby],
        startedAt: new Date().toISOString(),
      })
    } finally {
      this.#inFlight = false
      for (const resolve of this.#idleWaiters.splice(0)) resolve()
    }
  }

  simulateTakeover(failedDomainId: string): { promoted: string; demoted: string } {
    if (this.#inFlight) throw new Error('topology cannot change during an in-flight tick')
    const failedIndex = this.#active.findIndex((domain) => domain.domainId === failedDomainId)
    if (failedIndex < 0) throw new Error(`active domain not found: ${failedDomainId}`)
    const promoted = this.#standby.shift()
    if (promoted === undefined) throw new Error('no standby domain available')
    const failed = this.#active[failedIndex]
    if (failed === undefined) throw new Error('failed domain disappeared')
    this.#active[failedIndex] = { ...promoted, role: 'active' }
    this.#standby.push({ ...failed, role: 'standby' })
    return { promoted: promoted.domainId, demoted: failed.domainId }
  }

  #schedule(delayMs: number): void {
    if (!this.#running) return
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      void this.runOnce()
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          process.stderr.write(`pilot scheduler tick failed: ${message}\n`)
        })
        .finally(() => {
          if (this.#running) this.#schedule(this.#delayMs)
        })
    }, delayMs)
  }
}
