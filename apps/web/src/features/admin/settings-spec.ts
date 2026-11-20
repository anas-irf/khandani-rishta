/**
 * Validation and grouping of `app_settings` keys (18 section 7.1, 03 section 7). The API
 * enforces the same ranges (`400 validation_failed`, field `value`); this table gives the
 * screen type-aware inputs and quick feedback.
 */

export type SettingRule =
  | { kind: 'int'; min: number; max: number }
  | { kind: 'moderation' }
  | { kind: 'bool' }
  | { kind: 'date' }
  | { kind: 'email' }
  | { kind: 'banner' }

const int = (min: number, max: number): SettingRule => ({ kind: 'int', min, max })

export const SETTING_RULES: Record<string, SettingRule> = {
  'limits.interests_per_day': int(1, 200),
  'limits.interests_per_day_verified': int(1, 200),
  'limits.pending_interests_max': int(5, 500),
  'limits.profile_views_per_day': int(10, 2000),
  'limits.photo_requests_per_day': int(1, 100),
  'limits.messages_per_minute': int(5, 120),
  'limits.messages_per_day': int(50, 5000),
  'limits.reports_per_day': int(1, 50),
  'limits.photos_max': int(1, 10),
  'limits.saved_searches_max': int(1, 50),
  'limits.active_connections_max': int(5, 200),
  'interest.expiry_days': int(3, 90),
  'interest.cooldown_after_decline_days': int(0, 365),
  'interest.cooldown_after_expiry_days': int(0, 365),
  'interest.cooldown_after_withdraw_days': int(0, 365),
  'connection.cooldown_after_end_days': int(0, 365),
  'photo_access.retry_days': int(0, 365),
  'pass.duration_days': int(7, 730),
  'moderation.profile_review': { kind: 'moderation' },
  'moderation.photo_review': { kind: 'moderation' },
  'moderation.text_review': { kind: 'moderation' },
  'onboarding.identity_required': { kind: 'bool' },
  'onboarding.photo_required': { kind: 'bool' },
  'matching.candidate_pool_size': int(100, 2000),
  'matching.recommendations_size': int(20, 500),
  'matching.refresh_hours': int(1, 168),
  'account.deletion_grace_days': int(1, 90),
  'verification.media_retention_days': int(1, 180),
  'legal.terms_version': { kind: 'date' },
  'legal.privacy_version': { kind: 'date' },
  'legal.guidelines_version': { kind: 'date' },
  'support.email': { kind: 'email' },
  'announcement.banner': { kind: 'banner' },
}

/** The groups of the screen, in order, by key prefix. */
export const SETTING_GROUPS = [
  'limits',
  'interest',
  'connection',
  'photo_access',
  'pass',
  'moderation',
  'onboarding',
  'matching',
  'account',
  'verification',
  'legal',
  'support',
  'announcement',
] as const

export function settingGroup(key: string): string {
  return key.split('.')[0] ?? key
}

/** A validation problem: an i18n code of `admin:validation` plus its arguments. */
export type SettingProblem = { code: string; min?: number | string; max?: number | string }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function numberOf(all: Record<string, unknown>, key: string): number | null {
  const value = all[key]
  return typeof value === 'number' ? value : null
}

function validateInt(
  key: string,
  value: unknown,
  rule: { min: number; max: number },
  all: Record<string, unknown>,
): SettingProblem | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return { code: 'required' }
  if (value < rule.min || value > rule.max) {
    return { code: 'out_of_range', min: rule.min, max: rule.max }
  }
  // The verified limit is at least the normal one; recommendations fit in the pool.
  const lower: Record<string, string> = {
    'limits.interests_per_day_verified': 'limits.interests_per_day',
    'matching.candidate_pool_size': 'matching.recommendations_size',
  }
  const upper: Record<string, string> = {
    'limits.interests_per_day': 'limits.interests_per_day_verified',
    'matching.recommendations_size': 'matching.candidate_pool_size',
  }
  const floor = lower[key] ? numberOf(all, lower[key]) : null
  if (floor !== null && value < floor) return { code: 'at_least_setting', min: floor }
  const ceiling = upper[key] ? numberOf(all, upper[key]) : null
  if (ceiling !== null && value > ceiling) return { code: 'at_most_setting', max: ceiling }
  return null
}

/**
 * The English text of an `announcement.banner` value, `null` when no banner is set. Setting
 * values are any JSON (18 section 7.1), so the value is read rather than assumed.
 */
export function bannerText(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('text_en' in value)) return null
  return typeof value.text_en === 'string' && value.text_en ? value.text_en : null
}

function validateBanner(value: unknown): SettingProblem | null {
  if (value === null) return null
  if (typeof value !== 'object') return { code: 'invalid' }
  const banner = value as { text_en?: unknown; text_ur?: unknown; url?: unknown }
  if (typeof banner.text_en !== 'string' || banner.text_en.trim().length === 0) {
    return { code: 'required' }
  }
  if (banner.text_en.length > 200) return { code: 'too_long', max: 200 }
  if (typeof banner.text_ur === 'string' && banner.text_ur.length > 200) {
    return { code: 'too_long', max: 200 }
  }
  if (typeof banner.url === 'string' && banner.url && !banner.url.startsWith('https://')) {
    return { code: 'url_prefix', min: 'https://', max: 'https://' }
  }
  return null
}

/** `all` holds the saved values of every key, for the rules that compare two settings. */
export function validateSetting(
  key: string,
  value: unknown,
  all: Record<string, unknown>,
): SettingProblem | null {
  const rule = SETTING_RULES[key]
  if (!rule) return null
  switch (rule.kind) {
    case 'int':
      return validateInt(key, value, rule, all)
    case 'moderation':
      return value === 'auto' || value === 'manual' ? null : { code: 'invalid' }
    case 'bool':
      return typeof value === 'boolean' ? null : { code: 'invalid' }
    case 'date': {
      if (typeof value !== 'string' || !ISO_DATE.test(value)) return { code: 'invalid' }
      const current = all[key]
      if (typeof current === 'string' && value < current) {
        return { code: 'not_earlier', min: current }
      }
      return null
    }
    case 'email':
      return typeof value === 'string' && EMAIL.test(value.trim()) ? null : { code: 'invalid' }
    case 'banner':
      return validateBanner(value)
    default:
      return null
  }
}

/** The key (under `admin:settings.warning`) of the warning to show before saving, if any. */
export function settingWarning(key: string, value: unknown): string | null {
  if (key.startsWith('legal.')) return 'legal'
  if (key === 'moderation.photo_review' && value === 'auto') return 'photo_review_auto'
  if (key === 'onboarding.identity_required' && value === false) return 'identity_not_required'
  return null
}

/** Two values are the same setting value (objects compared by content). */
export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
