import { HttpResponse, http } from 'msw'
import type { ApiFieldError, Importance, OwnProfile, Preferences } from '~/lib/api-types'
import { ageFromDateOfBirth } from '~/lib/format'
import { db } from '../db'
import { cities, regionsByCountry } from '../fixtures/geography'
import { referenceBootstrap } from '../fixtures/reference'
import { apiUrl, readJson, validationError } from '../http'
import { gateErrorFor } from './account'
import { checkText, fieldError } from './profile'

/**
 * 15 section 7: partner preferences. `GET` answers the stored row or, while there is none, the
 * defaults of 07 section 12 computed from the profile; `PUT` validates (07 section 11.4) and
 * stores.
 */

const NEVER_MARRIED_ONLY: Preferences['marital_statuses'] = ['never_married']
const PREVIOUSLY_MARRIED: Preferences['marital_statuses'] = [
  'never_married',
  'divorced',
  'widowed',
  'nikah_ended_before_rukhsati',
]

/** The defaults of 07 section 12 for a profile without a `partner_preferences` row. */
export function preferenceDefaults(profile: OwnProfile, now: Date = new Date()): Preferences {
  const { gender, date_of_birth, marital_status } = profile.basics
  const age = date_of_birth ? ageFromDateOfBirth(date_of_birth, now) : Number.NaN
  const known = Number.isFinite(age) && gender != null
  const male = gender === 'male'
  return {
    age_min: known ? Math.max(18, male ? age - 8 : age - 1) : 18,
    age_max: known ? Math.min(80, male ? age + 1 : age + 8) : 80,
    age_importance: 'high',
    height_min_cm: null,
    height_max_cm: null,
    height_importance: 'low',
    marital_statuses:
      marital_status == null || marital_status === 'never_married'
        ? [...NEVER_MARRIED_ONLY]
        : [...PREVIOUSLY_MARRIED],
    marital_status_importance: 'high',
    children_acceptance: 'any',
    children_importance: 'medium',
    religion_codes: profile.community.religion_code ? [profile.community.religion_code] : [],
    religion_importance: 'must',
    sect_codes: [],
    sect_importance: 'medium',
    caste_codes: [],
    caste_importance: 'low',
    mother_tongue_codes: [],
    mother_tongue_importance: 'low',
    country_codes: profile.location.country_code ? [profile.location.country_code] : [],
    region_ids: [],
    city_ids: [],
    location_importance: 'medium',
    education_min_rank: null,
    education_importance: 'medium',
    employment_types: [],
    profession_codes: [],
    profession_importance: 'low',
    income_min_rank: null,
    income_importance: 'low',
    religiosity_levels: [],
    religiosity_importance: 'medium',
    hijab_types: [],
    beard_types: [],
    appearance_importance: 'low',
    family_values: [],
    family_types: [],
    family_importance: 'low',
    living_arrangements: [],
    living_arrangement_importance: 'low',
    work_after_marriage_options: [],
    work_after_marriage_importance: 'low',
    smoking_options: [],
    smoking_importance: 'low',
    notes: null,
  }
}

/** The stored preferences, or the defaults while none are stored. */
export function currentPreferences(): Preferences {
  return db.preferences ?? preferenceDefaults(db.ownProfile)
}

const IMPORTANCE: Importance[] = ['must', 'high', 'medium', 'low']
const IMPORTANCE_KEYS = [
  'age_importance',
  'height_importance',
  'marital_status_importance',
  'children_importance',
  'religion_importance',
  'sect_importance',
  'caste_importance',
  'mother_tongue_importance',
  'location_importance',
  'education_importance',
  'profession_importance',
  'income_importance',
  'religiosity_importance',
  'appearance_importance',
  'family_importance',
  'living_arrangement_importance',
  'work_after_marriage_importance',
  'smoking_importance',
] as const

const ref = referenceBootstrap
const optionCodes = (list: string) => (ref.options[list] ?? []).map((option) => option.code)

