import { z } from 'zod'
import {
  type CityValue,
  cityValueFromSection,
  cityValueToSection,
} from '~/components/common/fields'
import type {
  AccountForBody,
  BasicsSection,
  CommunitySection,
  ConsentDocument,
  EducationCareerSection,
  FamilySection,
  Filled,
  Gender,
  LifestyleSection,
  LocationSection,
  ManagedBy,
  OwnProfile,
} from '~/lib/api-types'
import { ageFromDateOfBirth, MAX_HEIGHT_CM, MIN_HEIGHT_CM } from '~/lib/format'
import type { Subject } from './wording'

/**
 * Client-side rules of the profile sections (07 sections 3 to 9 and the catalogue in 16), one
 * Zod schema per section. Every rule is a plain function of the form values so it can be tested
 * against the examples of 07; messages are i18n keys of the `profile_sections` namespace, the
 * same keys `serverFieldMessage` uses for API errors (`profile_sections:errors.<field>.<code>`).
 *
 * Each section also has `<section>FromProfile` (prefill, 07 section 2.4 step 2) and
 * `<section>ToBody` (the whole section for `PUT /v1/me/profile/sections/{section}`).
 */

export const SECTION_NS = 'profile_sections'

export type FormMode = 'onboarding' | 'edit'

export type Issue = { path: string; message: string }

/** The i18n key of a message in the namespace. */
export function errorKey(path: string): string {
  return `${SECTION_NS}:errors.${path}`
}

/** A Zod schema that runs `validate` over the whole value and reports each issue on its field. */
export function sectionSchema<V>(validate: (value: V) => Issue[]) {
  return z
    .custom<V>((value) => typeof value === 'object' && value !== null)
    .superRefine((value, ctx) => {
      for (const issue of validate(value)) {
        ctx.addIssue({ code: 'custom', path: [issue.path], message: issue.message })
      }
    })
}

/** Trims and collapses inner whitespace (the API stores names and short text this way). */
export function collapse(value: string | null | undefined): string | null {
  const text = value?.trim().replace(/\s+/g, ' ') ?? ''
  return text === '' ? null : text
}

/** Trims only, keeping line breaks (long text). */
export function trimmed(value: string | null | undefined): string | null {
  const text = value?.trim() ?? ''
  return text === '' ? null : text
}

function issues() {
  const list: Issue[] = []
  return {
    list,
    add(path: string, message: string) {
      if (!list.some((issue) => issue.path === path))
        list.push({ path, message: errorKey(message) })
    },
  }
}

/** A text of `min` to `max` characters; `min` 0 means optional. */
function lengthCode(
  text: string | null,
  min: number,
  max: number,
): 'too_short' | 'too_long' | null {
  if (text == null) return min > 0 ? 'too_short' : null
  if (text.length < min) return 'too_short'
  if (text.length > max) return 'too_long'
  return null
}

// ---------------------------------------------------------------------------
// 07 section 3: account_for
// ---------------------------------------------------------------------------

export type AccountForValues = {
  managed_by: ManagedBy | null
  manager_name: string | null
  /** Consent 1: terms, privacy policy and community guidelines. */
  consent_terms: boolean
  /** Consent 2: the age declaration. */
  consent_age: boolean
  /** Consent 3: the candidate knows and agrees. */
  consent_candidate: boolean
}

export type AccountForContext = {
  mode: FormMode
  /** `managed_by` as saved before this form opened. */
  savedManagedBy: ManagedBy | null
}

/** Consent 3 is shown for a profile not managed by the candidate (07 3.1, 08 2.1 rule 4). */
export function showsCandidateConsent(values: AccountForValues, context: AccountForContext) {
  if (values.managed_by == null || values.managed_by === 'self') return false
  return context.mode === 'onboarding' || context.savedManagedBy === 'self'
}

