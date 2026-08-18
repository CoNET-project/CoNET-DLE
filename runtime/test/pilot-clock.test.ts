import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ERR_OPERATOR_PILOT_CLOCK_MISMATCH,
  ERR_OPERATOR_PILOT_CLOCK_REQUIRED,
  ERR_OPERATOR_PILOT_CLOCK_WARMUP,
  OPERATOR_PILOT_CLOCK_FILENAME,
  OPERATOR_PILOT_CLOCK_SCHEMA,
  applyOperatorPilotClock,
  commitOperatorPilotClock,
  loadOperatorPilotClock,
  operatorPilotClock,
  operatorPilotClockDocument,
  operatorPilotClockFromPost,
  operatorPilotClockHealth,
  parseOperatorPilotClockPost,
  persistOperatorPilotClock,
  resetOperatorPilotClockForTests,
} from '../src/archive/pilotClock.js'

const dirs: string[] = []
const LIVE_WARMUP = '2026-08-14T17:10:16.786Z'
const LIVE_PILOT = '2026-08-18T09:00:00.000Z'

after(async () => {
  resetOperatorPilotClockForTests()
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dle-pilot-clock-'))
  dirs.push(dir)
  return dir
}

test('operator pilot clock requires stamped warmup plus pilot ISO and refuses rewind', () => {
  resetOperatorPilotClockForTests()
  assert.deepEqual(parseOperatorPilotClockPost({ start: true }), {
    ok: false,
    error: ERR_OPERATOR_PILOT_CLOCK_REQUIRED,
  })
  assert.equal(parseOperatorPilotClockPost({ start: true, warmupStartedAt: LIVE_WARMUP }).ok, false)
  const tooSoon = parseOperatorPilotClockPost({
    start: true,
    warmupStartedAt: LIVE_WARMUP,
    pilotStartedAt: '2026-08-17T17:10:16.785Z',
  })
  assert.deepEqual(tooSoon, { ok: false, error: ERR_OPERATOR_PILOT_CLOCK_WARMUP })
  const parsed = parseOperatorPilotClockPost({
    start: true,
    warmupStartedAt: LIVE_WARMUP,
    pilotStartedAt: LIVE_PILOT,
  })
  assert.equal(parsed.ok, true)
  if (!parsed.ok) throw new Error('expected stamped post')
  const first = applyOperatorPilotClock(operatorPilotClockFromPost(parsed.value))
  assert.equal(first.ok, true)
  assert.equal(operatorPilotClock()?.pilotStartedAt, LIVE_PILOT)
  assert.deepEqual(applyOperatorPilotClock(operatorPilotClockFromPost(parsed.value)), { ok: true })
  assert.deepEqual(
    applyOperatorPilotClock(
      operatorPilotClockFromPost({
        start: true,
        warmupStartedAt: LIVE_WARMUP,
        pilotStartedAt: '2026-08-18T10:00:00.000Z',
      }),
    ),
    { ok: false, error: ERR_OPERATOR_PILOT_CLOCK_MISMATCH },
  )
})

test('operator pilot clock persists one stamped document and health never claims qualification', async () => {
  resetOperatorPilotClockForTests()
  const dir = await tempDir()
  const document = operatorPilotClockDocument({
    warmupStartedAt: LIVE_WARMUP,
    pilotStartedAt: LIVE_PILOT,
    epoch: 1,
    resetCount: 0,
    counters: { rotations: 0, rehomes: 0, takeovers: 0 },
  })
  persistOperatorPilotClock(dir, JSON.parse(document))
  assert.equal(existsSync(join(dir, OPERATOR_PILOT_CLOCK_FILENAME)), true)
  const loaded = loadOperatorPilotClock(dir)
  assert.equal(loaded?.schema, OPERATOR_PILOT_CLOCK_SCHEMA)
  assert.equal(loaded?.pilotStartedAt, LIVE_PILOT)
  assert.equal(loaded?.warmupStartedAt, LIVE_WARMUP)
  const health = operatorPilotClockHealth(Date.parse(LIVE_PILOT))
  assert.equal(health.pilotStartedAt, LIVE_PILOT)
  assert.equal(health.warmupComplete, true)
  assert.equal(health.pilotRunning, true)
  assert.equal(health.pilotQualified, false)
  assert.equal(health.clockIsNotQualification, true)
  assert.equal(health.notThirtyDayQualification, true)
  resetOperatorPilotClockForTests()
  const again = loadOperatorPilotClock(dir)
  assert.equal(again?.pilotStartedAt, LIVE_PILOT)
  const committed = commitOperatorPilotClock(dir, again!)
  assert.equal(committed.ok, true)
  const persisted = JSON.parse(readFileSync(join(dir, OPERATOR_PILOT_CLOCK_FILENAME), 'utf8')) as {
    pilotStartedAt: string
  }
  assert.equal(persisted.pilotStartedAt, LIVE_PILOT)
})
