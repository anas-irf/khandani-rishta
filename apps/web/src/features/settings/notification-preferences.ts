import type { NotificationPreferences } from '~/lib/api-types'

/**
 * The notification preferences of 14 section 6.1 as the SET-NOTIFS screen edits them. The API
 * object may carry more keys later; they are kept and sent back unchanged (the screen always
 * sends the complete object, 16 section 6.26).
 */

/** Some keys of the preferences: a change, or an object read with safe defaults. */
export type PreferencesPatch = Partial<NotificationPreferences>

export type PreferenceSwitch =
  | 'push_interests'
  | 'push_messages'
  | 'push_photo_requests'
  | 'push_matches'
  | 'push_profile_views'
  | 'email_interests'
  | 'email_messages'
  | 'email_announcements'

/** Values offered when quiet hours are first turned on (16 section 6.26). */
export const DEFAULT_QUIET_HOURS = { start: '22:00', end: '07:00' } as const

/** "22:00:00" or "22:00" as the value of `<input type="time">` ("22:00"); null stays null. */
export function toTimeValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{2}):(\d{2})/.exec(value)
  return match ? `${match[1]}:${match[2]}` : null
}

export function switchValue(preferences: PreferencesPatch, key: PreferenceSwitch): boolean {
  return preferences[key] === true
}

export function digestValue(
  preferences: PreferencesPatch,
): NotificationPreferences['email_match_digest'] {
  return preferences.email_match_digest ?? 'off'
}

/** Quiet hours are on when both times are set (they are both set or both null, 14 section 6.2). */
export function quietHoursOn(preferences: PreferencesPatch): boolean {
  return (
    toTimeValue(preferences.quiet_hours_start) !== null &&
    toTimeValue(preferences.quiet_hours_end) !== null
  )
}

/** The change that turns quiet hours on (22:00 to 07:00) or off (both null). */
export function quietHoursToggle(on: boolean): PreferencesPatch {
  return on
    ? { quiet_hours_start: DEFAULT_QUIET_HOURS.start, quiet_hours_end: DEFAULT_QUIET_HOURS.end }
    : { quiet_hours_start: null, quiet_hours_end: null }
}

/**
 * The change for one of the two time pickers. An empty value (the field was cleared) changes
 * nothing, so the pair never ends up half set.
 */
export function quietTimeChange(which: 'start' | 'end', value: string): PreferencesPatch {
  const time = toTimeValue(value)
  if (!time) return {}
  return which === 'start' ? { quiet_hours_start: time } : { quiet_hours_end: time }
}

/** Whether the window crosses midnight (start later than end, 14 section 6.2). */
export function crossesMidnight(start: string, end: string): boolean {
  return start > end
}