export function validateAccountFor(values: AccountForValues, context: AccountForContext) {
  const { list, add } = issues()
  if (!values.managed_by) add('managed_by', 'managed_by.required')
  if (values.managed_by && values.managed_by !== 'self') {
    const name = collapse(values.manager_name)
    if (name == null) add('manager_name', 'manager_name.required')
    else {
      const code = lengthCode(name, 2, 80)
      if (code) add('manager_name', `manager_name.${code}`)
    }
  }
  if (context.mode === 'onboarding') {
    if (!values.consent_terms) add('consent_terms', 'consents.required')
    if (!values.consent_age) add('consent_age', 'consent_age.required')
  }
  if (showsCandidateConsent(values, context) && !values.consent_candidate) {
    add('consent_candidate', 'consent_candidate.required')
  }
  return list
}

export function accountForSchema(context: () => AccountForContext) {
  return sectionSchema<AccountForValues>((values) => validateAccountFor(values, context()))
}

export function accountForFromProfile(
  profile: OwnProfile,
  options: { consentsRecorded: boolean },
): AccountForValues {
  const { managed_by, manager_name } = profile.account_for
  return {
    managed_by,
    manager_name,
    consent_terms: options.consentsRecorded,
    consent_age: options.consentsRecorded,
    consent_candidate: options.consentsRecorded && managed_by != null && managed_by !== 'self',
  }
}

export function accountForToBody(
  values: AccountForValues,
  context: AccountForContext,
): AccountForBody {
  const consents: ConsentDocument[] = []
  if (context.mode === 'onboarding') {
    if (values.consent_terms) consents.push('terms', 'privacy', 'community_guidelines')
    if (values.consent_age) consents.push('age_declaration')
  }
  if (showsCandidateConsent(values, context) && values.consent_candidate) {
    consents.push('candidate_consent')
  }
  const self = values.managed_by === 'self'
  return {
    managed_by: values.managed_by,
    manager_name: self ? null : collapse(values.manager_name),
    ...(consents.length > 0 ? { consents } : {}),
  }
}

// ---------------------------------------------------------------------------
// 07 section 4: basics
// ---------------------------------------------------------------------------

export type BasicsValues = Filled<BasicsSection>

export type BasicsContext = { subject: Subject; now?: Date }

const CHILDREN_WITH_COUNT = ['living_with_me', 'not_living_with_me']

/** Age 18 to 80 on today's date in Asia/Karachi (07 section 4.1). */
export function dateOfBirthCode(
  dateOfBirth: string | null,
  now: Date = new Date(),
): 'required' | 'invalid' | 'too_young' | 'out_of_range' | null {
  if (!dateOfBirth) return 'required'
  const age = ageFromDateOfBirth(dateOfBirth, now)
  if (Number.isNaN(age)) return 'invalid'
  if (age < 18) return 'too_young'
  if (age > 80) return 'out_of_range'
  return null
}

export function validateBasics(values: BasicsValues, context: BasicsContext) {
  const { list, add } = issues()
  for (const field of ['first_name', 'last_name'] as const) {
    const name = collapse(values[field])
    if (name == null) add(field, `${field}.required`)
    else {
      const code = lengthCode(name, 2, 40)
      if (code) add(field, `${field}.${code}`)
    }
  }
  if (!values.gender) add('gender', 'gender.required')

  const dobCode = dateOfBirthCode(values.date_of_birth, context.now)
  if (dobCode === 'too_young') {
    add(
      'date_of_birth',
      context.subject === 'self' ? 'date_of_birth.too_young' : 'date_of_birth.too_young_other',
    )
  } else if (dobCode) add('date_of_birth', `date_of_birth.${dobCode}`)

  if (!values.marital_status) add('marital_status', 'marital_status.required')
  else if (values.marital_status === 'married' && values.gender === 'female') {
    add('marital_status', 'marital_status.not_allowed')
  }
  if (values.marital_status === 'married') {
    if (values.current_wives_count == null)
      add('current_wives_count', 'current_wives_count.required')
    else if (values.current_wives_count < 1 || values.current_wives_count > 3) {
      add('current_wives_count', 'current_wives_count.out_of_range')
    }
  }
  if (values.marital_status && values.marital_status !== 'never_married') {
    if (!values.children_status) add('children_status', 'children_status.required')
    else if (CHILDREN_WITH_COUNT.includes(values.children_status)) {
      if (values.children_count == null) add('children_count', 'children_count.required')
      else if (values.children_count < 1 || values.children_count > 15) {
        add('children_count', 'children_count.out_of_range')
      }
    }
  }
  if (values.height_cm == null) add('height_cm', 'height_cm.required')
  else if (values.height_cm < MIN_HEIGHT_CM || values.height_cm > MAX_HEIGHT_CM) {
    add('height_cm', 'height_cm.out_of_range')
  }
  return list
}

