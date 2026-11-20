import { describe, expect, it } from 'vitest'
import { EMPTY_CITY_VALUE } from '~/components/common/fields'
import { feetInchesToCm } from '~/lib/format'
import { i18n } from '~/lib/i18n'
import { makeOwnProfile } from '~/mocks/factories'
import { stepForField } from './field-steps'
import { buildAboutMeDraft, hobbyList } from './help-me-write'
import { currencyForCountry, initialIncomeCurrency } from './income'
import {
  type AccountForValues,
  accountForFromProfile,
  accountForSchema,
  accountForToBody,
  type BasicsValues,
  basicsToBody,
  type CommunityValues,
  communityToBody,
  dateOfBirthCode,
  educationCareerFromProfile,
  educationCareerToBody,
  type FamilyValues,
  familyFromProfile,
  familyToBody,
  type LifestyleValues,
  type LocationValues,
  lifestyleFromProfile,
  lifestyleToBody,
  locationToBody,
  validateAccountFor,
  validateBasics,
  validateCommunity,
  validateEducationCareer,
  validateFamily,
  validateLifestyle,
  validateLocation,
} from './schemas'
import { subjectOf, wordingContext } from './wording'

const key = (path: string) => `profile_sections:errors.${path}`
const issuesOf = (list: { path: string; message: string }[]) =>
  Object.fromEntries(list.map((issue) => [issue.path, issue.message]))

/** YYYY-MM-DD for the date `years` years before `now`, shifted by `days`. */
function birthDate(years: number, days = 0, now = new Date()) {
  const date = new Date(
    Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate() + days),
  )
  return date.toISOString().slice(0, 10)
}

describe('account_for (07 section 3)', () => {
  const onboarding = { mode: 'onboarding' as const, savedManagedBy: null }
  const values: AccountForValues = {
    managed_by: 'parent',
    manager_name: 'Rukhsana Khan',
    consent_terms: true,
    consent_age: true,
    consent_candidate: true,
  }

  it('builds the request of 07 section 3.3', () => {
    expect(validateAccountFor(values, onboarding)).toEqual([])
    expect(accountForToBody(values, onboarding)).toEqual({
      managed_by: 'parent',
      manager_name: 'Rukhsana Khan',
      consents: [
        'terms',
        'privacy',
        'community_guidelines',
        'age_declaration',
        'candidate_consent',
      ],
    })
  })

  it('requires the choice, the manager name and every consent shown', () => {
    const empty = { ...values, managed_by: null, consent_terms: false, consent_age: false }
    expect(issuesOf(validateAccountFor(empty, onboarding))).toEqual({
      managed_by: key('managed_by.required'),
      consent_terms: key('consents.required'),
      consent_age: key('consent_age.required'),
    })
    expect(
      issuesOf(
        validateAccountFor({ ...values, manager_name: ' ', consent_candidate: false }, onboarding),
      ),
    ).toEqual({
      manager_name: key('manager_name.required'),
      consent_candidate: key('consent_candidate.required'),
    })
    expect(issuesOf(validateAccountFor({ ...values, manager_name: 'R' }, onboarding))).toEqual({
      manager_name: key('manager_name.too_short'),
    })
  })

  it('sends a null manager name and no candidate consent for myself', () => {
    const self = { ...values, managed_by: 'self' as const, consent_candidate: false }
    expect(validateAccountFor(self, onboarding)).toEqual([])
    expect(accountForToBody(self, onboarding)).toEqual({
      managed_by: 'self',
      manager_name: null,
      consents: ['terms', 'privacy', 'community_guidelines', 'age_declaration'],
    })
  })

  it('in edit mode asks only for candidate consent when moving away from self (08 2.1 rule 4)', () => {
    const edit = { mode: 'edit' as const, savedManagedBy: 'self' as const }
    const changed = {
      ...values,
      consent_terms: false,
      consent_age: false,
      consent_candidate: false,
    }
    expect(issuesOf(validateAccountFor(changed, edit))).toEqual({
      consent_candidate: key('consent_candidate.required'),
    })
    expect(accountForToBody({ ...changed, consent_candidate: true }, edit)).toEqual({
      managed_by: 'parent',
      manager_name: 'Rukhsana Khan',
      consents: ['candidate_consent'],
    })
    const unchanged = { mode: 'edit' as const, savedManagedBy: 'parent' as const }
    expect(validateAccountFor(changed, unchanged)).toEqual([])
    expect(accountForToBody(changed, unchanged)).not.toHaveProperty('consents')
  })

  it('starts with the consents ticked once the step was continued', () => {
    const profile = makeOwnProfile({ account_for: { managed_by: 'parent', manager_name: 'R K' } })
    expect(accountForFromProfile(profile, { consentsRecorded: true })).toMatchObject({
      consent_terms: true,
      consent_age: true,
      consent_candidate: true,
    })
    expect(accountForFromProfile(profile, { consentsRecorded: false }).consent_terms).toBe(false)
  })

  it('is a Zod schema reporting each issue on its field', () => {
    const result = accountForSchema(() => onboarding).safeParse({ ...values, managed_by: null })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]).toMatchObject({
      path: ['managed_by'],
      message: key('managed_by.required'),
    })
  })
})

