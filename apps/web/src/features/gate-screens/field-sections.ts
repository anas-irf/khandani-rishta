import { toSlug } from '~/lib/utils'

/**
 * Which screen fixes a field named by `validation_failed` when a profile is sent for review again
 * (07 section 14.3). A field matches a row when it equals a listed name or continues it with
 * `.` or `[` (a nested key or a list item).
 */
const FIELD_STEPS: readonly (readonly [step: string, fields: readonly string[]])[] = [
  ['account_for', ['managed_by', 'manager_name', 'consents']],
  [
    'basics',
    [
      'first_name',
      'last_name',
      'gender',
      'date_of_birth',
      'marital_status',
      'current_wives_count',
      'children_status',
      'children_count',
      'height_cm',
    ],
  ],
  [
    'community',
    [
      'religion_code',
      'sect_code',
      'caste_code',
      'caste_other',
      'sub_caste_code',
      'sub_caste_other',
      'mother_tongue_code',
      'language_codes',
    ],
  ],
  [
    'location',
    [
      'country_code',
      'region_id',
      'city_id',
      'city_other',
      'area',
      'nationality_code',
      'residency_status',
      'origin_city_id',
      'origin_other',
      'relocation',
    ],
  ],
  [
    'education_career',
    [
      'education_level_code',
      'education_field_code',
      'degree_title',
      'institute_name',
      'employment_type',
      'profession_code',
      'job_title',
      'employer_name',
      'income_band_code',
    ],
  ],
  ['photos', ['photos']],
  ['identity', ['number', 'document_type']],
]

function matches(field: string, name: string): boolean {
  return field === name || field.startsWith(`${name}.`) || field.startsWith(`${name}[`)
}

/** The onboarding step that owns an API field, or null when it is not one of the table's. */
export function stepForField(field: string): string | null {
  for (const [step, names] of FIELD_STEPS) {
    if (names.some((name) => matches(field, name))) return step
  }
  return null
}

/** The own-profile screen that fixes a step: `ME-EDIT`, `ME-PHOTOS` or `ME-VERIFY-ID`. */
export type FixTarget =
  | { to: '/me/edit/$section'; params: { section: string } }
  | { to: '/me/photos' }
  | { to: '/me/verification/identity' }

export function fixTargetForStep(step: string): FixTarget | null {
  if (step === 'photos') return { to: '/me/photos' }
  if (step === 'identity') return { to: '/me/verification/identity' }
  if (
    [
      'account_for',
      'basics',
      'community',
      'location',
      'education_career',
      'family',
      'lifestyle',
    ].includes(step)
  ) {
    return { to: '/me/edit/$section', params: { section: toSlug(step) } }
  }
  return null
}
