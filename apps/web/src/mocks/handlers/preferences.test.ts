import { describe, expect, it } from 'vitest'
import { http } from '~/lib/api'
import type { OwnProfile } from '~/lib/api-types'
import { db, resetDb } from '../db'
import { makeOwnProfile, makePreferences } from '../factories'
import { preferenceDefaults } from './preferences'

const NOW = new Date('2026-11-20T08:00:00Z')

function candidate(
  gender: 'male' | 'female',
  age: number,
  marital: OwnProfile['basics']['marital_status'],
  religion: string,
  country: string,
) {
  const profile = makeOwnProfile()
  return makeOwnProfile({
    basics: {
      ...profile.basics,
      gender,
      date_of_birth: `${2026 - age}-01-15`,
      marital_status: marital,
    },
    community: { ...profile.community, religion_code: religion },
    location: { ...profile.location, country_code: country },
  })
}

describe('preference defaults (07 section 12 worked examples)', () => {
  it.each([
    ['male', 29, 'never_married', 'islam', 'PK', 21, 30, ['never_married']],
    ['female', 26, 'never_married', 'islam', 'GB', 25, 34, ['never_married']],
    [
      'male',
      41,
      'divorced',
      'islam',
      'PK',
      33,
      42,
      ['never_married', 'divorced', 'widowed', 'nikah_ended_before_rukhsati'],
    ],
    ['female', 18, 'never_married', 'christianity', 'PK', 18, 26, ['never_married']],
  ] as const)(
    '%s, %i, %s, %s, in %s',
    (gender, age, marital, religion, country, ageMin, ageMax, statuses) => {
      const defaults = preferenceDefaults(candidate(gender, age, marital, religion, country), NOW)
      expect(defaults).toMatchObject({
        age_min: ageMin,
        age_max: ageMax,
        marital_statuses: statuses,
        religion_codes: [religion],
        country_codes: [country],
        religion_importance: 'must',
        smoking_importance: 'low',
        notes: null,
      })
    },
  )

  it('falls back when the profile is incomplete', () => {
    const profile = makeOwnProfile()
    const empty = makeOwnProfile({
      basics: { ...profile.basics, gender: null, date_of_birth: null, marital_status: null },
      community: { ...profile.community, religion_code: null },
      location: { ...profile.location, country_code: null },
    })
    expect(preferenceDefaults(empty, NOW)).toMatchObject({
      age_min: 18,
      age_max: 80,
      marital_statuses: ['never_married'],
      religion_codes: [],
      country_codes: [],
    })
  })
})

describe('GET and PUT /v1/me/preferences', () => {
  it('answers the defaults while no row exists, then the stored row', async () => {
    resetDb('onboarding_midway')
    const defaults = await http.get('/v1/me/preferences')
    expect(defaults.religion_codes).toEqual(['islam'])
    expect(db.preferences).toBeNull()
    const saved = await http.put('/v1/me/preferences', { ...defaults, age_min: 24 })
    expect(saved.age_min).toBe(24)
    expect(db.preferences?.age_min).toBe(24)
  })

  it('rejects invalid values with the field codes of 07 section 11.4', async () => {
    const body = makePreferences({ age_min: 40, age_max: 30, marital_statuses: ['married'] })
    await expect(http.put('/v1/me/preferences', body)).rejects.toMatchObject({
      code: 'validation_failed',
      fields: expect.arrayContaining([
        expect.objectContaining({ field: 'age_min', code: 'invalid' }),
      ]),
    })
    // The active scenario's candidate is female: `married` is allowed for her.
    await expect(
      http.put('/v1/me/preferences', makePreferences({ marital_statuses: ['married'] })),
    ).resolves.toMatchObject({ marital_statuses: ['married'] })
  })

  it('stores the appearance array that does not apply as empty and marks new notes pending', async () => {
    const saved = await http.put(
      '/v1/me/preferences',
      makePreferences({
        hijab_types: ['hijab'],
        beard_types: ['full'],
        notes: 'Looking for someone kind, educated and close to family.',
      }),
    )
    expect(saved.hijab_types).toEqual([])
    expect(saved.beard_types).toEqual(['full'])
    expect(db.ownProfile.text_status.partner_notes).toBe('pending')
  })
})