describe('basics (07 section 4)', () => {
  const valid: BasicsValues = {
    first_name: 'Ayesha',
    last_name: 'Khan',
    gender: 'female',
    date_of_birth: birthDate(26),
    marital_status: 'never_married',
    children_status: null,
    children_count: null,
    current_wives_count: null,
    height_cm: 163,
  }
  const self = { subject: 'self' as const }

  it('accepts a complete section', () => {
    expect(validateBasics(valid, self)).toEqual([])
  })

  it('requires every field, with the catalogue messages', () => {
    const empty = {
      ...valid,
      first_name: null,
      last_name: '  ',
      gender: null,
      date_of_birth: null,
      marital_status: null,
      height_cm: null,
    }
    expect(issuesOf(validateBasics(empty, self))).toEqual({
      first_name: key('first_name.required'),
      last_name: key('last_name.required'),
      gender: key('gender.required'),
      date_of_birth: key('date_of_birth.required'),
      marital_status: key('marital_status.required'),
      height_cm: key('height_cm.required'),
    })
    expect(
      issuesOf(validateBasics({ ...valid, first_name: 'A', last_name: 'K'.repeat(41) }, self)),
    ).toEqual({
      first_name: key('first_name.too_short'),
      last_name: key('last_name.too_long'),
    })
  })

  it("applies the age rule on today's date: 18 to 80 (07 section 4.1)", () => {
    expect(dateOfBirthCode(birthDate(18))).toBeNull()
    expect(dateOfBirthCode(birthDate(18, 1))).toBe('too_young')
    expect(dateOfBirthCode(birthDate(80))).toBeNull()
    expect(dateOfBirthCode(birthDate(81))).toBe('out_of_range')
    expect(dateOfBirthCode('not-a-date')).toBe('invalid')
    const young = { ...valid, date_of_birth: birthDate(17) }
    expect(issuesOf(validateBasics(young, self)).date_of_birth).toBe(key('date_of_birth.too_young'))
    expect(issuesOf(validateBasics(young, { subject: 'female' })).date_of_birth).toBe(
      key('date_of_birth.too_young_other'),
    )
  })

  it('checks the height range of the picker (07 section 4.3)', () => {
    expect(feetInchesToCm(4, 0)).toBe(122)
    expect(feetInchesToCm(7, 0)).toBe(213)
    expect(validateBasics({ ...valid, height_cm: 122 }, self)).toEqual([])
    expect(validateBasics({ ...valid, height_cm: 213 }, self)).toEqual([])
    expect(issuesOf(validateBasics({ ...valid, height_cm: 121 }, self)).height_cm).toBe(
      key('height_cm.out_of_range'),
    )
    expect(issuesOf(validateBasics({ ...valid, height_cm: 214 }, self)).height_cm).toBe(
      key('height_cm.out_of_range'),
    )
  })

  it('asks for wives, children and their count only when they apply', () => {
    const married = { ...valid, gender: 'male' as const, marital_status: 'married' as const }
    expect(issuesOf(validateBasics(married, self))).toEqual({
      current_wives_count: key('current_wives_count.required'),
      children_status: key('children_status.required'),
    })
    expect(
      issuesOf(
        validateBasics(
          {
            ...married,
            current_wives_count: 4,
            children_status: 'living_with_me',
            children_count: 16,
          },
          self,
        ),
      ),
    ).toEqual({
      current_wives_count: key('current_wives_count.out_of_range'),
      children_count: key('children_count.out_of_range'),
    })
    expect(
      issuesOf(validateBasics({ ...valid, marital_status: 'married' }, self)).marital_status,
    ).toBe(key('marital_status.not_allowed'))
  })

  it('sends the dependent fields the way the API stores them (07 section 4.2)', () => {
    expect(
      basicsToBody({
        ...valid,
        first_name: '  Ayesha   Noor ',
        children_status: 'living_with_me',
        children_count: 2,
      }),
    ).toMatchObject({ first_name: 'Ayesha Noor', children_status: 'none', children_count: null })
    expect(
      basicsToBody({
        ...valid,
        marital_status: 'divorced',
        children_status: 'none',
        children_count: 3,
      }),
    ).toMatchObject({ children_status: 'none', children_count: null, current_wives_count: null })
  })
})

