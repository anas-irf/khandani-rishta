import { HttpResponse, http } from 'msw'
import type {
  AccountForBody,
  ApiFieldError,
  BasicsSection,
  CityRef,
  CommunitySection,
  ConsentDocument,
  EducationCareerSection,
  FamilySection,
  FieldErrorCode,
  LifestyleSection,
  LocationSection,
  LockedGroup,
  OwnPhoto,
  OwnProfile,
  PhotoView,
  ProfileDetail,
  TextStatus,
  Tier,
} from '~/lib/api-types'
import { ageFromDateOfBirth } from '~/lib/format'
import { ONBOARDING_STEPS, stepIndex } from '~/lib/gate'
import { db } from '../db'
import { makeProfileCard, makeProfileDetail } from '../factories'
import { cities, regionsByCountry } from '../fixtures/geography'
import { referenceBootstrap } from '../fixtures/reference'
import { apiError, apiUrl, readJson, validationError } from '../http'
import { currentMe, gateErrorFor } from './account'
import { currentPreferences } from './preferences'

/**
 * 15 section 7: the own profile, its sections and the onboarding steps, with the server-side
 * rules of 07 (sections 3 to 9 and 14) and 03 section 4.3.
 *
 * `PUT /v1/me/profile/sections/contacts` is not handled here: the resolver returns nothing for
 * it, so MSW falls through to the handler of the contacts feature (08 section 3).
 *
 * Set `db.extra.profileReview = 'manual'` to make `POST /v1/me/onboarding/complete` answer
 * with `pending_review` (07 section 14.2).
 */

// ---------------------------------------------------------------------------
// Text rules (13 section 3), shared with the preferences and identity handlers
// ---------------------------------------------------------------------------

/** Trims and collapses inner whitespace; an empty result is null. */
export function collapse(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim().replace(/\s+/g, ' ')
  return text === '' ? null : text
}

/** Trims only (line breaks stay in long text); an empty result is null. */
function trimmed(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text === '' ? null : text
}

const DEFAULT_MESSAGES: Record<FieldErrorCode, string> = {
  required: 'This field is required.',
  invalid: 'Please check this value.',
  too_short: 'This is too short.',
  too_long: 'This is too long.',
  out_of_range: 'This value is out of range.',
  unknown_code: 'This option is no longer available. Please choose another.',
  not_allowed: 'This option is not available for this profile.',
  too_young: 'The candidate must be at least 18 years old.',
  contains_contact_info:
    'Please remove phone numbers, email addresses, links and social media names. You can share contact details privately once you are connected.',
  inappropriate: 'This text contains words that are not allowed. Please rephrase.',
  mismatch: 'This does not match.',
  locked: 'This can no longer be changed. Contact support if it is wrong.',
}

/** One field error with the English message of 07 section 16 where the mock knows it. */
export function fieldError(field: string, code: FieldErrorCode, message?: string): ApiFieldError {
  return { field, code, message: message ?? DEFAULT_MESSAGES[code] }
}

