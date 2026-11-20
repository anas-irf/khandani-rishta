import { describe, expect, it } from 'vitest'
import { makePreferences } from '~/mocks/factories'
import {
  activeFilterControls,
  cleanFilters,
  countActiveFilters,
  decodeSearchQuery,
  encodeSearchQuery,
  filtersFromPreferences,
  isProfileCode,
  normalizeProfileCode,
  searchBody,
  searchFiltersSchema,
  withoutFilter,
} from './search-params'

describe('the q search parameter (17 section 3.3)', () => {
  it('round-trips filters and sort through URL-safe base64 JSON', () => {
    const state = {
      filters: {
        age_min: 25,
        age_max: 32,
        religion_codes: ['islam'],
        sect_codes: ['sunni', 'sunni_barelvi'],
        city_ids: [1001, 1002],
        education_min_rank: 5,
        has_photo: true,
        joined_within_days: 7,
      },
      sort: 'newest' as const,
    }
    const q = encodeSearchQuery(state)
    expect(q).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeSearchQuery(q)).toEqual(state)
  })

  it('stays URL-safe for values whose base64 holds + and /', () => {
    const state = { filters: { public_code: '??>>~~ اردو' }, sort: 'best_match' as const }
    const q = encodeSearchQuery(state)
    expect(q).not.toMatch(/[+/=]/)
    expect(decodeSearchQuery(q)).toEqual(state)
  })

  it('drops keys that send nothing before encoding', () => {
    const q = encodeSearchQuery({
      filters: { religion_codes: [], has_photo: false, children_acceptance: 'any', age_min: 20 },
      sort: 'best_match',
    })
    expect(decodeSearchQuery(q)).toEqual({ filters: { age_min: 20 }, sort: 'best_match' })
  })

  it('answers null for anything that is not a valid search', () => {
    expect(decodeSearchQuery(undefined)).toBeNull()
    expect(decodeSearchQuery('')).toBeNull()
    expect(decodeSearchQuery('%%%not-base64')).toBeNull()
    expect(decodeSearchQuery(btoa('not json'))).toBeNull()
    const bad = btoa(JSON.stringify({ filters: { age_min: 12 }, sort: 'newest' }))
    expect(decodeSearchQuery(bad)).toBeNull()
  })

  it('falls back to best_match for an unknown sort', () => {
    const q = btoa(JSON.stringify({ filters: { age_min: 30 }, sort: 'random' }))
    expect(decodeSearchQuery(q)).toEqual({ filters: { age_min: 30 }, sort: 'best_match' })
  })
})

describe('SearchFilters schema', () => {
  it('accepts the example of 15 section 4.8 and refuses invalid ranges', () => {
    expect(
      searchFiltersSchema.safeParse({
        age_min: 25,
        age_max: 32,
        height_min_cm: 152,
        active_within_days: 7,
        joined_within_days: 30,
      }).success,
    ).toBe(true)
    expect(searchFiltersSchema.safeParse({ age_min: 40, age_max: 30 }).success).toBe(false)
    expect(searchFiltersSchema.safeParse({ height_min_cm: 100 }).success).toBe(false)
    expect(searchFiltersSchema.safeParse({ active_within_days: 3 }).success).toBe(false)
    expect(searchFiltersSchema.safeParse({ joined_within_days: 1 }).success).toBe(false)
  })
})

describe('filters to the search body (16 section 6.6)', () => {
  it('sends only set keys with the sort and limit 20, plus the cursor of a further page', () => {
    expect(
      searchBody({
        filters: { age_min: 24, marital_statuses: [], verified_only: false, has_photo: true },
        sort: 'recently_active',
      }),
    ).toEqual({ filters: { age_min: 24, has_photo: true }, sort: 'recently_active', limit: 20 })
    expect(searchBody({ filters: {}, sort: 'best_match' }, '20')).toEqual({
      filters: {},
      sort: 'best_match',
      limit: 20,
      cursor: '20',
    })
  })

  it('cleans null, empty and "Any" values', () => {
    expect(
      cleanFilters({
        age_min: undefined,
        religion_codes: [],
        children_acceptance: 'any',
        has_photo: false,
        city_ids: [1001],
      }),
    ).toEqual({ city_ids: [1001] })
  })

  it('counts one active filter per control and removes a control', () => {
    const filters = { age_min: 25, age_max: 30, religion_codes: ['islam'], has_photo: true }
    expect(countActiveFilters(filters)).toBe(3)
    expect(activeFilterControls(filters)[0]).toEqual(['age_min', 'age_max'])
    expect(withoutFilter(filters, ['age_min', 'age_max'])).toEqual({
      religion_codes: ['islam'],
      has_photo: true,
    })
  })
})

describe('"Use my preferences" (16 section 6.6)', () => {
  it('copies the keys of Preferences and ignores importance and notes', () => {
    const preferences = makePreferences({
      age_min: 24,
      age_max: 30,
      height_min_cm: 160,
      religion_codes: ['islam'],
      sect_codes: ['sunni'],
      city_ids: [1001],
      education_min_rank: 5,
      hijab_types: ['hijab'],
      beard_types: ['full'],
      children_acceptance: 'none',
      notes: 'Someone kind',
    })
    const filters = filtersFromPreferences(preferences, 'female')
    expect(filters).toEqual({
      age_min: 24,
      age_max: 30,
      height_min_cm: 160,
      marital_statuses: ['never_married'],
      children_acceptance: 'none',
      religion_codes: ['islam'],
      sect_codes: ['sunni'],
      country_codes: ['PK'],
      city_ids: [1001],
      education_min_rank: 5,
      beard_types: ['full'],
    })
    expect(filters).not.toHaveProperty('notes')
    expect(filters).not.toHaveProperty('religion_importance')
  })

  it('offers hijab to a male viewer and leaves the full age range untouched', () => {
    const filters = filtersFromPreferences(
      makePreferences({ age_min: 18, age_max: 80, hijab_types: ['niqab'], beard_types: ['none'] }),
      'male',
    )
    expect(filters.hijab_types).toEqual(['niqab'])
    expect(filters).not.toHaveProperty('beard_types')
    expect(filters).not.toHaveProperty('age_min')
    expect(filters).not.toHaveProperty('age_max')
  })
})

describe('profile code (16 section 6.6)', () => {
  it('trims and capitalises the input', () => {
    expect(normalizeProfileCode('  kr7f3k2qx9 ')).toBe('KR7F3K2QX9')
    expect(normalizeProfileCode('kr7f 3k2q x9')).toBe('KR7F3K2QX9')
  })

  it('accepts KR followed by 8 characters of Crockford base32 only', () => {
    expect(isProfileCode('KR7F3K2QX9')).toBe(true)
    expect(isProfileCode(' kr7f3k2qx9')).toBe(true)
    expect(isProfileCode('KR7F3K2QX')).toBe(false)
    expect(isProfileCode('KR7F3K2QX9A')).toBe(false)
    expect(isProfileCode('AB7F3K2QX9')).toBe(false)
    expect(isProfileCode('KR7F3K2QXI')).toBe(false)
    expect(isProfileCode('KR7F3K2QXO')).toBe(false)
  })
})