describe('community (07 section 5)', () => {
  const context = {
    sectCount: (religion: string | null) => (religion === 'islam' ? 11 : 0),
    hasSubCastes: (caste: string | null) => caste === 'rajput',
  }
  const valid: CommunityValues = {
    religion_code: 'islam',
    sect_code: 'sunni',
    caste_code: null,
    caste_other: null,
    sub_caste_code: null,
    sub_caste_other: null,
    mother_tongue_code: 'urdu',
    language_codes: [],
    caste_mode: 'list',
    sub_caste_mode: 'list',
  }

  it('requires religion, a sect when the religion has sects, and the mother tongue', () => {
    expect(validateCommunity(valid, context)).toEqual([])
    expect(
      issuesOf(validateCommunity({ ...valid, sect_code: null, mother_tongue_code: null }, context)),
    ).toEqual({
      sect_code: key('sect_code.required'),
      mother_tongue_code: key('mother_tongue_code.required'),
    })
    expect(
      validateCommunity({ ...valid, religion_code: 'hinduism', sect_code: null }, context),
    ).toEqual([])
  })

  it('checks typed castes and the six-language limit', () => {
    expect(
      issuesOf(validateCommunity({ ...valid, caste_mode: 'other', caste_other: 'K' }, context)),
    ).toEqual({ caste_other: key('caste_other.too_short') })
    const languages = ['punjabi', 'pashto', 'sindhi', 'saraiki', 'balochi', 'english', 'arabic']
    expect(issuesOf(validateCommunity({ ...valid, language_codes: languages }, context))).toEqual({
      language_codes: key('language_codes.too_long'),
    })
    expect(
      validateCommunity({ ...valid, language_codes: [...languages.slice(0, 6), 'urdu'] }, context),
    ).toEqual([])
  })

  it('maps the caste picker to the four API fields (07 section 5.2)', () => {
    expect(
      communityToBody(
        {
          ...valid,
          caste_code: 'rajput',
          sub_caste_code: '__none',
          language_codes: ['urdu', 'punjabi'],
        },
        context,
      ),
    ).toMatchObject({
      caste_code: 'rajput',
      caste_other: null,
      sub_caste_code: null,
      sub_caste_other: null,
      language_codes: ['punjabi'],
    })
    expect(
      communityToBody({ ...valid, caste_code: '__none', sub_caste_other: 'Bhatti' }, context),
    ).toMatchObject({ caste_code: null, sub_caste_code: null, sub_caste_other: null })
    expect(
      communityToBody(
        { ...valid, caste_mode: 'other', caste_other: ' Kalhoro ', sub_caste_other: 'Abro' },
        context,
      ),
    ).toMatchObject({ caste_code: null, caste_other: 'Kalhoro', sub_caste_other: 'Abro' })
    expect(
      communityToBody(
        { ...valid, caste_code: 'rajput', sub_caste_mode: 'other', sub_caste_other: 'Minhas' },
        context,
      ),
    ).toMatchObject({ caste_code: 'rajput', sub_caste_code: null, sub_caste_other: 'Minhas' })
    expect(communityToBody({ ...valid, religion_code: 'hinduism' }, context).sect_code).toBeNull()
  })
})

