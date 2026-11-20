import type { Me, ProfileStatus } from './api-types'
import { toSlug } from './utils'

/**
 * Pure routing rules (17 section 4.2). The gate from `GET /v1/me` is the only input that
 * decides where a signed-in member may go. Every row of the tables in 17 section 4.2 has a
 * unit test in gate.test.ts; keep this file and 16 section 3.2 equal.
 */

/** Onboarding step order (03 section 4.3). */
export const ONBOARDING_STEPS = [
  'account_for',
  'basics',
  'community',
  'location',
  'education_career',
  'family',
  'lifestyle',
  'photos',
  'preferences',
  'identity',
  'review',
] as const

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

export function isOnboardingStep(value: string): value is OnboardingStep {
  return (ONBOARDING_STEPS as readonly string[]).includes(value)
}

/** Index of a step in the order, `ONBOARDING_STEPS.length` for `done`, -1 when unknown. */
export function stepIndex(step: string): number {
  if (step === 'done') return ONBOARDING_STEPS.length
  return (ONBOARDING_STEPS as readonly string[]).indexOf(step)
}

/** `/onboarding/<slug>` for a step key. */
export function onboardingPath(step: string): string {
  return isOnboardingStep(step) ? `/onboarding/${toSlug(step)}` : '/onboarding/account-for'
}

/** A path matches a prefix when it equals it or continues with `/`. */
export function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

function normalize(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1)
  return pathname
}

/** Where a user with this gate starts. */
export function gateHome(me: Me): string {
  switch (me.gate) {
    case 'banned':
    case 'suspended':
      return '/account/blocked'
    case 'deletion_scheduled':
      return '/account/deletion'
    case 'consent_required':
      return '/account/consent'
    case 'onboarding':
      return onboardingPath(me.profile.onboarding_step)
    case 'changes_requested':
      return '/account/changes'
    case 'pending_review':
      return '/account/review'
    default:
      return '/home'
  }
}

/** Own-profile, settings and notification routes open while a profile is in review. */
function allowedInReview(pathname: string): boolean {
  if (matchesPrefix(pathname, '/me')) return true
  if (matchesPrefix(pathname, '/settings')) return !matchesPrefix(pathname, '/settings/blocked')
  return matchesPrefix(pathname, '/notifications')
}

function allowedInOnboarding(me: Me, pathname: string): boolean {
  if (pathname === '/onboarding') return true
  if (matchesPrefix(pathname, '/settings/help')) return true
  const match = /^\/onboarding\/([^/]+)$/.exec(pathname)
  if (!match?.[1] || match[1] === 'done') return false
  const step = match[1].replaceAll('-', '_')
  const index = stepIndex(step)
  const current = stepIndex(me.profile.onboarding_step)
  return index >= 0 && index <= Math.max(current, 0)
}

/** Whether the path may be shown for this Me. */
export function allowedForGate(me: Me, rawPathname: string): boolean {
  const pathname = normalize(rawPathname)

  // The admin layout checks the role itself (17 section 16).
  if (
    matchesPrefix(pathname, '/admin') &&
    me.gate !== 'banned' &&
    me.gate !== 'suspended' &&
    me.gate !== 'deletion_scheduled'
  ) {
    return true
  }

  switch (me.gate) {
    case 'banned':
    case 'suspended':
      return pathname === '/account/blocked' || matchesPrefix(pathname, '/settings/help')
    case 'deletion_scheduled':
      return pathname === '/account/deletion' || matchesPrefix(pathname, '/settings/help')
    case 'consent_required':
      return pathname === '/account/consent'
    case 'onboarding':
      return allowedInOnboarding(me, pathname)
    case 'changes_requested':
      return pathname === '/account/changes' || allowedInReview(pathname)
    case 'pending_review':
      return pathname === '/account/review' || allowedInReview(pathname)
    case 'ok':
      if (pathname === '/onboarding/done') return true
      return !matchesPrefix(pathname, '/onboarding') && !matchesPrefix(pathname, '/account')
    default:
      return false
  }
}

/** null when the path is allowed, otherwise the path to go to. */
export function resolveRedirect(me: Me, pathname: string): string | null {
  return allowedForGate(me, pathname) ? null : gateHome(me)
}

// ---------------------------------------------------------------------------
// Inside the gate `ok`: the status panel (17 section 4.3, 16 section 1.4)
// ---------------------------------------------------------------------------

/** Access levels of 15 section 3 that a screen can need. */
export type AccessLevel = 'open' | 'connected' | 'engage' | 'browse'

/** Screen IDs of 16 whose access level can be refused by the own profile status. */
export const SCREEN_LEVELS = {
  'APP-HOME': 'browse',
  'APP-MATCHES': 'browse',
  'APP-SEARCH': 'browse',
  'APP-SHORTLIST': 'browse',
  'APP-VISITORS': 'browse',
  'APP-PROFILE': 'browse',
  'APP-PHOTOS': 'browse',
  'APP-INTERESTS': 'engage',
  'APP-PHOTO-REQUESTS': 'engage',
  'APP-CHATS': 'connected',
  'APP-CHAT': 'connected',
  'APP-CONNECTION': 'connected',
  'APP-NOTIFS': 'open',
  'SET-BLOCKED': 'connected',
} as const satisfies Record<string, AccessLevel>

export type LeveledScreen = keyof typeof SCREEN_LEVELS

export function requiredLevel(screen: LeveledScreen): AccessLevel {
  return SCREEN_LEVELS[screen]
}

/**
 * Which status panel replaces a screen that needs `level`, for a profile with `status`, or
 * null when the screen can be shown. `paused` refuses `browse`; `closed` refuses `browse`
 * and `engage`.
 */
export function statusPanelFor(
  status: ProfileStatus,
  level: AccessLevel,
): 'paused' | 'closed' | null {
  if (status === 'paused' && level === 'browse') return 'paused'
  if (status === 'closed' && (level === 'browse' || level === 'engage')) return 'closed'
  return null
}

/** Whether the primary navigation is shown (17 section 4.2: only under the gate `ok`). */
export function showsPrimaryNavigation(me: Me): boolean {
  return me.gate === 'ok'
}
