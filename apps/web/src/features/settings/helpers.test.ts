import { describe, expect, it } from 'vitest'
import { nameExamples } from './name-examples'
import {
  crossesMidnight,
  DEFAULT_QUIET_HOURS,
  digestValue,
  quietHoursOn,
  quietHoursToggle,
  quietTimeChange,
  switchValue,
  toTimeValue,
} from './notification-preferences'
import { formatLongDateInZone, purgeDateFromNow } from './zone-date'

describe('nameExamples (09 section 4.2)', () => {
  it('renders every option for Ayesha Khan', () => {
    expect(nameExamples('Ayesha', 'Khan', 'KR7F3K2QX9')).toEqual({
      full_name: 'Ayesha Khan',
      first_name_last_initial: 'Ayesha K.',
      first_name_only: 'Ayesha',
      initials: 'A. K.',
      code_only: 'KR7F3K2QX9',
    })
  })

  it('keeps a first name of several words whole and uses the first word for initials', () => {
    expect(nameExamples('Muhammad Ali', 'Raza', 'KR2M8PQ4TZ')).toMatchObject({
      first_name_last_initial: 'Muhammad Ali R.',
      first_name_only: 'Muhammad Ali',
      initials: 'M. R.',
    })
    expect(nameExamples('Sana', 'Khan Niazi', 'KR9A1BC3DE')).toMatchObject({
      first_name_last_initial: 'Sana K.',
      initials: 'S. K.',
    })
    expect(nameExamples('Bilal', 'ul Haq', 'KR5H7JK2MN')).toMatchObject({
      first_name_last_initial: 'Bilal U.',
      initials: 'B. U.',
    })
  })

  it('upper-cases the initials', () => {
    expect(nameExamples('ayesha', 'khan', 'X').initials).toBe('A. K.')
  })

  it('falls back to what is known while the last name has not loaded', () => {
    expect(nameExamples('Ayesha', undefined, 'KR1')).toMatchObject({
      full_name: 'Ayesha',
      first_name_last_initial: 'Ayesha',
      initials: 'A.',
    })
  })
})

describe('notification preference helpers (14 section 6)', () => {
  it('reads a time value from a time column', () => {
    expect(toTimeValue('22:00:00')).toBe('22:00')
    expect(toTimeValue('07:30')).toBe('07:30')
    expect(toTimeValue(null)).toBeNull()
    expect(toTimeValue('')).toBeNull()
    expect(toTimeValue(12)).toBeNull()
  })

  it('knows when quiet hours are on: both times set', () => {
    expect(quietHoursOn({ quiet_hours_start: '22:00', quiet_hours_end: '07:00' })).toBe(true)
    expect(quietHoursOn({ quiet_hours_start: null, quiet_hours_end: null })).toBe(false)
    expect(quietHoursOn({ quiet_hours_start: '22:00', quiet_hours_end: null })).toBe(false)
  })

  it('turns quiet hours on with 22:00 and 07:00 and off with both null', () => {
    expect(quietHoursToggle(true)).toEqual({
      quiet_hours_start: DEFAULT_QUIET_HOURS.start,
      quiet_hours_end: DEFAULT_QUIET_HOURS.end,
    })
    expect(DEFAULT_QUIET_HOURS).toEqual({ start: '22:00', end: '07:00' })
    expect(quietHoursToggle(false)).toEqual({ quiet_hours_start: null, quiet_hours_end: null })
  })

  it('changes one time at a time and ignores a cleared field', () => {
    expect(quietTimeChange('start', '23:15')).toEqual({ quiet_hours_start: '23:15' })
    expect(quietTimeChange('end', '06:00')).toEqual({ quiet_hours_end: '06:00' })
    expect(quietTimeChange('start', '')).toEqual({})
  })

  it('knows a window that crosses midnight', () => {
    expect(crossesMidnight('23:00', '07:00')).toBe(true)
    expect(crossesMidnight('13:00', '15:00')).toBe(false)
  })

  it('reads the switches and the digest with safe defaults', () => {
    expect(switchValue({ push_interests: true }, 'push_interests')).toBe(true)
    expect(switchValue({}, 'push_interests')).toBe(false)
    expect(digestValue({ email_match_digest: 'daily' })).toBe('daily')
    expect(digestValue({})).toBe('off')
  })
})

describe('dates in the member time zone', () => {
  it('formats a date in the given zone, so the day follows the member and not the device', () => {
    // 00:00 UTC is 05:00 in Karachi (the same day) and 19:00 the day before in New York.
    expect(formatLongDateInZone('2026-12-04T00:00:00Z', 'Asia/Karachi')).toBe('4 December 2026')
    expect(formatLongDateInZone('2026-12-04T00:00:00Z', 'America/New_York')).toBe('3 December 2026')
  })

  it('falls back to the device zone for an unknown zone and shows nothing for no date', () => {
    expect(formatLongDateInZone('2026-12-04T12:00:00Z', 'Not/AZone')).toMatch(/December 2026$/)
    expect(formatLongDateInZone(null, 'Asia/Karachi')).toBe('')
    expect(formatLongDateInZone('not a date', 'Asia/Karachi')).toBe('')
  })

  it('computes the purge date from the grace days, never from a fixed 30', () => {
    const now = new Date('2026-11-20T10:00:00Z')
    expect(purgeDateFromNow(30, now).toISOString()).toBe('2026-12-20T10:00:00.000Z')
    expect(purgeDateFromNow(14, now).toISOString()).toBe('2026-12-04T10:00:00.000Z')
  })
})