describe('location (07 section 6)', () => {
  const lahore = {
    id: 1001,
    name: 'Lahore',
    region_id: 6,
    region_name: 'Punjab',
    country_code: 'PK',
  }
  const context = { countryHasRegions: (country: string | null) => country === 'PK' }
  const valid: LocationValues = {
    place: { country_code: 'PK', region_id: 6, city_id: 1001, city_other: null, city: lahore },
    area: null,
    nationality_code: 'PK',
    residency_status: null,
    origin: { ...EMPTY_CITY_VALUE, country_code: 'PK' },
    relocation: null,
  }

  it('requires a country and a listed or typed city', () => {
    expect(validateLocation(valid, context)).toEqual([])
    const noCity = { ...valid, place: { ...EMPTY_CITY_VALUE, country_code: 'PK' } }
    expect(issuesOf(validateLocation(noCity, context))).toEqual({ place: key('city_id.required') })
    const shortCity = { ...valid, place: { ...noCity.place, city_other: 'X', region_id: 6 } }
    expect(issuesOf(validateLocation(shortCity, context))).toEqual({
      place: key('city_other.too_short'),
    })
    const noRegion = { ...valid, place: { ...noCity.place, city_other: 'Chak 45' } }
    expect(issuesOf(validateLocation(noRegion, context))).toEqual({
      place: key('region_id.required'),
    })
  })

  it('asks for the residency status only when living abroad', () => {
    const abroad = { ...valid, place: { ...valid.place, country_code: 'GB' } }
    expect(issuesOf(validateLocation(abroad, context))).toEqual({
      residency_status: key('residency_status.required'),
    })
    expect(locationToBody(valid)).toMatchObject({ residency_status: 'citizen', city_id: 1001 })
    expect(
      locationToBody({ ...abroad, residency_status: 'work_visa', area: ' DHA  Phase 5 ' }),
    ).toMatchObject({ residency_status: 'work_visa', area: 'DHA Phase 5' })
  })
})

describe('education_career (07 section 7)', () => {
  const valid = educationCareerFromProfile(makeOwnProfile())

  it('requires the level and the employment type', () => {
    expect(validateEducationCareer(valid)).toEqual([])
    expect(
      issuesOf(
        validateEducationCareer({ ...valid, education_level_code: null, employment_type: null }),
      ),
    ).toEqual({
      education_level_code: key('education_level_code.required'),
      employment_type: key('employment_type.required'),
    })
    expect(issuesOf(validateEducationCareer({ ...valid, employer_name: 'x'.repeat(121) }))).toEqual(
      {
        employer_name: key('employer_name.too_long'),
      },
    )
  })

  it('sends null career fields for students, homemakers and members not working', () => {
    const body = educationCareerToBody({
      ...valid,
      employment_type: 'student',
      profession_code: 'engineer',
      job_title: 'Intern',
      employer_name: 'Acme',
      income_band_code: 'pkr_2',
    })
    expect(body).toMatchObject({
      profession_code: null,
      job_title: null,
      employer_name: null,
      income_band_code: null,
    })
  })
})

