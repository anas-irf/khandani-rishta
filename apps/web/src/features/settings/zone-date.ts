import { i18n } from '~/lib/i18n'

/** A date such as "4 December 2026" in a given IANA time zone (16 section 6.2 "in the user's time zone"). */
export function formatLongDateInZone(
  value: string | Date | null | undefined,
  timeZone?: string | null,
): string {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const locale = i18n.language === 'ur' ? 'ur-PK' : 'en-PK'
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: timeZone || undefined }).format(
      date,
    )
  } catch {
    // An unknown time zone name: use the device's.
    return new Intl.DateTimeFormat(locale, options).format(date)
  }
}

/** The day the grace period of a deletion started now would end (06 section 9.5). */
export function purgeDateFromNow(graceDays: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + graceDays * 86_400_000)
}