const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M} .'-]*[\p{L}\p{M}.]$/u
const SHORT_TEXT_PATTERN = /^[\p{L}\p{M}\p{N} .,'&()/+-]+$/u
const BANNED_WORDS = ['hookup', 'escort']

function normalise(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/\u200b|\u200c|\u200d|\u2060|\ufeff/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** The contact patterns of 13 section 3.4 (without the number-word check `C0`). */
export function containsContactInfo(text: string, options: { allowDomains?: boolean } = {}) {
  const value = normalise(text)
    .replace(/\b(?:19|20)\d{2} ?(?:-|to|till|until) ?(?:19|20)\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}[/.-]\d{1,2}[/.-](?:19|20)?\d{2}\b/g, ' ')
  const patterns = [
    /(?:\d[ .\-_()*]{0,2}){8,}/,
    /[a-z0-9._%+-]+ ?@ ?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/,
    /[a-z0-9._%+-]+(?: ?\(at\) ?| ?\[at\] ?| at )(?:gmail|yahoo|hotmail|outlook|icloud|live|ymail|proton|protonmail)\b/,
    /\b(?:gmail|hotmail|yahoo|outlook|icloud|ymail)\b ?(?:\.|dot) ?com\b/,
    /(?:https?:\/\/|www\.)\S+/,
    options.allowDomains ? null : /\b[a-z0-9][a-z0-9-]+\.(?:com|net|org|pk|io|info|biz|app|link)\b/,
    /(?:^|[^a-z0-9._%+-])@[a-z0-9_.]{3,}/,
    /\b(?:insta|instagram|snap|snapchat|fb|facebook|tiktok|telegram|whatsapp|whats app|watsapp|wtsapp|skype|imo|botim)\b[^.\n]{0,20}?(?:@|\bid\b|:|\d)/,
  ]
  return patterns.some((pattern) => pattern?.test(value))
}

function isInappropriate(text: string): boolean {
  const value = normalise(text)
  return BANNED_WORDS.some((word) => value.includes(word))
}

/** Group A (names): length, the `N1` pattern and the extra name rules. */
export function checkName(
  errors: ApiFieldError[],
  field: string,
  value: string | null,
  max: number,
  messages: { length: string },
) {
  if (value == null) return
  if (value.length < 2) errors.push(fieldError(field, 'too_short', messages.length))
  else if (value.length > max) errors.push(fieldError(field, 'too_long', messages.length))
  else {
    const letters = value.match(/[\p{L}\p{M}]/gu) ?? []
    const repeated = new Set(value.toLowerCase().replace(/[^\p{L}]/gu, '')).size === 1
    if (!NAME_PATTERN.test(value) || letters.length < 2 || repeated || isInappropriate(value)) {
      errors.push(
        fieldError(
          field,
          'invalid',
          'Use letters only. Numbers and symbols are not allowed in a name.',
        ),
      )
    }
  }
}

/** Group B and C (free text): length, character pattern for short text, contacts, words. */
export function checkText(
  errors: ApiFieldError[],
  field: string,
  value: string | null,
  rules: {
    min?: number
    max: number
    short?: boolean
    allowDomains?: boolean
    lengthMessage?: string
    contactMessage?: string
  },
) {
  if (value == null) return
  if (rules.min != null && value.length < rules.min) {
    errors.push(fieldError(field, 'too_short', rules.lengthMessage))
    return
  }
  if (value.length > rules.max) {
    errors.push(fieldError(field, 'too_long', rules.lengthMessage))
    return
  }
  if (containsContactInfo(value, { allowDomains: rules.allowDomains })) {
    errors.push(fieldError(field, 'contains_contact_info', rules.contactMessage))
    return
  }
  if (isInappropriate(value)) {
    errors.push(fieldError(field, 'inappropriate'))
    return
  }
  if (rules.short && !SHORT_TEXT_PATTERN.test(value)) errors.push(fieldError(field, 'invalid'))
}

function hasOption(list: string, code: string): boolean {
  return (referenceBootstrap.options[list] ?? []).some((option) => option.code === code)
}

/** A code from an option list or null; an unknown code is `unknown_code`. */
function checkOption<T extends string>(
  errors: ApiFieldError[],
  field: string,
  list: string,
  value: T | null | undefined,
): T | null {
  if (value == null) return null
  if (typeof value !== 'string' || !hasOption(list, value)) {
    errors.push(fieldError(field, 'unknown_code'))
    return null
  }
  return value
}

function checkCode(errors: ApiFieldError[], field: string, codes: string[], value: unknown) {
  if (value == null) return null
  if (typeof value !== 'string' || !codes.includes(value)) {
    errors.push(fieldError(field, 'unknown_code'))
    return null
  }
  return value
}

function checkInteger(
  errors: ApiFieldError[],
  field: string,
  value: unknown,
  min: number,
  max: number,
  message?: string,
): number | null {
  if (value == null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    errors.push(fieldError(field, 'out_of_range', message))
    return null
  }
  return value
}

// ---------------------------------------------------------------------------
// Reference lookups
// ---------------------------------------------------------------------------

const ref = referenceBootstrap
const codesOf = (rows: { code: string }[]) => rows.map((row) => row.code)

export function sectsOf(religionCode: string | null): string[] {
  return codesOf(ref.religions.find((religion) => religion.code === religionCode)?.sects ?? [])
}

export function findCity(id: number | null | undefined): CityRef | null {
  const city = cities.find((entry) => entry.id === id)
  if (!city) return null
  return {
    id: city.id,
    name: city.name,
    region_id: city.region_id,
    region_name: city.region_name,
    country_code: city.country_code,
  }
}

export function countryHasRegions(countryCode: string | null | undefined): boolean {
  return Boolean(countryCode && (regionsByCountry[countryCode]?.length ?? 0) > 0)
}

// ---------------------------------------------------------------------------
// The own profile as the API returns it
// ---------------------------------------------------------------------------

const MANAGED_BY = ['self', 'parent', 'sibling', 'relative', 'friend'] as const
const CONSENTS: ConsentDocument[] = [
  'terms',
  'privacy',
  'community_guidelines',
  'age_declaration',
  'candidate_consent',
]
const NOT_WORKING = ['student', 'homemaker', 'not_working']

function isDraft(): boolean {
  return db.me.profile.status === 'draft'
}

/** Recorded consents. A profile past `account_for` is assumed to have recorded all of them. */
function recordedConsents(): ConsentDocument[] {
  const stored = db.extra['profile.consents'] as ConsentDocument[] | undefined
  if (stored) return stored
  return stepIndex(db.me.profile.onboarding_step) > 0 ? [...CONSENTS] : []
}

/** Fields the owner can no longer edit (08 section 2.2). */
function lockedFields(): string[] {
  const locked = new Set(db.ownProfile.locked_fields)
  if (!isDraft()) {
    locked.add('gender')
    locked.add('date_of_birth')
  }
  if (db.ownProfile.verification.id_verified) {
    locked.add('first_name')
    locked.add('last_name')
  }
  return [...locked]
}

/** `OwnProfile` with the status, step, photos and identity kept in line with the rest of `db`. */
export function ownProfileView(): OwnProfile {
  return {
    ...db.ownProfile,
    status: db.me.profile.status,
    status_reason: db.me.profile.status_reason,
    onboarding_step: db.me.profile.onboarding_step,
    locked_fields: lockedFields(),
    photos: db.ownPhotos,
    identity: db.identity,
  }
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

type Saved<T> = { errors: ApiFieldError[]; value: T; after?: () => void }

function saveAccountFor(body: Partial<AccountForBody>): Saved<OwnProfile['account_for']> {
  const errors: ApiFieldError[] = []
  const previous = db.ownProfile.account_for
  const managedBy = body.managed_by ?? null
  if (managedBy != null && !MANAGED_BY.includes(managedBy)) {
    errors.push(fieldError('managed_by', 'unknown_code'))
  }
  if (managedBy == null && !isDraft()) {
    errors.push(fieldError('managed_by', 'required', 'Choose who this profile is for.'))
  }
  const managerName = managedBy === 'self' ? null : collapse(body.manager_name)
  if (managedBy != null && managedBy !== 'self') {
    if (managerName == null) {
      if (!isDraft()) errors.push(fieldError('manager_name', 'required', 'Enter your name.'))
    } else {
      checkName(errors, 'manager_name', managerName, 80, {
        length: 'Enter a name of 2 to 80 characters.',
      })
    }
  }
  const consents = Array.isArray(body.consents) ? body.consents : []
  if (consents.some((document) => !CONSENTS.includes(document))) {
    errors.push(fieldError('consents', 'unknown_code'))
  }
  if (
    !isDraft() &&
    previous.managed_by === 'self' &&
    managedBy != null &&
    managedBy !== 'self' &&
    !recordedConsents().includes('candidate_consent') &&
    !consents.includes('candidate_consent')
  ) {
    errors.push(
      fieldError('consents', 'required', 'Please confirm that they agree to this profile.'),
    )
  }
  return {
    errors,
    value: { managed_by: managedBy, manager_name: managerName },
    after: () => {
      db.extra['profile.consents'] = Array.from(new Set([...recordedConsents(), ...consents]))
    },
  }
}

function saveBasics(body: Partial<BasicsSection>): Saved<BasicsSection> {
  const errors: ApiFieldError[] = []
  const previous = db.ownProfile.basics
  const locked = lockedFields()
  const draft = isDraft()

  const firstName = collapse(body.first_name)
  const lastName = collapse(body.last_name)
  if (firstName == null && !draft) {
    errors.push(fieldError('first_name', 'required', 'Enter the first name.'))
  }
  checkName(errors, 'first_name', firstName, 40, {
    length: 'The first name must be 2 to 40 characters.',
  })
  if (lastName == null && !draft) {
    errors.push(fieldError('last_name', 'required', 'Enter the last name.'))
  }
  checkName(errors, 'last_name', lastName, 40, {
    length: 'The last name must be 2 to 40 characters.',
  })
  for (const [field, value] of [
    ['first_name', firstName],
    ['last_name', lastName],
  ] as const) {
    if (locked.includes(field) && value !== previous[field]) {
      errors.push(
        fieldError(
          field,
          'locked',
          'The name cannot be changed after identity verification. Contact support to correct it.',
        ),
      )
    }
  }

  const gender = body.gender ?? null
  if (gender != null && gender !== 'male' && gender !== 'female') {
    errors.push(fieldError('gender', 'unknown_code'))
  }
  if (gender == null && !draft) errors.push(fieldError('gender', 'required', 'Select a gender.'))
  if (locked.includes('gender') && gender !== previous.gender) {
    errors.push(
      fieldError(
        'gender',
        'locked',
        'The gender cannot be changed. Contact support if it is wrong.',
      ),
    )
  }

  const dateOfBirth = body.date_of_birth ?? null
  if (dateOfBirth == null) {
    if (!draft) errors.push(fieldError('date_of_birth', 'required', 'Enter the date of birth.'))
  } else if (!isRealDate(dateOfBirth)) {
    errors.push(fieldError('date_of_birth', 'invalid', 'Enter a real date.'))
  } else {
    const age = ageFromDateOfBirth(dateOfBirth)
    if (age < 18) {
      errors.push(
        fieldError(
          'date_of_birth',
          'too_young',
          'The person the profile is for must be at least 18 years old.',
        ),
      )
    } else if (age > 80) {
      errors.push(fieldError('date_of_birth', 'out_of_range', 'Please check the year of birth.'))
    }
  }
  if (locked.includes('date_of_birth') && dateOfBirth !== previous.date_of_birth) {
    errors.push(
      fieldError(
        'date_of_birth',
        'locked',
        'The date of birth cannot be changed. Contact support if it is wrong.',
      ),
    )
  }

  const maritalStatus = checkOption(errors, 'marital_status', 'marital_status', body.marital_status)
  if (maritalStatus == null && body.marital_status == null && !draft) {
    errors.push(fieldError('marital_status', 'required', 'Select a marital status.'))
  }
  if (maritalStatus === 'married' && gender === 'female') {
    errors.push(fieldError('marital_status', 'not_allowed'))
  }

  let wives: number | null = null
  if (maritalStatus === 'married') {
    if (body.current_wives_count == null) {
      errors.push(
        fieldError('current_wives_count', 'required', 'Select the number of current wives.'),
      )
    } else {
      wives = checkInteger(
        errors,
        'current_wives_count',
        body.current_wives_count,
        1,
        3,
        'Choose 1, 2 or 3.',
      )
    }
  }

  let childrenStatus: BasicsSection['children_status'] = null
  let childrenCount: number | null = null
  if (maritalStatus === 'never_married') {
    childrenStatus = 'none'
  } else {
    childrenStatus = checkOption(errors, 'children_status', 'children_status', body.children_status)
    if (childrenStatus == null && maritalStatus != null && !draft) {
      errors.push(fieldError('children_status', 'required', 'Tell us whether there are children.'))
    }
    if (childrenStatus != null && childrenStatus !== 'none') {
      if (body.children_count == null) {
        errors.push(fieldError('children_count', 'required', 'Enter the number of children.'))
      } else {
        childrenCount = checkInteger(
          errors,
          'children_count',
          body.children_count,
          1,
          15,
          'Enter a number from 1 to 15.',
        )
      }
    }
  }

  const height = body.height_cm ?? null
  if (height == null && !draft) errors.push(fieldError('height_cm', 'required', 'Select a height.'))
  checkInteger(
    errors,
    'height_cm',
    height,
    122,
    213,
    'Choose a height between 4 ft 0 in and 7 ft 0 in.',
  )

  return {
    errors,
    value: {
      first_name: firstName,
      last_name: lastName,
      gender,
      date_of_birth: dateOfBirth,
      marital_status: maritalStatus,
      children_status: childrenStatus,
      children_count: childrenCount,
      current_wives_count: wives,
      height_cm: height,
    },
    after: () => {
      if (!draft) return
      // 07 section 4.2 rules 8 and 9.
      if (gender === 'male') db.ownProfile.lifestyle = { ...db.ownProfile.lifestyle, hijab: null }
      if (gender === 'female') {
        db.ownProfile.lifestyle = { ...db.ownProfile.lifestyle, beard: null }
        if (db.privacy.photo_visibility === 'members' && !db.extra['privacy.photoChosen']) {
          db.privacy = { ...db.privacy, photo_visibility: 'interests_and_connections' }
        }
      }
    },
  }
}

function isRealDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

function saveCommunity(body: Partial<CommunitySection>): Saved<CommunitySection> {
  const errors: ApiFieldError[] = []
  const draft = isDraft()
  const religion = checkCode(errors, 'religion_code', codesOf(ref.religions), body.religion_code)
  if (body.religion_code == null && !draft) {
    errors.push(fieldError('religion_code', 'required', 'Select a religion.'))
  }

  const sects = sectsOf(religion)
  let sect: string | null = body.sect_code ?? null
  if (sect != null && !sects.includes(sect)) {
    errors.push(
      fieldError('sect_code', 'mismatch', 'This sect does not belong to the selected religion.'),
    )
    sect = null
  }
  if (sect == null && sects.length > 0 && !draft) {
    errors.push(fieldError('sect_code', 'required', 'Select a sect.'))
  }

  const casteCode = checkCode(errors, 'caste_code', codesOf(ref.castes), body.caste_code)
  const casteOther = collapse(body.caste_other)
  if (casteCode != null && casteOther != null) {
    errors.push(
      fieldError(
        'caste_other',
        'not_allowed',
        'Choose a caste from the list or type your own, not both.',
      ),
    )
  }
  const casteMessage = 'Enter only the caste or clan name.'
  checkText(errors, 'caste_other', casteOther, {
    min: 2,
    max: 60,
    short: true,
    lengthMessage: 'Enter 2 to 60 characters.',
    contactMessage: casteMessage,
  })

  const subCasteCode = body.sub_caste_code ?? null
  const subCasteOther = collapse(body.sub_caste_other)
  if ((subCasteCode != null || subCasteOther != null) && casteCode == null && casteOther == null) {
    errors.push(
      fieldError(
        subCasteCode != null ? 'sub_caste_code' : 'sub_caste_other',
        'not_allowed',
        'Choose a caste first.',
      ),
    )
  } else if (subCasteCode != null) {
    const caste = ref.castes.find((entry) => entry.code === casteCode)
    if (!caste?.sub_castes.some((entry) => entry.code === subCasteCode)) {
      errors.push(
        fieldError(
          'sub_caste_code',
          'mismatch',
          'This sub-caste does not belong to the selected caste.',
        ),
      )
    }
  }
  if (subCasteCode != null && subCasteOther != null) {
    errors.push(fieldError('sub_caste_other', 'not_allowed'))
  }
  checkText(errors, 'sub_caste_other', subCasteOther, {
    min: 2,
    max: 60,
    short: true,
    lengthMessage: 'Enter 2 to 60 characters.',
    contactMessage: casteMessage,
  })

  const languageCodes = codesOf(ref.languages)
  const motherTongue = checkCode(
    errors,
    'mother_tongue_code',
    languageCodes,
    body.mother_tongue_code,
  )
  if (body.mother_tongue_code == null && !draft) {
    errors.push(fieldError('mother_tongue_code', 'required', 'Select a mother tongue.'))
  }
  const languages = Array.from(new Set(body.language_codes ?? [])).filter(
    (code) => code !== motherTongue,
  )
  if (languages.some((code) => !languageCodes.includes(code))) {
    errors.push(fieldError('language_codes', 'unknown_code'))
  }
  if (languages.length > 6) {
    errors.push(fieldError('language_codes', 'too_long', 'Choose up to 6 languages.'))
  }

  return {
    errors,
    value: {
      religion_code: religion,
      sect_code: sect,
      caste_code: casteCode,
      caste_other: casteOther,
      sub_caste_code: subCasteCode,
      sub_caste_other: subCasteOther,
      mother_tongue_code: motherTongue,
      language_codes: languages,
    },
  }
}

function saveLocation(body: Partial<LocationSection>): Saved<OwnProfile['location']> {
  const errors: ApiFieldError[] = []
  const draft = isDraft()
  const countryCodes = codesOf(ref.countries)
  const country = checkCode(errors, 'country_code', countryCodes, body.country_code)
  if (body.country_code == null && !draft) {
    errors.push(fieldError('country_code', 'required', 'Select a country.'))
  }
  const nationality = checkCode(errors, 'nationality_code', countryCodes, body.nationality_code)

  let regionId = body.region_id ?? null
  let cityId = body.city_id ?? null
  const cityOther = collapse(body.city_other)
  if (cityId != null && cityOther != null) {
    errors.push(
      fieldError('city_other', 'not_allowed', 'Choose a city from the list or type one, not both.'),
    )
  }
  const city = findCity(cityId)
  if (cityId != null && !city) {
    errors.push(fieldError('city_id', 'unknown_code'))
    cityId = null
  } else if (city) {
    if (city.country_code !== country) {
      errors.push(fieldError('city_id', 'mismatch', 'This city is not in the selected country.'))
    }
    regionId = city.region_id
  }
  checkText(errors, 'city_other', cityOther, {
    min: 2,
    max: 60,
    short: true,
    lengthMessage: 'Enter 2 to 60 characters.',
    contactMessage: 'Enter only the place name.',
  })
  if (!city && regionId != null) {
    const regions = regionsByCountry[country ?? ''] ?? []
    if (!regions.some((region) => region.id === regionId)) {
      errors.push(
        fieldError(
          'region_id',
          'mismatch',
          'This province or state is not in the selected country.',
        ),
      )
    }
  }

  const area = collapse(body.area)
  checkText(errors, 'area', area, {
    max: 80,
    short: true,
    lengthMessage: 'Keep it under 80 characters.',
    contactMessage: 'Enter only the place name.',
  })

  let residency = checkOption(errors, 'residency_status', 'residency_status', body.residency_status)
  if (country != null && nationality != null && country === nationality) residency = 'citizen'

  let originCityId = body.origin_city_id ?? null
  const originOther = collapse(body.origin_other)
  const originCity = findCity(originCityId)
  if (originCityId != null && originCity?.country_code !== 'PK') {
    errors.push(fieldError('origin_city_id', 'mismatch', 'Choose a city in Pakistan.'))
    originCityId = null
  }
  if (originCityId != null && originOther != null) {
    errors.push(fieldError('origin_other', 'not_allowed'))
  }
  checkText(errors, 'origin_other', originOther, {
    max: 60,
    short: true,
    lengthMessage: 'Keep it under 60 characters.',
    contactMessage: 'Enter only the place name.',
  })
  const relocation = checkOption(errors, 'relocation', 'relocation', body.relocation)

  return {
    errors,
    value: {
      nationality_code: nationality,
      country_code: country,
      region_id: regionId,
      city_id: cityId,
      city_other: cityId != null ? null : cityOther,
      area,
      residency_status: residency,
      origin_city_id: originCityId,
      origin_other: originOther,
      relocation,
      city: city ?? null,
      origin_city: originCityId != null ? originCity : null,
    },
  }
}

function saveEducationCareer(body: Partial<EducationCareerSection>): Saved<EducationCareerSection> {
  const errors: ApiFieldError[] = []
  const draft = isDraft()
  const level = checkCode(
    errors,
    'education_level_code',
    codesOf(ref.education_levels),
    body.education_level_code,
  )
  if (body.education_level_code == null && !draft) {
    errors.push(fieldError('education_level_code', 'required', 'Select the highest education.'))
  }
  const field = checkCode(
    errors,
    'education_field_code',
    codesOf(ref.education_fields),
    body.education_field_code,
  )
  const employment = checkOption(errors, 'employment_type', 'employment_type', body.employment_type)
  if (body.employment_type == null && !draft) {
    errors.push(fieldError('employment_type', 'required', 'Select an employment type.'))
  }
  const working = !NOT_WORKING.includes(employment ?? '')
  const profession = working
    ? checkCode(errors, 'profession_code', codesOf(ref.profession_categories), body.profession_code)
    : null
  const income = working
    ? checkCode(errors, 'income_band_code', codesOf(ref.income_bands), body.income_band_code)
    : null

  const degree = collapse(body.degree_title)
  const institute = collapse(body.institute_name)
  const jobTitle = working ? collapse(body.job_title) : null
  const employer = working ? collapse(body.employer_name) : null
  const contactMessage =
    'Please remove phone numbers, email addresses, links and social media names.'
  checkText(errors, 'degree_title', degree, {
    max: 80,
    short: true,
    lengthMessage: 'Keep it under 80 characters.',
    contactMessage,
  })
  checkText(errors, 'institute_name', institute, {
    max: 120,
    short: true,
    allowDomains: true,
    lengthMessage: 'Keep it under 120 characters.',
    contactMessage,
  })
  checkText(errors, 'job_title', jobTitle, {
    max: 80,
    short: true,
    lengthMessage: 'Keep it under 80 characters.',
    contactMessage,
  })
  checkText(errors, 'employer_name', employer, {
    max: 120,
    short: true,
    allowDomains: true,
    lengthMessage: 'Keep it under 120 characters.',
    contactMessage,
  })

  return {
    errors,
    value: {
      education_level_code: level,
      education_field_code: field,
      degree_title: degree,
      institute_name: institute,
      employment_type: employment,
      profession_code: profession,
      job_title: jobTitle,
      employer_name: employer,
      income_band_code: income,
    },
  }
}

const LONG_TEXT_CONTACT =
  'Please remove phone numbers, email addresses, links and social media names. Contact details are shared only through contact sharing.'

function nextTextStatus(
  previous: string | null | undefined,
  next: string | null,
  status: TextStatus,
) {
  if (next == null) return 'approved' as const
  return next === previous ? status : ('pending' as const)
}

function saveFamily(body: Partial<FamilySection>): Saved<FamilySection> {
  const errors: ApiFieldError[] = []
  const parent = (field: 'father_status' | 'mother_status') =>
    checkOption(errors, field, 'parent_status', body[field])
  const fatherStatus = parent('father_status')
  const motherStatus = parent('mother_status')
  const fatherOccupation = collapse(body.father_occupation)
  const motherOccupation = collapse(body.mother_occupation)
  for (const [field, value] of [
    ['father_occupation', fatherOccupation],
    ['mother_occupation', motherOccupation],
  ] as const) {
    checkText(errors, field, value, {
      max: 80,
      short: true,
      lengthMessage: 'Keep it under 80 characters.',
    })
  }

  const counts = { brothers: body.brothers_count ?? null, sisters: body.sisters_count ?? null }
  const married = { brothers: body.brothers_married ?? null, sisters: body.sisters_married ?? null }
  for (const kind of ['brothers', 'sisters'] as const) {
    const total = checkInteger(
      errors,
      `${kind}_count`,
      counts[kind],
      0,
      15,
      'Enter a number from 0 to 15.',
    )
    const wed = married[kind]
    if (wed != null) {
      if (counts[kind] == null) errors.push(fieldError(`${kind}_count`, 'required'))
      else if (typeof wed !== 'number' || wed < 0 || (total != null && wed > total)) {
        errors.push(
          fieldError(
            `${kind}_married`,
            'out_of_range',
            `Married ${kind} cannot be more than the number of ${kind}.`,
          ),
        )
      }
    }
  }

  const familyType = checkOption(errors, 'family_type', 'family_type', body.family_type)
  const familyClass = checkOption(errors, 'family_class', 'family_class', body.family_class)
  const familyValues = checkOption(errors, 'family_values', 'family_values', body.family_values)
  const familyCountry = checkCode(
    errors,
    'family_country_code',
    codesOf(ref.countries),
    body.family_country_code,
  )
  const familyCityId = body.family_city_id ?? null
  if (familyCityId != null) {
    const city = findCity(familyCityId)
    if (familyCountry == null) errors.push(fieldError('family_country_code', 'required'))
    else if (city?.country_code !== familyCountry) {
      errors.push(
        fieldError('family_city_id', 'mismatch', 'This city is not in the selected country.'),
      )
    }
  }

  const homeOwnership = checkOption(errors, 'home_ownership', 'home_ownership', body.home_ownership)
  const homeType = checkOption(errors, 'home_type', 'home_type', body.home_type)
  const sizeValue = body.home_size_value ?? null
  const sizeUnit = checkOption(errors, 'home_size_unit', 'home_size_unit', body.home_size_unit)
  const both = 'Enter both the size and the unit.'
  if (sizeValue != null && body.home_size_unit == null) {
    errors.push(fieldError('home_size_unit', 'required', both))
  }
  if (sizeValue == null && body.home_size_unit != null) {
    errors.push(fieldError('home_size_value', 'required', both))
  }
  if (
    sizeValue != null &&
    (typeof sizeValue !== 'number' ||
      sizeValue <= 0 ||
      sizeValue > 99_999.99 ||
      Math.round(sizeValue * 100) !== sizeValue * 100)
  ) {
    errors.push(fieldError('home_size_value', 'out_of_range', 'Enter a size greater than 0.'))
  }

  const aboutFamily = trimmed(body.about_family)
  checkText(errors, 'about_family', aboutFamily, {
    min: 30,
    max: 1000,
    contactMessage: LONG_TEXT_CONTACT,
    lengthMessage:
      aboutFamily && aboutFamily.length < 30
        ? 'Write at least 30 characters, or leave it empty for now.'
        : 'Keep it under 1,000 characters.',
  })

  return {
    errors,
    value: {
      father_status: fatherStatus,
      father_occupation: fatherOccupation,
      mother_status: motherStatus,
      mother_occupation: motherOccupation,
      brothers_count: counts.brothers,
      brothers_married: counts.brothers == null || counts.brothers === 0 ? null : married.brothers,
      sisters_count: counts.sisters,
      sisters_married: counts.sisters == null || counts.sisters === 0 ? null : married.sisters,
      family_type: familyType,
      family_class: familyClass,
      family_values: familyValues,
      family_country_code: familyCountry,
      family_city_id: familyCityId,
      home_ownership: homeOwnership,
      home_type: homeType,
      home_size_value: sizeValue,
      home_size_unit: sizeUnit,
      about_family: aboutFamily,
    },
    after: () => {
      db.ownProfile.text_status = {
        ...db.ownProfile.text_status,
        about_family: nextTextStatus(
          db.ownProfile.family.about_family,
          aboutFamily,
          db.ownProfile.text_status.about_family,
        ),
      }
    },
  }
}

function saveLifestyle(body: Partial<LifestyleSection>): Saved<LifestyleSection> {
  const errors: ApiFieldError[] = []
  const gender = db.ownProfile.basics.gender
  // Each option field of this section is checked against the list of the same name.
  const option = <T extends string>(field: keyof LifestyleSection, value: T | null | undefined) =>
    checkOption(errors, field, field, value)
  const hijab = option('hijab', body.hijab)
  const beard = option('beard', body.beard)
  if (hijab != null && gender !== 'female') errors.push(fieldError('hijab', 'not_allowed'))
  if (beard != null && gender !== 'male') errors.push(fieldError('beard', 'not_allowed'))
  const weight = checkInteger(
    errors,
    'weight_kg',
    body.weight_kg,
    30,
    200,
    'Enter a weight between 30 and 200 kg.',
  )
  const disability = option('disability', body.disability)
  const details =
    disability == null || disability === 'none' ? null : collapse(body.disability_details)
  checkText(errors, 'disability_details', details, {
    max: 300,
    short: true,
    lengthMessage: 'Keep it under 300 characters.',
  })
  const hobbyCodes = codesOf(ref.hobbies)
  const hobbies = Array.from(new Set(body.hobby_codes ?? []))
  if (hobbies.some((code) => !hobbyCodes.includes(code))) {
    errors.push(fieldError('hobby_codes', 'unknown_code'))
  }
  if (hobbies.length > 10) {
    errors.push(fieldError('hobby_codes', 'too_long', 'Choose up to 10 hobbies.'))
  }
  const aboutMe = trimmed(body.about_me)
  checkText(errors, 'about_me', aboutMe, {
    min: 50,
    max: 1500,
    contactMessage: LONG_TEXT_CONTACT,
    lengthMessage:
      aboutMe && aboutMe.length < 50
        ? 'Write at least 50 characters, or leave it empty for now.'
        : 'Keep it under 1,500 characters.',
  })

  return {
    errors,
    value: {
      religiosity: option('religiosity', body.religiosity),
      prayer_frequency: option('prayer_frequency', body.prayer_frequency),
      hijab,
      beard,
      religious_education: option('religious_education', body.religious_education),
      smoking: option('smoking', body.smoking),
      living_arrangement: option('living_arrangement', body.living_arrangement),
      work_after_marriage: option('work_after_marriage', body.work_after_marriage),
      marriage_timeline: option('marriage_timeline', body.marriage_timeline),
      jahez_stance: option('jahez_stance', body.jahez_stance),
      weight_kg: weight,
      complexion: option('complexion', body.complexion),
      body_type: option('body_type', body.body_type),
      blood_group: option('blood_group', body.blood_group),
      disability,
      disability_details: details,
      hobby_codes: hobbies,
      about_me: aboutMe,
    },
    after: () => {
      db.ownProfile.text_status = {
        ...db.ownProfile.text_status,
        about_me: nextTextStatus(
          db.ownProfile.lifestyle.about_me,
          aboutMe,
          db.ownProfile.text_status.about_me,
        ),
      }
    },
  }
}

const SECTION_SAVERS = {
  account_for: saveAccountFor,
  basics: saveBasics,
  community: saveCommunity,
  location: saveLocation,
  education_career: saveEducationCareer,
  family: saveFamily,
  lifestyle: saveLifestyle,
} as const

type SectionKey = keyof typeof SECTION_SAVERS

function isSectionKey(value: string): value is SectionKey {
  return value in SECTION_SAVERS
}

// ---------------------------------------------------------------------------
// Step requirements (03 section 4.3 and the conditional rules of 07)
// ---------------------------------------------------------------------------

function missing(field: string, message?: string) {
  return fieldError(field, 'required', message)
}

/** The fields that keep `step` from being continued; empty when its requirement is met. */
export function stepRequirementErrors(step: string): ApiFieldError[] {
  const profile = db.ownProfile
  const errors: ApiFieldError[] = []
  switch (step) {
    case 'account_for': {
      const { managed_by, manager_name } = profile.account_for
      if (!managed_by) errors.push(missing('managed_by', 'Choose who this profile is for.'))
      if (managed_by && managed_by !== 'self' && !manager_name) {
        errors.push(missing('manager_name', 'Enter your name.'))
      }
      const needed: ConsentDocument[] = [
        'terms',
        'privacy',
        'community_guidelines',
        'age_declaration',
      ]
      if (managed_by && managed_by !== 'self') needed.push('candidate_consent')
      const recorded = recordedConsents()
      if (needed.some((document) => !recorded.includes(document))) {
        errors.push(
          missing(
            'consents',
            'Please agree to the Terms of Use, Privacy Policy and Community Guidelines.',
          ),
        )
      }
      break
    }
    case 'basics': {
      const basics = profile.basics
      if (!basics.first_name) errors.push(missing('first_name', 'Enter the first name.'))
      if (!basics.last_name) errors.push(missing('last_name', 'Enter the last name.'))
      if (!basics.gender) errors.push(missing('gender', 'Select a gender.'))
      if (!basics.date_of_birth) errors.push(missing('date_of_birth', 'Enter the date of birth.'))
      else if (ageFromDateOfBirth(basics.date_of_birth) < 18) {
        errors.push(fieldError('date_of_birth', 'too_young'))
      }
      if (!basics.marital_status) {
        errors.push(missing('marital_status', 'Select a marital status.'))
      } else if (basics.marital_status !== 'never_married') {
        if (!basics.children_status) {
          errors.push(missing('children_status', 'Tell us whether there are children.'))
        } else if (basics.children_status !== 'none' && basics.children_count == null) {
          errors.push(missing('children_count', 'Enter the number of children.'))
        }
      }
      if (basics.marital_status === 'married' && basics.current_wives_count == null) {
        errors.push(missing('current_wives_count', 'Select the number of current wives.'))
      }
      if (basics.height_cm == null) errors.push(missing('height_cm', 'Select a height.'))
      break
    }
    case 'community': {
      const community = profile.community
      if (!community.religion_code) errors.push(missing('religion_code', 'Select a religion.'))
      else if (sectsOf(community.religion_code).length > 0 && !community.sect_code) {
        errors.push(missing('sect_code', 'Select a sect.'))
      }
      if (!community.mother_tongue_code) {
        errors.push(missing('mother_tongue_code', 'Select a mother tongue.'))
      }
      break
    }
    case 'location': {
      const location = profile.location
      if (!location.country_code) errors.push(missing('country_code', 'Select a country.'))
      if (location.city_id == null && !location.city_other) {
        errors.push(
          missing('city_id', "Select a city, or choose 'My city is not listed' and type it."),
        )
      }
      if (
        location.city_id == null &&
        location.city_other &&
        countryHasRegions(location.country_code) &&
        location.region_id == null
      ) {
        errors.push(missing('region_id', 'Select a province or state.'))
      }
      if (
        location.country_code &&
        location.nationality_code !== location.country_code &&
        !location.residency_status
      ) {
        errors.push(missing('residency_status', 'Select a residency status.'))
      }
      break
    }
    case 'education_career': {
      const education = profile.education_career
      if (!education.education_level_code) {
        errors.push(missing('education_level_code', 'Select the highest education.'))
      }
      if (!education.employment_type) {
        errors.push(missing('employment_type', 'Select an employment type.'))
      }
      break
    }
    case 'photos': {
      const usable = db.ownPhotos.filter(
        (photo) => photo.status !== 'rejected' && photo.status !== 'failed',
      )
      if (db.me.config.photo_required && usable.length === 0) {
        errors.push(missing('photos', 'Add at least one photo to continue.'))
      }
      break
    }
    case 'preferences':
      if (!db.preferences) errors.push(missing('preferences', 'Save the preferences to continue.'))
      break
    case 'identity':
      if (db.me.config.identity_required && !db.identity) {
        errors.push(missing('number', 'Enter the identity number to continue.'))
      }
      break
    default:
      break
  }
  return errors
}

/** Every requirement that `complete` and `resubmit` re-validate. */
function allRequirementErrors(): ApiFieldError[] {
  return ONBOARDING_STEPS.filter((step) => step !== 'review').flatMap(stepRequirementErrors)
}

// ---------------------------------------------------------------------------
// Preview (08 section 4)
// ---------------------------------------------------------------------------

function displayName(tier: Tier): string {
  const { first_name, last_name } = db.ownProfile.basics
  const first = first_name ?? ''
  const last = last_name ?? ''
  const display = db.privacy.name_display
  if (display === 'full_name' && tier === 'connection') return `${first} ${last}`.trim()
  switch (display) {
    case 'code_only':
      return db.ownProfile.public_code
    case 'initials':
      return `${first.charAt(0)}. ${last.charAt(0)}.`
    case 'first_name_only':
      return first
    default:
      return `${first} ${last.charAt(0)}.`.trim()
  }
}

function visibleTo(visibility: 'members' | 'connections' | 'nobody', tier: Tier): boolean {
  if (visibility === 'members') return true
  return visibility === 'connections' && tier === 'connection'
}

function photoViews(tier: Tier): PhotoView[] {
  const visibility = db.privacy.photo_visibility
  const clear =
    visibility === 'members' || (tier === 'connection' && visibility !== 'approved_only')
  return db.ownPhotos
    .filter((photo: OwnPhoto) => photo.status === 'approved')
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.position - b.position)
    .map((photo) => ({
      id: photo.id,
      is_primary: photo.is_primary,
      is_blurred: !clear,
      thumb_url: photo.thumb_url ?? '',
      medium_url: photo.medium_url ?? '',
      large_url: clear ? photo.large_url : null,
    }))
}

function lookingForLines(): ProfileDetail['looking_for'] {
  const preferences = currentPreferences()
  const lines: ProfileDetail['looking_for']['lines'] = []
  const add = (
    dimension: string,
    values: (string | number)[],
    importance: typeof preferences.age_importance,
  ) => {
    if (values.length > 0) {
      lines.push({
        dimension,
        summary_values: values.map(String),
        importance,
        viewer_matches: null,
      })
    }
  }
  if (preferences.age_min !== 18 || preferences.age_max !== 80) {
    add('age', [preferences.age_min, preferences.age_max], preferences.age_importance)
  }
  add('marital_status', preferences.marital_statuses, preferences.marital_status_importance)
  add('religion', preferences.religion_codes, preferences.religion_importance)
  add('sect', preferences.sect_codes, preferences.sect_importance)
  add('location', preferences.country_codes, preferences.location_importance)
  if (preferences.education_min_rank != null) {
    add('education', [preferences.education_min_rank], preferences.education_importance)
  }
  return { lines, matched: 0, total: 0 }
}

/** The own profile as a member of `tier` would receive it (15 section 7). */
export function previewDetail(tier: Tier): ProfileDetail {
  const profile = ownProfileView()
  const privacy = db.privacy
  const locked: LockedGroup[] = []
  const show = (group: LockedGroup, visibility: 'members' | 'connections' | 'nobody') => {
    const visible = visibleTo(visibility, tier)
    if (!visible) locked.push(group)
    return visible
  }
  const showCaste = show('caste', privacy.caste_visibility)
  const showIncome = show('income', privacy.income_visibility)
  const showFamily = show('family', privacy.family_visibility)
  const showCareer = show('career_details', privacy.career_details_visibility)
  const showHome = show('home', privacy.home_visibility)
  const showArea = show('area', privacy.area_visibility)
  const showHealth = show('health', privacy.health_visibility)
  const photos = photoViews(tier)
  if (photos.some((photo) => photo.is_blurred)) locked.push('photos')

  const { basics, community, location, education_career: education, family, lifestyle } = profile
  const casteName = community.caste_code
    ? (ref.castes.find((caste) => caste.code === community.caste_code)?.name ?? null)
    : community.caste_other
  const subCasteName = community.sub_caste_code
    ? (ref.castes
        .flatMap((caste) => caste.sub_castes)
        .find((entry) => entry.code === community.sub_caste_code)?.name ?? null)
    : community.sub_caste_other
  const cityName = location.city?.name ?? location.city_other ?? ''
  const card = makeProfileCard({
    id: profile.id,
    public_code: profile.public_code,
    display_name: displayName(tier),
    age: basics.date_of_birth ? ageFromDateOfBirth(basics.date_of_birth) : 0,
    gender: basics.gender ?? 'female',
    managed_by: profile.account_for.managed_by ?? 'self',
    height_cm: basics.height_cm ?? 0,
    marital_status: basics.marital_status ?? 'never_married',
    religion_code: community.religion_code ?? '',
    sect_code: community.sect_code ?? null,
    caste_label: showCaste ? (casteName ?? null) : null,
    mother_tongue_code: community.mother_tongue_code ?? '',
    city_name: cityName,
    region_name: location.city?.region_name ?? null,
    country_code: location.country_code ?? '',
    education_level_code: education.education_level_code ?? '',
    employment_type: education.employment_type ?? 'not_working',
    profession_code: education.profession_code ?? null,
    photo: photos[0] ?? null,
    photo_count: photos.length,
    badges: db.me.profile.badges,
    last_active: privacy.show_last_active ? 'online' : null,
    compat: null,
    reasons: [],
    relation: {
      tier,
      interest_status: null,
      interest_direction: null,
      connection_id: null,
      is_shortlisted: false,
      can_send_interest: false,
    },
  })
  const textApproved = profile.text_status
  return makeProfileDetail({
    card,
    is_online: privacy.show_online_status ? true : null,
    photos,
    basics: {
      marital_status: card.marital_status,
      children_status: basics.children_status ?? null,
      children_count: basics.children_count ?? null,
      current_wives_count: basics.current_wives_count ?? null,
      height_cm: card.height_cm,
      weight_kg: lifestyle.weight_kg ?? null,
      complexion: lifestyle.complexion ?? null,
      body_type: lifestyle.body_type ?? null,
    },
    community: {
      religion_code: card.religion_code,
      sect_code: community.sect_code ?? null,
      caste_label: card.caste_label,
      sub_caste_label: showCaste ? (subCasteName ?? null) : null,
      mother_tongue_code: card.mother_tongue_code,
      language_codes: community.language_codes ?? [],
    },
    location: {
      country_code: card.country_code,
      region_name: card.region_name,
      city_name: cityName,
      area: showArea ? (location.area ?? null) : null,
      nationality_code: location.nationality_code ?? null,
      residency_status: location.residency_status ?? null,
      origin_label: location.origin_city?.name ?? location.origin_other ?? null,
      relocation: location.relocation ?? null,
    },
    education_career: {
      education_level_code: card.education_level_code,
      education_field_code: education.education_field_code ?? null,
      degree_title: education.degree_title ?? null,
      institute_name: showCareer ? (education.institute_name ?? null) : null,
      employment_type: card.employment_type,
      profession_code: card.profession_code,
      job_title: education.job_title ?? null,
      employer_name: showCareer ? (education.employer_name ?? null) : null,
      income_band_code: showIncome ? (education.income_band_code ?? null) : null,
    },
    family: showFamily
      ? {
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
          family_country_code: family.family_country_code ?? null,
          family_city_name: findCity(family.family_city_id)?.name ?? null,
          home_ownership: showHome ? (family.home_ownership ?? null) : null,
          home_type: showHome ? (family.home_type ?? null) : null,
          home_size_value: showHome ? (family.home_size_value ?? null) : null,
          home_size_unit: showHome ? (family.home_size_unit ?? null) : null,
        }
      : null,
    lifestyle: {
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
      blood_group: showHealth ? (lifestyle.blood_group ?? null) : null,
      disability: showHealth ? (lifestyle.disability ?? null) : null,
      disability_details: showHealth ? (lifestyle.disability_details ?? null) : null,
      hobby_codes: lifestyle.hobby_codes ?? [],
    },
    about_me: textApproved.about_me === 'approved' ? (lifestyle.about_me ?? null) : null,
    about_family:
      showFamily && textApproved.about_family === 'approved' ? (family.about_family ?? null) : null,
    partner_notes:
      textApproved.partner_notes === 'approved' ? (currentPreferences().notes ?? null) : null,
    looking_for: lookingForLines(),
    compatibility: null,
    locked,
    relation: {
      tier,
      interest: null,
      connection_id: null,
      is_shortlisted: false,
      shortlist_note: null,
      is_passed: false,
      photo_access: 'visible',
      can_send_interest: false,
      cannot_send_reason: null,
      cannot_send_detail: null,
      can_send_interest_after: null,
    },
  })
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function nextStep(step: string): OwnProfile['onboarding_step'] {
  const index = stepIndex(step)
  return ONBOARDING_STEPS[index + 1] ?? 'done'
}

function setStep(step: OwnProfile['onboarding_step']) {
  db.me.profile.onboarding_step = step
  db.ownProfile = { ...db.ownProfile, onboarding_step: step }
}

function setStatus(status: OwnProfile['status'], reason: string | null = null) {
  db.me.profile.status = status
  db.me.profile.status_reason = reason
  db.ownProfile = { ...db.ownProfile, status, status_reason: reason }
}

/** 15 section 7: own profile and onboarding. */
export const handlers = [
  http.get(apiUrl('/v1/me/profile'), () => {
    const blocked = gateErrorFor('open')
    if (blocked) return blocked
    return HttpResponse.json(ownProfileView())
  }),

  http.get(apiUrl('/v1/me/profile/preview'), ({ request }) => {
    const blocked = gateErrorFor('open')
    if (blocked) return blocked
    const as = new URL(request.url).searchParams.get('as') ?? 'member'
    if (as !== 'member' && as !== 'connection') {
      return validationError([fieldError('as', 'invalid')])
    }
    return HttpResponse.json(previewDetail(as))
  }),

  http.put(apiUrl('/v1/me/profile/sections/:section'), async ({ request, params }) => {
    const section = String(params.section)
    // Contacts belong to SET-CONTACTS (08 section 3): fall through to its handler.
    if (section === 'contacts') return undefined
    const blocked = gateErrorFor('open')
    if (blocked) return blocked
    if (!isSectionKey(section)) return apiError(404, 'not_found', 'Unknown section')
    const body = await readJson<Record<string, unknown>>(request)
    const saved = SECTION_SAVERS[section](body as never)
    if (saved.errors.length > 0) return validationError(saved.errors)
    saved.after?.()
    db.ownProfile = { ...db.ownProfile, [section]: saved.value }
    const { account_for, basics } = db.ownProfile
    db.me.profile.first_name = basics.first_name ?? null
    db.me.profile.gender = basics.gender ?? null
    db.me.profile.managed_by = account_for.managed_by
    return HttpResponse.json(ownProfileView())
  }),

  http.post(apiUrl('/v1/me/onboarding/continue'), async ({ request }) => {
    const blocked = gateErrorFor('open')
    if (blocked) return blocked
    const body = await readJson<{ step?: string }>(request)
    const current = db.me.profile.onboarding_step
    if (
      db.me.profile.status !== 'draft' ||
      !body.step ||
      body.step !== current ||
      body.step === 'review' ||
      body.step === 'done'
    ) {
      return apiError(409, 'invalid_state', 'This step is not the current step.', {
        details: { onboarding_step: current, status: db.me.profile.status },
      })
    }
    const errors = stepRequirementErrors(body.step)
    if (errors.length > 0) return validationError(errors)
    setStep(nextStep(body.step))
    return HttpResponse.json(currentMe())
  }),

  http.post(apiUrl('/v1/me/onboarding/complete'), () => {
    const blocked = gateErrorFor('open')
    if (blocked) return blocked
    const current = db.me.profile.onboarding_step
    if (db.me.profile.status !== 'draft' || current !== 'review') {
      return apiError(409, 'invalid_state', 'Onboarding is not at the review step.', {
        details: { onboarding_step: current, status: db.me.profile.status },
      })
    }
    const errors = allRequirementErrors()
    if (errors.length > 0) return validationError(errors)
    setStep('done')
    setStatus(db.extra.profileReview === 'manual' ? 'pending_review' : 'active')
    return HttpResponse.json(currentMe())
  }),

  http.post(apiUrl('/v1/me/profile/resubmit'), () => {
    const blocked = gateErrorFor('open')
    if (blocked) return blocked
    if (db.me.profile.status !== 'changes_requested') {
      return apiError(
        409,
        'invalid_state',
        'Only a profile with requested changes can be resubmitted.',
        {
          details: { status: db.me.profile.status },
        },
      )
    }
    const errors = allRequirementErrors()
    if (errors.length > 0) return validationError(errors)
    setStatus('pending_review')
    return HttpResponse.json(currentMe())
  }),
]