export function basicsSchema(context: () => BasicsContext) {
  return sectionSchema<BasicsValues>((values) => validateBasics(values, context()))
}

export function basicsFromProfile(profile: OwnProfile): BasicsValues {
  const basics = profile.basics
  return {
    first_name: basics.first_name ?? null,
    last_name: basics.last_name ?? null,
    gender: basics.gender ?? null,
    date_of_birth: basics.date_of_birth ?? null,
    marital_status: basics.marital_status ?? null,
    children_status: basics.children_status ?? null,
    children_count: basics.children_count ?? null,
    current_wives_count: basics.current_wives_count ?? null,
    height_cm: basics.height_cm ?? null,
  }
}

/** Applies the dependent-field rules of 07 section 4.2 (rules 4 to 6) the way the API stores them. */
export function basicsToBody(values: BasicsValues): BasicsSection {
  const neverMarried = values.marital_status === 'never_married'
  const childrenStatus = neverMarried ? 'none' : values.children_status
  const withCount = childrenStatus != null && CHILDREN_WITH_COUNT.includes(childrenStatus)
  return {
    first_name: collapse(values.first_name),
    last_name: collapse(values.last_name),
    gender: values.gender,
    date_of_birth: values.date_of_birth,
    marital_status: values.marital_status,
    children_status: childrenStatus,
    children_count: withCount ? values.children_count : null,
    current_wives_count: values.marital_status === 'married' ? values.current_wives_count : null,
    height_cm: values.height_cm,
  }
}

// ---------------------------------------------------------------------------
// 07 section 5: community
// ---------------------------------------------------------------------------

/** "Prefer not to say" in the caste list and "Not specified" in the sub-caste list. */
export const NOT_SPECIFIED = '__none'

export type CommunityValues = Filled<CommunitySection> & {
  /** `other` after "Other (type your own)": the typed `caste_other` is used. */
  caste_mode: 'list' | 'other'
  sub_caste_mode: 'list' | 'other'
}

export type CommunityContext = {
  /** Number of sects of a religion. */
  sectCount: (religionCode: string | null) => number
  /** Whether a listed caste has sub-castes. */
  hasSubCastes: (casteCode: string | null) => boolean
}

/** Which sub-caste control is shown (07 section 5.2). */
export function subCasteControl(
  values: Pick<CommunityValues, 'caste_code' | 'caste_mode'>,
  context: Pick<CommunityContext, 'hasSubCastes'>,
): 'hidden' | 'select' | 'text' {
  if (values.caste_mode === 'other') return 'text'
  if (values.caste_code == null || values.caste_code === NOT_SPECIFIED) return 'hidden'
  return context.hasSubCastes(values.caste_code) ? 'select' : 'text'
}

export function validateCommunity(values: CommunityValues, context: CommunityContext) {
  const { list, add } = issues()
  if (!values.religion_code) add('religion_code', 'religion_code.required')
  else if (context.sectCount(values.religion_code) > 0 && !values.sect_code) {
    add('sect_code', 'sect_code.required')
  }
  if (values.caste_mode === 'other') {
    const code = lengthCode(collapse(values.caste_other), 2, 60)
    if (code) add('caste_other', `caste_other.${code}`)
  }
  const subControl = subCasteControl(values, context)
  const subText = collapse(values.sub_caste_other)
  if (subControl === 'select' && values.sub_caste_mode === 'other') {
    const code = lengthCode(subText, 2, 60)
    if (code) add('sub_caste_other', `sub_caste_other.${code}`)
  } else if (subControl === 'text' && subText != null) {
    const code = lengthCode(subText, 2, 60)
    if (code) add('sub_caste_other', `sub_caste_other.${code}`)
  }
  if (!values.mother_tongue_code) add('mother_tongue_code', 'mother_tongue_code.required')
  const languages = values.language_codes.filter((code) => code !== values.mother_tongue_code)
  if (languages.length > 6) add('language_codes', 'language_codes.too_long')
  return list
}

