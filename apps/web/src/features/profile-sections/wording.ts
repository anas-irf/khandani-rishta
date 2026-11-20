import type { Gender, ManagedBy } from '~/lib/api-types'

/**
 * The wording pattern of 07 section 3.2. Labels are written in the `self` form; strings that
 * mention the candidate have variants chosen with i18next's `context`:
 * `t('lifestyle.smoking_label', { context: subject })` reads `smoking_label` for `self` and
 * `smoking_label_male`, `_female` or `_unknown` otherwise.
 */
export type Subject = 'self' | 'male' | 'female' | 'unknown'

export function subjectOf(
  managedBy: ManagedBy | null | undefined,
  gender: Gender | null | undefined,
) {
  if (managedBy == null || managedBy === 'self') return 'self' as const
  return gender ?? ('unknown' as const)
}

/** The i18next `context` for a subject: none for `self`, so the base key is used. */
export function wordingContext(subject: Subject): string | undefined {
  return subject === 'self' ? undefined : subject
}
