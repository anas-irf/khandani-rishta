import { describe, expect, it } from 'vitest'
import {
  ageFromDateOfBirth,
  calendarDaysBetween,
  cmToFeetInches,
  daysUntil,
  feetInchesToCm,
  formatDate,
  formatDayLabel,
  formatHeight,
  formatPhone,
  formatRelative,
  MAX_HEIGHT_CM,
  MIN_HEIGHT_CM,
  todayInKarachi,
} from './format'

describe('height (07 section 4.3)', () => {
  it('converts the picker bounds', () => {
    expect(feetInchesToCm(4, 0)).toBe(MIN_HEIGHT_CM)
    expect(feetInchesToCm(7, 0)).toBe(MAX_HEIGHT_CM)
  })

  it('round-trips every picker value unchanged', () => {
    for (let feet = 4; feet <= 7; feet += 1) {
      for (let inches = 0; inches <= (feet === 7 ? 0 : 11); inches += 1) {
        expect(cmToFeetInches(feetInchesToCm(feet, inches))).toEqual({ feet, inches })
      }
    }
  })

  it('formats as "5 ft 6 in (168 cm)"', () => {
    expect(formatHeight(168)).toBe('5 ft 6 in (168 cm)')
  })
})

describe('age in Asia/Karachi (03 section 6)', () => {
  it('counts whole years and respects the birthday', () => {
    const now = new Date('2026-11-20T12:00:00Z')
    expect(ageFromDateOfBirth('2008-11-20', now)).toBe(18)
    expect(ageFromDateOfBirth('2008-11-21', now)).toBe(17)
    expect(ageFromDateOfBirth('1990-01-01', now)).toBe(36)
  })

  it('uses the Karachi day boundary, not UTC', () => {
    // 20:00 UTC on 19 Nov is already 20 Nov in Karachi (UTC+5).
    const now = new Date('2026-11-19T20:00:00Z')
    expect(todayInKarachi(now)).toBe('2026-11-20')
    expect(ageFromDateOfBirth('2008-11-20', now)).toBe(18)
  })

  it('returns NaN for malformed dates', () => {
    expect(ageFromDateOfBirth('not-a-date')).toBeNaN()
  })
})

describe('relative times (16 rule G11)', () => {
  const now = new Date(2026, 10, 20, 15, 0, 0)

  it.each([
    [new Date(2026, 10, 20, 14, 59, 30), 'Just now'],
    [new Date(2026, 10, 20, 14, 55, 0), '5 min ago'],
    [new Date(2026, 10, 20, 12, 0, 0), '3 hours ago'],
    [new Date(2026, 10, 20, 0, 30, 0), '14 hours ago'],
    [new Date(2026, 10, 19, 23, 0, 0), 'Yesterday'],
    [new Date(2026, 10, 16, 9, 0, 0), '4 days ago'],
  ])('%s -> %s', (date, text) => {
    expect(formatRelative(date, now)).toBe(text)
  })

  it('shows the date after 7 days', () => {
    expect(formatRelative(new Date(2026, 10, 1, 9, 0, 0), now)).toBe(
      formatDate(new Date(2026, 10, 1, 9)),
    )
  })

  it('labels chat day separators', () => {
    expect(formatDayLabel(new Date(2026, 10, 20, 9), now)).toBe('Today')
    expect(formatDayLabel(new Date(2026, 10, 19, 9), now)).toBe('Yesterday')
    expect(formatDayLabel(new Date(2026, 10, 2, 9), now)).toBe('2 November 2026')
  })

  it('counts calendar days', () => {
    expect(calendarDaysBetween(new Date(2026, 10, 19, 23), new Date(2026, 10, 20, 1))).toBe(1)
  })
})

describe('dates', () => {
  it('reads a plain date as a calendar day in every time zone', () => {
    expect(formatDate('2026-12-01')).toBe('1 Dec 2026')
  })

  it('returns an empty string for invalid input', () => {
    expect(formatDate('nope')).toBe('')
  })

  it('counts days until a date, never negative', () => {
    const now = new Date('2026-11-20T00:00:00Z')
    expect(daysUntil('2026-11-23T00:00:00Z', now)).toBe(3)
    expect(daysUntil('2026-11-01T00:00:00Z', now)).toBe(0)
  })
})

describe('formatPhone', () => {
  it('spaces Pakistani mobile numbers and leaves others as they are', () => {
    expect(formatPhone('+923001234567')).toBe('+92 300 1234567')
    expect(formatPhone('+447700900123')).toBe('+447700900123')
    expect(formatPhone(null)).toBe('')
  })
})