describe('family (07 section 8)', () => {
  const profile = makeOwnProfile()
  const valid: FamilyValues = {
    ...familyFromProfile(profile),
    family_elsewhere: false,
    family_place: { ...EMPTY_CITY_VALUE, country_code: 'PK' },
    home_size_value: null,
  }

  it('accepts an empty section: every field is optional', () => {
    expect(validateFamily(valid)).toEqual([])
  })

  it('checks married counts, the home size and the text length', () => {
    expect(
      issuesOf(
        validateFamily({
          ...valid,
          brothers_count: 1,
          brothers_married: 2,
          home_size_value: '0',
          about_family: 'Too short.',
        }),
      ),
    ).toEqual({
      brothers_married: key('brothers_married.out_of_range'),
      home_size_value: key('home_size_value.out_of_range'),
      home_size_unit: key('home_size_unit.required'),
      about_family: key('about_family.too_short'),
    })
    expect(issuesOf(validateFamily({ ...valid, home_size_unit: 'marla' }))).toEqual({
      home_size_value: key('home_size_value.required'),
    })
    expect(validateFamily({ ...valid, home_size_value: '10.25', home_size_unit: 'marla' })).toEqual(
      [],
    )
    expect(
      issuesOf(validateFamily({ ...valid, home_size_value: '1.234', home_size_unit: 'marla' })),
    ).toEqual({ home_size_value: key('home_size_value.out_of_range') })
  })

  it('sends untouched steppers as null and the switch as both family place fields', () => {
    const body = familyToBody({
      ...valid,
      sisters_count: 0,
      sisters_married: 0,
      home_size_value: '10',
      home_size_unit: 'marla',
      family_place: { ...valid.family_place, country_code: 'AE', city_id: 2001 },
    })
    expect(body).toMatchObject({
      brothers_count: null,
      sisters_married: null,
      home_size_value: 10,
      family_country_code: null,
      family_city_id: null,
    })
    expect(body).not.toHaveProperty('family_elsewhere')
    expect(
      familyToBody({
        ...valid,
        family_elsewhere: true,
        family_place: { ...valid.family_place, city_id: 1001 },
      }),
    ).toMatchObject({ family_country_code: 'PK', family_city_id: 1001 })
  })
})

describe('lifestyle (07 section 9)', () => {
  const valid: LifestyleValues = lifestyleFromProfile(makeOwnProfile())

  it('checks weight, details, hobbies and the about text', () => {
    expect(validateLifestyle(valid)).toEqual([])
    expect(
      issuesOf(
        validateLifestyle({
          ...valid,
          weight_kg: 29,
          disability: 'other',
          disability_details: 'x'.repeat(301),
          hobby_codes: Array.from({ length: 11 }, (_, index) => `hobby_${index}`),
          about_me: 'Short text.',
        }),
      ),
    ).toEqual({
      weight_kg: key('weight_kg.out_of_range'),
      disability_details: key('disability_details.too_long'),
      hobby_codes: key('hobby_codes.too_long'),
      about_me: key('about_me.too_short'),
    })
    expect(issuesOf(validateLifestyle({ ...valid, about_me: 'x'.repeat(1501) }))).toEqual({
      about_me: key('about_me.too_long'),
    })
  })

  it('sends hidden fields as null (hijab for women, beard for men, Islam-only fields)', () => {
    const answers: LifestyleValues = {
      ...valid,
      hijab: 'hijab',
      beard: 'full',
      prayer_frequency: 'five_times',
      disability: 'none',
      disability_details: 'n/a',
    }
    expect(lifestyleToBody(answers, { gender: 'female', religionCode: 'islam' })).toMatchObject({
      hijab: 'hijab',
      beard: null,
      prayer_frequency: 'five_times',
      disability_details: null,
    })
    expect(
      lifestyleToBody(answers, { gender: 'male', religionCode: 'christianity' }),
    ).toMatchObject({
      hijab: null,
      beard: null,
      prayer_frequency: null,
    })
  })
})

