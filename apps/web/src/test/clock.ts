import { afterEach, beforeEach, vi } from 'vitest'

/** A day on which every fixed date of the mock data still holds: no interest has expired. */
const SEEDED_NOW = '2026-11-22T08:00:00Z'

/**
 * For a test file that reads the mock data's fixed dates against the current time. Each test
 * starts at `SEEDED_NOW`, and the time runs on from there. Timers stay real.
 */
export function pinSeededClock() {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
    vi.setSystemTime(SEEDED_NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })
}
