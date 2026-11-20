import type { OnboardingStep } from '~/lib/gate'

/**
 * Which onboarding step (and `ME-EDIT` section) owns an API field key: the mapping of 07
 * section 14.3, used when `complete` or `resubmit` answer `validation_failed`. `preferences`
 * (the step requirement of 03 section 4.3) maps to its own step.
 */
const FIELD_STEPS: [OnboardingStep, string[]][] = [
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
  ['preferences', ['preferences']],
  ['identity', ['number', 'document_type']],
]

/** The step of a field key ("starts with or equals"), or null when it belongs to none. */
export function stepForField(field: string): OnboardingStep | null {
  for (const [step, prefixes] of FIELD_STEPS) {
    if (prefixes.some((prefix) => field.startsWith(prefix))) {
      return step
    }
  }
  return null
}
