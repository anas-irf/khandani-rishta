import type { RangeValue } from '~/components/common/fields'
import { type Issue, sectionSchema, trimmed } from '~/features/profile-sections/schemas'
import type { Gender, Importance, Preferences } from '~/lib/api-types'

/**
 * The partner preferences form (07 section 11, ME-PREFS): values, the client rules of 07
 * sections 11.4 and 16.8, and the "no preference" test of each row (11.3 rule 1). Messages are
 * keys of the `preferences` namespace (`preferences:errors.<field>.<code>`).
 */

export const PREFERENCES_NS = 'preferences'

export type PreferencesValues = Omit<
  Preferences,
  | 'age_min'
  | 'age_max'
  | 'height_min_cm'
  | 'height_max_cm'
  | 'education_min_rank'
  | 'income_min_rank'
  | 'region_ids'
> & {
  age: RangeValue
  height: RangeValue
  /** Region ids as text (the multi-select's codes). */
  region_ids: string[]
  /** The chosen rank as text (the select's value), or null for "Any". */
  education_min_rank: string | null
  income_min_rank: string | null
}

/** The matching dimensions of 07 section 11.2, each bound to one `_importance` column. */
export const DIMENSIONS = [
  { key: 'age', importance: 'age_importance', tier: 1 },
  { key: 'marital_status', importance: 'marital_status_importance', tier: 1 },
  { key: 'religion', importance: 'religion_importance', tier: 1 },
  { key: 'sect', importance: 'sect_importance', tier: 1 },
  { key: 'location', importance: 'location_importance', tier: 1 },
  { key: 'education', importance: 'education_importance', tier: 1 },
  { key: 'height', importance: 'height_importance', tier: 2 },
  { key: 'children', importance: 'children_importance', tier: 2 },
  { key: 'caste', importance: 'caste_importance', tier: 2 },
  { key: 'mother_tongue', importance: 'mother_tongue_importance', tier: 2 },
  { key: 'profession', importance: 'profession_importance', tier: 2 },
  { key: 'income', importance: 'income_importance', tier: 2 },
  { key: 'religiosity', importance: 'religiosity_importance', tier: 2 },
  { key: 'appearance', importance: 'appearance_importance', tier: 2 },
  { key: 'family', importance: 'family_importance', tier: 2 },
  { key: 'living_arrangement', importance: 'living_arrangement_importance', tier: 2 },
  { key: 'work_after_marriage', importance: 'work_after_marriage_importance', tier: 2 },
  { key: 'smoking', importance: 'smoking_importance', tier: 2 },
] as const

export type Dimension = (typeof DIMENSIONS)[number]['key']
export type ImportanceKey = (typeof DIMENSIONS)[number]['importance']

const FULL_AGE = { min: 18, max: 80 }

/**
 * Whether a row states a preference. A row without one has its importance control disabled
 * (07 section 11.3 rule 1): an empty selection, "Any", `null` bounds or the full age range.
 */
export function hasPreference(
  dimension: Dimension,
  values: PreferencesValues,
  candidateGender: Gender | null,
): boolean {
  switch (dimension) {
    case 'age':
      return values.age.min !== FULL_AGE.min || values.age.max !== FULL_AGE.max
    case 'marital_status':
      return values.marital_statuses.length > 0
    case 'religion':
      return values.religion_codes.length > 0
    case 'sect':
      return values.sect_codes.length > 0
    case 'location':
      return (
        values.country_codes.length > 0 ||
        values.region_ids.length > 0 ||
        values.city_ids.length > 0
      )
    case 'education':
      return values.education_min_rank != null
    case 'height':
      return values.height.min != null || values.height.max != null
    case 'children':
      return values.children_acceptance !== 'any'
    case 'caste':
      return values.caste_codes.length > 0
    case 'mother_tongue':
      return values.mother_tongue_codes.length > 0
    case 'profession':
      return values.employment_types.length > 0 || values.profession_codes.length > 0
    case 'income':
      return values.income_min_rank != null
    case 'religiosity':
      return values.religiosity_levels.length > 0
    case 'appearance':
      return candidateGender === 'female'
        ? values.beard_types.length > 0
        : values.hijab_types.length > 0
    case 'family':
      return values.family_values.length > 0 || values.family_types.length > 0
    case 'living_arrangement':
      return values.living_arrangements.length > 0
    case 'work_after_marriage':
      return values.work_after_marriage_options.length > 0
    case 'smoking':
      return values.smoking_options.length > 0
    default:
      return false
  }
}