export function communitySchema(context: () => CommunityContext) {
  return sectionSchema<CommunityValues>((values) => validateCommunity(values, context()))
}

export function communityFromProfile(
  profile: OwnProfile,
  context: Pick<CommunityContext, 'hasSubCastes'>,
): CommunityValues {
  const community = profile.community
  const listedWithSubs = community.caste_code != null && context.hasSubCastes(community.caste_code)
  return {
    religion_code: community.religion_code ?? null,
    sect_code: community.sect_code ?? null,
    caste_code: community.caste_code ?? null,
    caste_other: community.caste_other ?? null,
    sub_caste_code: community.sub_caste_code ?? null,
    sub_caste_other: community.sub_caste_other ?? null,
    mother_tongue_code: community.mother_tongue_code ?? null,
    language_codes: [...(community.language_codes ?? [])],
    caste_mode: community.caste_other != null ? 'other' : 'list',
    sub_caste_mode: listedWithSubs && community.sub_caste_other != null ? 'other' : 'list',
  }
}

export function communityToBody(
  values: CommunityValues,
  context: CommunityContext,
): CommunitySection {
  const casteCode =
    values.caste_mode === 'list' && values.caste_code !== NOT_SPECIFIED ? values.caste_code : null
  const casteOther = values.caste_mode === 'other' ? collapse(values.caste_other) : null
  const subControl = subCasteControl(values, context)
  let subCode: string | null = null
  let subOther: string | null = null
  if (subControl === 'select') {
    if (values.sub_caste_mode === 'other') subOther = collapse(values.sub_caste_other)
    else if (values.sub_caste_code !== NOT_SPECIFIED) subCode = values.sub_caste_code
  } else if (subControl === 'text') {
    subOther = collapse(values.sub_caste_other)
  }
  return {
    religion_code: values.religion_code,
    sect_code: context.sectCount(values.religion_code) > 0 ? values.sect_code : null,
    caste_code: casteCode,
    caste_other: casteOther,
    sub_caste_code: casteCode != null || casteOther != null ? subCode : null,
    sub_caste_other: casteCode != null || casteOther != null ? subOther : null,
    mother_tongue_code: values.mother_tongue_code,
    language_codes: Array.from(new Set(values.language_codes)).filter(
      (code) => code !== values.mother_tongue_code,
    ),
  }
}

// ---------------------------------------------------------------------------
// 07 section 6: location
// ---------------------------------------------------------------------------

export type LocationValues = {
  /** Country, region, city or typed city (`CityPickerField`). */
  place: CityValue
  area: string | null
  nationality_code: string | null
  residency_status: Filled<LocationSection>['residency_status']
  /** The family's home town in Pakistan (`origin_city_id` or `origin_other`). */
  origin: CityValue
  relocation: Filled<LocationSection>['relocation']
}

export type LocationContext = {
  /** Whether the country has regions (the region is then required with a typed city). */
  countryHasRegions: (countryCode: string | null) => boolean
}

/** Residency is asked only when living outside the country of nationality (07 section 6.1). */
export function asksResidency(values: Pick<LocationValues, 'place' | 'nationality_code'>) {
  return (
    values.place.country_code != null &&
    values.nationality_code != null &&
    values.place.country_code !== values.nationality_code
  )
}

