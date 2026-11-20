import type { Badge, OwnProfile, Preferences } from '~/lib/api-types'
import { onboardingPath } from '~/lib/gate'

/**
 * Pure helpers of `ME-PROFILE` (08 section 1): the completeness hints of 08 section 6.2, the
 * badges, the must-have count and the "Edit" or "Add" choice of the section cards.
 */

export type CompletenessHint = { key: string; to: string }

/** Where each `missing` item leads (08 section 6.2). Unknown keys are left out. */
export function hintTarget(
  key: string,
  profile: Pick<OwnProfile, 'onboarding_step'>,
): string | null {
  switch (key) {
    case 'core':
      return onboardingPath(profile.onboarding_step)
    case 'photo':
    case 'more_photos':
      return '/me/photos'
    case 'about_me':
    case 'religious_practice':
    case 'plans':
    case 'hobbies':
      return '/me/edit/lifestyle'
    case 'family':
      return '/me/edit/family'
    case 'education_details':
    case 'career_details':
    case 'income':
      return '/me/edit/education-career'
    case 'relocation':
      return '/me/edit/location'
    case 'partner_preferences':
      return '/me/preferences'
    case 'identity':
      return '/me/verification'
    case 'id_verified':
      return '/me/verification/identity'
    case 'photo_verified':
      return '/me/verification/selfie'
    default:
      return null
  }
}

/** The first three `missing` entries as hint rows (08 section 1.1 block 4). */
export function completenessHints(
  profile: Pick<OwnProfile, 'missing' | 'onboarding_step'>,
): CompletenessHint[] {
  const hints: CompletenessHint[] = []
  for (const key of profile.missing) {
    const to = hintTarget(key, profile)
    if (to) hints.push({ key, to })
    if (hints.length === 3) break
  }
  return hints
}

/** Badges from `OwnProfile.verification`, in the order of 12 section 1.2. */
export function ownBadges(verification: OwnProfile['verification']): Badge[] {
  const badges: Badge[] = []
  if (verification.id_verified) badges.push('id_verified')
  if (verification.photo_verified) badges.push('photo_verified')
  if (verification.phone_verified) badges.push('phone_verified')
  return badges
}

/** How many preferences are must-haves (the "Looking for" card). */
export function mustHaveCount(preferences: Preferences): number {
  return Object.entries(preferences).filter(
    ([key, value]) => key.endsWith('_importance') && value === 'must',
  ).length
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (Array.isArray(value) && value.length === 0)
}

/** Whether nothing of a section was added yet ("Add" instead of "Edit"). */
export function sectionIsEmpty(section: object): boolean {
  return Object.values(section).every(isBlank)
}

/** The first 120 characters of a text, with an ellipsis when cut (08 section 1.3). */
export function excerpt(text: string | null | undefined, length = 120): string | null {
  if (!text) return null
  const trimmed = text.trim()
  return trimmed.length > length ? `${trimmed.slice(0, length).trimEnd()}...` : trimmed
}