/** Rows with a preference whose importance is "Must have" (07 section 11.3 rules 3 and 4). */
export function mustHaveCount(values: PreferencesValues, candidateGender: Gender | null): number {
  return DIMENSIONS.filter(
    (dimension) =>
      values[dimension.importance] === ('must' satisfies Importance) &&
      hasPreference(dimension.key, values, candidateGender),
  ).length
}

const key = (path: string) => `${PREFERENCES_NS}:errors.${path}`

export function validatePreferences(values: PreferencesValues): Issue[] {
  const list: Issue[] = []
  const add = (path: string, message: string) => {
    if (!list.some((issue) => issue.path === path)) list.push({ path, message: key(message) })
  }
  const inAgeRange = (age: number | null) => age != null && age >= 18 && age <= 80
  if (!inAgeRange(values.age.min) || !inAgeRange(values.age.max)) add('age', 'age_min.out_of_range')
  else if ((values.age.min ?? 0) > (values.age.max ?? 0)) add('age', 'age_min.invalid')
  if (
    values.height.min != null &&
    values.height.max != null &&
    values.height.min > values.height.max
  ) {
    add('height', 'height_min_cm.invalid')
  }
  if (values.caste_codes.length > 30) add('caste_codes', 'caste_codes.too_long')
  for (const field of ['country_codes', 'region_ids', 'city_ids', 'profession_codes'] as const) {
    if (values[field].length > 20) add(field, `${field}.too_long`)
  }
  const notes = trimmed(values.notes)
  if (notes != null && notes.length < 30) add('notes', 'notes.too_short')
  else if (notes != null && notes.length > 1000) add('notes', 'notes.too_long')
  return list
}

export const preferencesSchema = sectionSchema<PreferencesValues>(validatePreferences)

/** API field keys that belong to a combined form field. */
export const PREFERENCE_ALIASES: Record<string, string> = {
  age_min: 'age',
  age_max: 'age',
  height_min_cm: 'height',
  height_max_cm: 'height',
}

export function preferencesToValues(preferences: Preferences): PreferencesValues {
  const { age_min, age_max, height_min_cm, height_max_cm, ...rest } = preferences
  return {
    ...rest,
    region_ids: preferences.region_ids.map(String),
    age: { min: age_min, max: age_max },
    height: { min: height_min_cm, max: height_max_cm },
    education_min_rank:
      preferences.education_min_rank == null ? null : String(preferences.education_min_rank),
    income_min_rank:
      preferences.income_min_rank == null ? null : String(preferences.income_min_rank),
  }
}

/**
 * The full `Preferences` to send. The appearance array that does not apply to the candidate is
 * sent empty (07 section 11.2), `married` is kept only for a female candidate (11.4 rule 4), and
 * sects are kept only for the selected religions.
 */
export function preferencesToBody(
  values: PreferencesValues,
  options: { candidateGender: Gender | null; sectsOf: (religionCode: string) => string[] },
): Preferences {
  const { age, height, ...rest } = values
  const female = options.candidateGender === 'female'
  const allowedSects = new Set(values.religion_codes.flatMap(options.sectsOf))
  return {
    ...rest,
    region_ids: values.region_ids.map(Number),
    age_min: age.min ?? 18,
    age_max: age.max ?? 80,
    height_min_cm: height.min,
    height_max_cm: height.max,
    education_min_rank:
      values.education_min_rank == null ? null : Number(values.education_min_rank),
    income_min_rank: values.income_min_rank == null ? null : Number(values.income_min_rank),
    marital_statuses: female
      ? values.marital_statuses
      : values.marital_statuses.filter((status) => status !== 'married'),
    sect_codes: values.sect_codes.filter((code) => allowedSects.has(code)),
    hijab_types: female ? [] : values.hijab_types,
    beard_types: female ? values.beard_types : [],
    notes: trimmed(values.notes),
  }
}