export function validateLocation(values: LocationValues, context: LocationContext) {
  const { list, add } = issues()
  const { place } = values
  if (!place.country_code) add('place', 'country_code.required')
  else if (place.city_id == null) {
    if (place.city_other == null) add('place', 'city_id.required')
    else {
      const code = lengthCode(collapse(place.city_other), 2, 60)
      if (code) add('place', `city_other.${code}`)
      else if (place.region_id == null && context.countryHasRegions(place.country_code)) {
        add('place', 'region_id.required')
      }
    }
  }
  const areaCode = lengthCode(collapse(values.area), 0, 80)
  if (areaCode) add('area', `area.${areaCode}`)
  if (asksResidency(values) && !values.residency_status) {
    add('residency_status', 'residency_status.required')
  }
  if (values.origin.city_id == null && values.origin.city_other != null) {
    const code = lengthCode(collapse(values.origin.city_other), 0, 60)
    if (code) add('origin', `origin_other.${code}`)
  }
  return list
}

export function locationSchema(context: () => LocationContext) {
  return sectionSchema<LocationValues>((values) => validateLocation(values, context()))
}

export function locationFromProfile(profile: OwnProfile): LocationValues {
  const location = profile.location
  return {
    place: cityValueFromSection(location, 'PK'),
    area: location.area ?? null,
    nationality_code: location.nationality_code ?? 'PK',
    residency_status: location.residency_status ?? null,
    origin: cityValueFromSection(
      {
        country_code: 'PK',
        city_id: location.origin_city_id ?? null,
        city_other: location.origin_other ?? null,
        city: location.origin_city ?? null,
      },
      'PK',
    ),
    relocation: location.relocation ?? null,
  }
}

export function locationToBody(values: LocationValues): LocationSection {
  const place = cityValueToSection(values.place)
  const origin = cityValueToSection(values.origin)
  return {
    ...place,
    nationality_code: values.nationality_code,
    area: collapse(values.area),
    residency_status: asksResidency(values)
      ? values.residency_status
      : values.place.country_code != null && values.nationality_code != null
        ? 'citizen'
        : values.residency_status,
    origin_city_id: origin.city_id,
    origin_other: collapse(origin.city_other),
    relocation: values.relocation,
  }
}

// ---------------------------------------------------------------------------
// 07 section 7: education_career
// ---------------------------------------------------------------------------

export type EducationCareerValues = Filled<EducationCareerSection>

/** Employment types without profession, job, employer and income (07 section 7.3 rule 2). */
export const NOT_WORKING = ['student', 'homemaker', 'not_working']

export function isWorking(employmentType: string | null | undefined): boolean {
  return !NOT_WORKING.includes(employmentType ?? '')
}

export function validateEducationCareer(values: EducationCareerValues) {
  const { list, add } = issues()
  if (!values.education_level_code) add('education_level_code', 'education_level_code.required')
  if (!values.employment_type) add('employment_type', 'employment_type.required')
  const limits: [keyof EducationCareerValues, number][] = [
    ['degree_title', 80],
    ['institute_name', 120],
  ]
  if (isWorking(values.employment_type)) limits.push(['job_title', 80], ['employer_name', 120])
  for (const [field, max] of limits) {
    if (lengthCode(collapse(values[field]), 0, max)) add(field, `${field}.too_long`)
  }
  return list
}

export function educationCareerSchema() {
  return sectionSchema<EducationCareerValues>(validateEducationCareer)
}

export function educationCareerFromProfile(profile: OwnProfile): EducationCareerValues {
  const education = profile.education_career
  return {
    education_level_code: education.education_level_code ?? null,
    education_field_code: education.education_field_code ?? null,
    degree_title: education.degree_title ?? null,
    institute_name: education.institute_name ?? null,
    employment_type: education.employment_type ?? null,
    profession_code: education.profession_code ?? null,
    job_title: education.job_title ?? null,
    employer_name: education.employer_name ?? null,
    income_band_code: education.income_band_code ?? null,
  }
}