/** Validates a `PUT /v1/me/preferences` body (07 section 11.4). */
export function validatePreferences(
  body: Partial<Preferences>,
  candidateGender: 'male' | 'female' | null | undefined,
): { errors: ApiFieldError[]; value: Preferences } {
  const errors: ApiFieldError[] = []
  const value = { ...preferenceDefaults(db.ownProfile), ...body } as Preferences

  const ages = 'Ages must be between 18 and 80.'
  const ageOk = (age: unknown) =>
    typeof age === 'number' && Number.isInteger(age) && age >= 18 && age <= 80
  if (!ageOk(value.age_min)) errors.push(fieldError('age_min', 'out_of_range', ages))
  if (!ageOk(value.age_max)) errors.push(fieldError('age_max', 'out_of_range', ages))
  if (ageOk(value.age_min) && ageOk(value.age_max) && value.age_min > value.age_max) {
    errors.push(
      fieldError('age_min', 'invalid', 'The minimum age cannot be more than the maximum age.'),
    )
  }

  const heightOk = (height: number | null | undefined) =>
    height == null || (Number.isInteger(height) && height >= 122 && height <= 213)
  if (!heightOk(value.height_min_cm)) errors.push(fieldError('height_min_cm', 'out_of_range'))
  if (!heightOk(value.height_max_cm)) errors.push(fieldError('height_max_cm', 'out_of_range'))
  if (
    value.height_min_cm != null &&
    value.height_max_cm != null &&
    value.height_min_cm > value.height_max_cm
  ) {
    errors.push(
      fieldError(
        'height_min_cm',
        'invalid',
        'The minimum height cannot be more than the maximum height.',
      ),
    )
  }

  const codes = (field: keyof Preferences, allowed: (string | number)[]) => {
    const list = (value[field] ?? []) as (string | number)[]
    if (!Array.isArray(list) || list.some((item) => !allowed.includes(item))) {
      errors.push(fieldError(field, 'unknown_code'))
    }
  }
  codes('marital_statuses', optionCodes('marital_status'))
  if (value.marital_statuses.includes('married') && candidateGender !== 'female') {
    errors.push(fieldError('marital_statuses', 'not_allowed'))
  }
  if (!optionCodes('children_acceptance').includes(value.children_acceptance)) {
    errors.push(fieldError('children_acceptance', 'unknown_code'))
  }
  codes(
    'religion_codes',
    ref.religions.map((religion) => religion.code),
  )
  codes(
    'sect_codes',
    ref.religions.flatMap((religion) => religion.sects.map((sect) => sect.code)),
  )
  codes(
    'caste_codes',
    ref.castes.map((caste) => caste.code),
  )
  codes(
    'mother_tongue_codes',
    ref.languages.map((language) => language.code),
  )
  codes(
    'country_codes',
    ref.countries.map((country) => country.code),
  )
  codes('employment_types', optionCodes('employment_type'))
  codes(
    'profession_codes',
    ref.profession_categories.map((row) => row.code),
  )
  codes('religiosity_levels', optionCodes('religiosity'))
  codes('hijab_types', optionCodes('hijab'))
  codes('beard_types', optionCodes('beard'))
  codes('family_values', optionCodes('family_values'))
  codes('family_types', optionCodes('family_type'))
  codes('living_arrangements', optionCodes('living_arrangement'))
  codes('work_after_marriage_options', optionCodes('work_after_marriage'))
  codes('smoking_options', optionCodes('smoking'))
  const ranks = ref.education_levels.map((level) => level.rank)
  if (value.education_min_rank != null && !ranks.includes(value.education_min_rank)) {
    errors.push(fieldError('education_min_rank', 'unknown_code'))
  }
  if (
    value.income_min_rank != null &&
    !ref.income_bands.some((band) => band.rank === value.income_min_rank)
  ) {
    errors.push(fieldError('income_min_rank', 'unknown_code'))
  }

  const limits: [keyof Preferences, number, string][] = [
    ['caste_codes', 30, 'Choose up to 30 castes.'],
    ['city_ids', 20, 'Choose up to 20.'],
    ['region_ids', 20, 'Choose up to 20.'],
    ['country_codes', 20, 'Choose up to 20.'],
    ['profession_codes', 20, 'Choose up to 20.'],
  ]
  for (const [field, max, message] of limits) {
    if (((value[field] as unknown[]) ?? []).length > max) {
      errors.push(fieldError(field, 'too_long', message))
    }
  }

  const place = 'This place is not in one of the selected countries.'
  const regionCountry = new Map<number, string>()
  for (const [country, regions] of Object.entries(regionsByCountry)) {
    for (const region of regions) regionCountry.set(region.id, country)
  }
  for (const regionId of value.region_ids) {
    const country = regionCountry.get(regionId)
    if (!country) errors.push(fieldError('region_ids', 'unknown_code'))
    else if (value.country_codes.length > 0 && !value.country_codes.includes(country)) {
      errors.push(fieldError('region_ids', 'mismatch', place))
      break
    }
  }
  for (const cityId of value.city_ids) {
    const city = cities.find((entry) => entry.id === cityId)
    if (!city) errors.push(fieldError('city_ids', 'unknown_code'))
    else if (value.country_codes.length > 0 && !value.country_codes.includes(city.country_code)) {
      errors.push(fieldError('city_ids', 'mismatch', place))
      break
    }
  }

  for (const key of IMPORTANCE_KEYS) {
    if (!IMPORTANCE.includes(value[key])) errors.push(fieldError(key, 'unknown_code'))
  }

  const notes = typeof value.notes === 'string' ? value.notes.trim() || null : null
  checkText(errors, 'notes', notes, {
    min: 30,
    max: 1000,
    lengthMessage:
      notes && notes.length < 30
        ? 'Write at least 30 characters, or leave it empty.'
        : 'Keep it under 1,000 characters.',
  })

  return {
    errors,
    value: {
      ...value,
      // 07 section 11.4 rule 5.
      hijab_types: candidateGender === 'female' ? [] : value.hijab_types,
      beard_types: candidateGender === 'male' ? [] : value.beard_types,
      notes,
    },
  }
}

export const handlers = [
  http.get(apiUrl('/v1/me/preferences'), () => {
    const blocked = gateErrorFor('open')
    if (blocked) return blocked
    return HttpResponse.json(currentPreferences())
  }),

  http.put(apiUrl('/v1/me/preferences'), async ({ request }) => {
    const blocked = gateErrorFor('open')
    if (blocked) return blocked
    const body = await readJson<Partial<Preferences>>(request)
    const { errors, value } = validatePreferences(body, db.ownProfile.basics.gender)
    if (errors.length > 0) return validationError(errors)
    const previousNotes = db.preferences?.notes ?? null
    db.preferences = value
    db.ownProfile.text_status = {
      ...db.ownProfile.text_status,
      partner_notes:
        value.notes == null
          ? 'approved'
          : value.notes === previousNotes
            ? db.ownProfile.text_status.partner_notes
            : 'pending',
    }
    return HttpResponse.json(value)
  }),
]
