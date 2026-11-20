import { describe, expect, it } from 'vitest'
import { makePreferences } from '~/mocks/factories'
import {
  hasPreference,
  mustHaveCount,
  type PreferencesValues,
  preferencesSchema,
  preferencesToBody,
  preferencesToValues,
  validatePreferences,
} from './schemas'

const key = (path: string) => `preferences:errors.${path}`
const issuesOf = (list: { path: string; message: string }[]) =>
  Object.fromEntries(list.map((issue) => [issue.path, issue.message]))
const sectsOf = (religion: string) => (religion === 'islam' ? ['sunni', 'shia'] : [])

function values(overrides: Partial<PreferencesValues> = {}): PreferencesValues {
  return { ...preferencesToValues(makePreferences()), ...overrides }
}

describe('preferences rules (07 sections 11.4 and 16.8)', () => {
  it('accepts the defaults', () => {
    expect(validatePreferences(values())).toEqual([])
    expect(preferencesSchema.safeParse(values()).success).toBe(true)
  })

  it('checks the age and height ranges', () => {
    expect(issuesOf(validatePreferences(values({ age: { min: 17, max: 30 } })))).toEqual({
      age: key('age_min.out_of_range'),
    })
    expect(issuesOf(validatePreferences(values({ age: { min: 35, max: 30 } })))).toEqual({
      age: key('age_min.invalid'),
    })
    expect(issuesOf(validatePreferences(values({ height: { min: 180, max: 160 } })))).toEqual({
      height: key('height_min_cm.invalid'),
    })
    expect(validatePreferences(values({ height: { min: 160, max: null } }))).toEqual([])
  })

  it('limits the arrays and the notes length', () => {
    const many = (count: number) => Array.from({ length: count }, (_, index) => `code_${index}`)
    expect(
      issuesOf(
        validatePreferences(
          values({ caste_codes: many(31), country_codes: many(21), notes: 'Too short' }),
        ),
      ),
    ).toEqual({
      caste_codes: key('caste_codes.too_long'),
      country_codes: key('country_codes.too_long'),
      notes: key('notes.too_short'),
    })
    expect(issuesOf(validatePreferences(values({ notes: 'x'.repeat(1001) })))).toEqual({
      notes: key('notes.too_long'),
    })
  })
})

describe('importance rows (07 section 11.3)', () => {
  it('treats empty selections, "Any", null bounds and the full age range as no preference', () => {
    const none = values({
      age: { min: 18, max: 80 },
      marital_statuses: [],
      religion_codes: [],
      country_codes: [],
      children_acceptance: 'any',
    })
    expect(hasPreference('age', none, 'female')).toBe(false)
    expect(hasPreference('marital_status', none, 'female')).toBe(false)
    expect(hasPreference('location', none, 'female')).toBe(false)
    expect(hasPreference('height', none, 'female')).toBe(false)
    expect(hasPreference('children', none, 'female')).toBe(false)
    expect(hasPreference('age', values(), 'female')).toBe(true)
    expect(hasPreference('location', values({ country_codes: [], city_ids: [1001] }), 'male')).toBe(
      true,
    )
  })

  it('uses hijab for a male candidate and beard for a female one', () => {
    const appearance = values({ hijab_types: ['hijab'], beard_types: [] })
    expect(hasPreference('appearance', appearance, 'male')).toBe(true)
    expect(hasPreference('appearance', appearance, 'female')).toBe(false)
  })

  it('counts must-haves among the rows that state a preference', () => {
    expect(mustHaveCount(values(), 'female')).toBe(1)
    expect(
      mustHaveCount(
        values({
          age_importance: 'must',
          marital_status_importance: 'must',
          location_importance: 'must',
          height_importance: 'must',
        }),
        'female',
      ),
    ).toBe(4)
  })
})

describe('preferencesToBody', () => {
  it('round-trips the stored object', () => {
    const stored = makePreferences({ region_ids: [6], education_min_rank: 5, income_min_rank: 3 })
    expect(
      preferencesToBody(preferencesToValues(stored), { candidateGender: 'female', sectsOf }),
    ).toEqual({ ...stored, sect_codes: [] })
  })

  it('sends the other appearance array empty and drops married for a male candidate', () => {
    const body = preferencesToBody(
      values({
        marital_statuses: ['never_married', 'married'],
        hijab_types: ['hijab'],
        beard_types: ['full'],
        religion_codes: ['islam'],
        sect_codes: ['sunni', 'catholic'],
      }),
      { candidateGender: 'male', sectsOf },
    )
    expect(body).toMatchObject({
      marital_statuses: ['never_married'],
      hijab_types: ['hijab'],
      beard_types: [],
      sect_codes: ['sunni'],
    })
    expect(
      preferencesToBody(values({ hijab_types: ['hijab'], beard_types: ['full'] }), {
        candidateGender: 'female',
        sectsOf,
      }),
    ).toMatchObject({ hijab_types: [], beard_types: ['full'] })
  })
})