export function educationCareerToBody(values: EducationCareerValues): EducationCareerSection {
  const working = isWorking(values.employment_type)
  return {
    education_level_code: values.education_level_code,
    education_field_code: values.education_field_code,
    degree_title: collapse(values.degree_title),
    institute_name: collapse(values.institute_name),
    employment_type: values.employment_type,
    profession_code: working ? values.profession_code : null,
    job_title: working ? collapse(values.job_title) : null,
    employer_name: working ? collapse(values.employer_name) : null,
    income_band_code: working ? values.income_band_code : null,
  }
}

// ---------------------------------------------------------------------------
// 07 section 8: family
// ---------------------------------------------------------------------------

export type FamilyValues = Omit<
  Filled<FamilySection>,
  'family_country_code' | 'family_city_id' | 'home_size_value'
> & {
  /** The switch "My family lives in a different city" (not stored). */
  family_elsewhere: boolean
  /** `family_country_code` and `family_city_id`. */
  family_place: CityValue
  /** Typed with up to 2 decimals, so kept as text in the form. */
  home_size_value: string | null
}

const SIZE_PATTERN = /^\d{1,5}(\.\d{1,2})?$/

export function validateFamily(values: FamilyValues) {
  const { list, add } = issues()
  for (const kind of ['brothers', 'sisters'] as const) {
    const total = values[`${kind}_count`]
    const married = values[`${kind}_married`]
    if (total != null && (total < 0 || total > 15))
      add(`${kind}_count`, `${kind}_count.out_of_range`)
    if (total != null && total > 0 && married != null && married > total) {
      add(`${kind}_married`, `${kind}_married.out_of_range`)
    }
  }
  for (const field of ['father_occupation', 'mother_occupation'] as const) {
    if (lengthCode(collapse(values[field]), 0, 80)) add(field, `${field}.too_long`)
  }
  const size = values.home_size_value?.trim() || null
  if (size != null && (!SIZE_PATTERN.test(size) || Number(size) <= 0)) {
    add('home_size_value', 'home_size_value.out_of_range')
  }
  if (size != null && !values.home_size_unit) add('home_size_unit', 'home_size_unit.required')
  if (size == null && values.home_size_unit) add('home_size_value', 'home_size_value.required')
  const about = trimmed(values.about_family)
  if (about != null) {
    const code = lengthCode(about, 30, 1000)
    if (code) add('about_family', `about_family.${code}`)
  }
  return list
}

export function familySchema() {
  return sectionSchema<FamilyValues>(validateFamily)
}

export function familyFromProfile(profile: OwnProfile): FamilyValues {
  const family = profile.family
  const elsewhere = family.family_country_code != null || family.family_city_id != null
  return {
    father_status: family.father_status ?? null,
    father_occupation: family.father_occupation ?? null,
    mother_status: family.mother_status ?? null,
    mother_occupation: family.mother_occupation ?? null,
    brothers_count: family.brothers_count ?? null,
    brothers_married: family.brothers_married ?? null,
    sisters_count: family.sisters_count ?? null,
    sisters_married: family.sisters_married ?? null,
    family_type: family.family_type ?? null,
    family_class: family.family_class ?? null,
    family_values: family.family_values ?? null,
    home_ownership: family.home_ownership ?? null,
    home_type: family.home_type ?? null,
    home_size_unit: family.home_size_unit ?? null,
    about_family: family.about_family ?? null,
    family_elsewhere: elsewhere,
    family_place: {
      country_code: family.family_country_code ?? 'PK',
      region_id: null,
      city_id: family.family_city_id ?? null,
      city_other: null,
      city: null,
    },
    home_size_value: family.home_size_value == null ? null : String(family.home_size_value),
  }
}

export function familyToBody(values: FamilyValues): FamilySection {
  const { family_elsewhere, family_place, ...rest } = values
  const size = values.home_size_value?.trim() || null
  const counted = (total: number | null, married: number | null) =>
    total == null || total === 0 ? null : married
  return {
    ...rest,
    father_occupation: collapse(values.father_occupation),
    mother_occupation: collapse(values.mother_occupation),
    brothers_married: counted(values.brothers_count, values.brothers_married),
    sisters_married: counted(values.sisters_count, values.sisters_married),
    family_country_code: family_elsewhere ? family_place.country_code : null,
    family_city_id: family_elsewhere ? family_place.city_id : null,
    home_size_value: size == null ? null : Number(size),
    home_size_unit: values.home_size_unit,
    about_family: trimmed(values.about_family),
  }
}