describe('field to step mapping (07 section 14.3)', () => {
  it.each([
    ['consents', 'account_for'],
    ['date_of_birth', 'basics'],
    ['sub_caste_other', 'community'],
    ['city_other', 'location'],
    ['income_band_code', 'education_career'],
    ['photos', 'photos'],
    ['preferences', 'preferences'],
    ['number', 'identity'],
    ['document_type', 'identity'],
  ])('%s belongs to %s', (field, step) => {
    expect(stepForField(field)).toBe(step)
  })

  it('returns null for an unknown field', () => {
    expect(stepForField('something_else')).toBeNull()
  })
})

describe('income currency (07 section 7.2, 05 section 10.3)', () => {
  it.each([
    ['PK', 'PKR'],
    ['GB', 'GBP'],
    ['AE', 'AED'],
    ['QA', 'AED'],
    ['DE', 'EUR'],
    ['MY', 'USD'],
    [null, 'USD'],
  ])('%s shows %s first', (country, currency) => {
    expect(currencyForCountry(country)).toBe(currency)
  })

  it("opens in the saved band's currency", () => {
    const bands = [
      { code: 'pkr_1', currency_code: 'PKR', label: 'Below 50,000', label_ur: null, rank: 1 },
      { code: 'gbp_1', currency_code: 'GBP', label: 'Below 1,200', label_ur: null, rank: 1 },
      { code: 'usd_1', currency_code: 'USD', label: 'Below 1,500', label_ur: null, rank: 1 },
    ]
    expect(initialIncomeCurrency(bands, 'PK', 'gbp_1')).toBe('GBP')
    expect(initialIncomeCurrency(bands, 'PK', null)).toBe('PKR')
    expect(initialIncomeCurrency(bands, 'CA', null)).toBe('USD')
  })
})

describe('wording pattern (07 section 3.2)', () => {
  it('chooses the subject from who manages the profile and the gender', () => {
    expect(subjectOf('self', 'male')).toBe('self')
    expect(subjectOf('parent', 'male')).toBe('male')
    expect(subjectOf('sibling', 'female')).toBe('female')
    expect(subjectOf('friend', null)).toBe('unknown')
    expect(wordingContext('self')).toBeUndefined()
    expect(wordingContext('female')).toBe('female')
  })
})

describe('"Help me write" (07 section 9.3)', () => {
  const t = (key: string, values: Record<string, unknown> = {}) => i18n.t(key, values)
  const base = {
    subject: 'self' as const,
    firstName: 'Ayesha',
    age: 26,
    job: null,
    city: 'Lahore',
    educationLevel: "Bachelor's",
    educationField: null,
    religiosity: null,
    familyType: null,
    hobbies: [],
  }

  it('joins the sentences that apply, in order', () => {
    const draft = buildAboutMeDraft(
      {
        ...base,
        job: 'Software Engineer',
        educationField: 'Computer science',
        religiosity: 'practising',
        familyType: 'joint',
        hobbies: ['Reading'],
      },
      t,
    )
    expect(draft).toBe(
      "I am a 26-year-old software engineer living in Lahore. I have completed Bachelor's in Computer science. I practise my faith and try to live by it. I come from a close joint family. In my free time I enjoy reading. I am looking for a life partner who shares my values and wants to build a respectful and caring home.",
    )
  })

  it('leaves out faith for not practising and uses third-person forms for a managed profile', () => {
    const draft = buildAboutMeDraft(
      { ...base, subject: 'female', religiosity: 'not_practising', familyType: 'nuclear' },
      t,
    )
    expect(draft).toBe(
      "Ayesha is 26 years old and lives in Lahore. She has completed Bachelor's. She comes from a close-knit family. We are looking for a life partner for her who shares our family's values and wants to build a respectful and caring home.",
    )
  })

  it('lists the first three hobbies in lower case', () => {
    expect(hobbyList(['Cricket'], t)).toBe('cricket')
    expect(hobbyList(['Cricket', 'Reading'], t)).toBe('cricket and reading')
    expect(hobbyList(['Cricket', 'Reading', 'Cooking', 'Travel'], t)).toBe(
      'cricket, reading and cooking',
    )
    expect(hobbyList([], t)).toBeNull()
  })
})
