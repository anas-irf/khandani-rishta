import { i18n } from './i18n'

/**
 * Formatting helpers: age, height, dates and relative times. Numbers stay in Western digits
 * in every language; dates use `Intl.DateTimeFormat` with the active locale (17 section 12).
 */

export const MIN_HEIGHT_CM = 122
export const MAX_HEIGHT_CM = 213

/** Feet and inches to centimetres, rounding half up (07 section 4.3). */
export function feetInchesToCm(feet: number, inches: number): number {
  return Math.floor((feet * 12 + inches) * 2.54 + 0.5)
}

/** Centimetres to feet and inches for display (07 section 4.3). */
export function cmToFeetInches(heightCm: number): { feet: number; inches: number } {
  const totalInches = Math.round(heightCm / 2.54)
  return { feet: Math.floor(totalInches / 12), inches: totalInches % 12 }
}

/** "5 ft 6 in (168 cm)" (07 section 4.3). */
export function formatHeight(heightCm: number): string {
  const { feet, inches } = cmToFeetInches(heightCm)
  return i18n.t('common:format.height', { feet, inches, cm: heightCm })
}

/** "5 ft 6 in" without the centimetres, for compact ranges. */
export function formatHeightShort(heightCm: number): string {
  const { feet, inches } = cmToFeetInches(heightCm)
  return i18n.t('common:format.height_short', { feet, inches })
}

/** Today's date in Asia/Karachi as YYYY-MM-DD (day boundaries, specs README section 4). */
export function todayInKarachi(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** Whole years between a YYYY-MM-DD date of birth and today in Asia/Karachi (03 section 6). */
export function ageFromDateOfBirth(dateOfBirth: string, now: Date = new Date()): number {
  const [by, bm, bd] = dateOfBirth.split('-').map(Number)
  const [ty, tm, td] = todayInKarachi(now).split('-').map(Number)
  if (!by || !bm || !bd || !ty || !tm || !td) return Number.NaN
  let age = ty - by
  if (tm < bm || (tm === bm && td < bd)) age -= 1
  return age
}

/** Dates are written the Pakistani way (`1 Dec 2026`) in both languages. */
function locale(): string {
  return i18n.language === 'ur' ? 'ur-PK' : 'en-PK'
}

function toDate(value: string | Date): Date {
  if (value instanceof Date) return value
  // A plain date (YYYY-MM-DD) is a calendar day, not an instant: read it at noon UTC so the
  // day does not shift in any time zone.
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value)
}

/** "20 Nov 2026" in the device's time zone. */
export function formatDate(value: string | Date): string {
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(locale(), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

/** "20 November 2026". */
export function formatLongDate(value: string | Date): string {
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(locale(), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

/** "3:45 PM" for chat messages (16 rule G11). */
export function formatTime(value: string | Date): string {
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(locale(), { hour: 'numeric', minute: '2-digit' }).format(date)
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** Whole calendar days between two instants in the device's time zone. */
export function calendarDaysBetween(earlier: Date, later: Date): number {
  return Math.round((startOfDay(later) - startOfDay(earlier)) / 86_400_000)
}

/**
 * Relative for the last 7 days ("Just now", "5 min ago", "3 hours ago", "Yesterday",
 * "4 days ago"), then the date (16 rule G11).
 */
export function formatRelative(value: string | Date, now: Date = new Date()): string {
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return ''
  const seconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000))
  if (seconds < 60) return i18n.t('common:time.just_now')
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return i18n.t('common:time.minutes_ago', { count: minutes })
  const days = calendarDaysBetween(date, now)
  if (days === 0) return i18n.t('common:time.hours_ago', { count: Math.floor(minutes / 60) })
  if (days === 1) return i18n.t('common:time.yesterday')
  if (days < 7) return i18n.t('common:time.days_ago', { count: days })
  return formatDate(date)
}

/** Day separators in chat: "Today", "Yesterday", then the date (16 rule G11). */
export function formatDayLabel(value: string | Date, now: Date = new Date()): string {
  const date = toDate(value)
  const days = calendarDaysBetween(date, now)
  if (days === 0) return i18n.t('common:time.today')
  if (days === 1) return i18n.t('common:time.yesterday')
  return formatLongDate(date)
}

/** Days from now until a date, rounded up, never negative. */
export function daysUntil(value: string | Date, now: Date = new Date()): number {
  const date = toDate(value)
  return Math.max(0, Math.ceil((date.getTime() - now.getTime()) / 86_400_000))
}

/** A phone number in E.164 shown with a space after the dial code when it is known. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return ''
  const match = /^\+92(\d{3})(\d{7})$/.exec(e164)
  return match ? `+92 ${match[1]} ${match[2]}` : e164
}