// ---------------------------------------------------------------------------
// 07 section 9: lifestyle
// ---------------------------------------------------------------------------

export type LifestyleValues = Filled<LifestyleSection>

export type LifestyleContext = { gender: Gender | null; religionCode: string | null }

/** Fields of the "Religious practice" group shown only for Islam (07 section 9.1). */
export const ISLAM_ONLY = ['prayer_frequency', 'hijab', 'beard', 'religious_education'] as const

export function lifestyleShows(field: keyof LifestyleValues, context: LifestyleContext): boolean {
  const islam = context.religionCode === 'islam'
  if (field === 'hijab') return islam && context.gender === 'female'
  if (field === 'beard') return islam && context.gender === 'male'
  if ((ISLAM_ONLY as readonly string[]).includes(field)) return islam
  return true
}

export function validateLifestyle(values: LifestyleValues) {
  const { list, add } = issues()
  if (
    values.weight_kg != null &&
    (!Number.isInteger(values.weight_kg) || values.weight_kg < 30 || values.weight_kg > 200)
  ) {
    add('weight_kg', 'weight_kg.out_of_range')
  }
  if (values.disability && values.disability !== 'none') {
    if (lengthCode(collapse(values.disability_details), 0, 300)) {
      add('disability_details', 'disability_details.too_long')
    }
  }
  if (values.hobby_codes.length > 10) add('hobby_codes', 'hobby_codes.too_long')
  const about = trimmed(values.about_me)
  if (about != null) {
    const code = lengthCode(about, 50, 1500)
    if (code) add('about_me', `about_me.${code}`)
  }
  return list
}

export function lifestyleSchema() {
  return sectionSchema<LifestyleValues>(validateLifestyle)
}

export function lifestyleFromProfile(profile: OwnProfile): LifestyleValues {
  const lifestyle = profile.lifestyle
  return {
    religiosity: lifestyle.religiosity ?? null,
    prayer_frequency: lifestyle.prayer_frequency ?? null,
    hijab: lifestyle.hijab ?? null,
    beard: lifestyle.beard ?? null,
    religious_education: lifestyle.religious_education ?? null,
    smoking: lifestyle.smoking ?? null,
    living_arrangement: lifestyle.living_arrangement ?? null,
    work_after_marriage: lifestyle.work_after_marriage ?? null,
    marriage_timeline: lifestyle.marriage_timeline ?? null,
    jahez_stance: lifestyle.jahez_stance ?? null,
    weight_kg: lifestyle.weight_kg ?? null,
    complexion: lifestyle.complexion ?? null,
    body_type: lifestyle.body_type ?? null,
    blood_group: lifestyle.blood_group ?? null,
    disability: lifestyle.disability ?? null,
    disability_details: lifestyle.disability_details ?? null,
    hobby_codes: [...(lifestyle.hobby_codes ?? [])],
    about_me: lifestyle.about_me ?? null,
  }
}

/** A field that is not shown is sent as `null` (07 section 9.1). */
export function lifestyleToBody(
  values: LifestyleValues,
  context: LifestyleContext,
): LifestyleSection {
  const shown = (field: keyof LifestyleValues) => lifestyleShows(field, context)
  const withDetails = values.disability != null && values.disability !== 'none'
  return {
    ...values,
    prayer_frequency: shown('prayer_frequency') ? values.prayer_frequency : null,
    hijab: shown('hijab') ? values.hijab : null,
    beard: shown('beard') ? values.beard : null,
    religious_education: shown('religious_education') ? values.religious_education : null,
    disability_details: withDetails ? collapse(values.disability_details) : null,
    hobby_codes: Array.from(new Set(values.hobby_codes)),
    about_me: trimmed(values.about_me),
  }
}
