import { describe, expect, it } from 'vitest'
import { fixTargetForStep, stepForField } from './field-sections'

describe('stepForField (07 section 14.3)', () => {
  it.each([
    ['managed_by', 'account_for'],
    ['manager_name', 'account_for'],
    ['consents', 'account_for'],
    ['first_name', 'basics'],
    ['date_of_birth', 'basics'],
    ['height_cm', 'basics'],
    ['children_count', 'basics'],
    ['religion_code', 'community'],
    ['language_codes', 'community'],
    ['city_id', 'location'],
    ['origin_other', 'location'],
    ['education_level_code', 'education_career'],
    ['income_band_code', 'education_career'],
    ['photos', 'photos'],
    ['number', 'identity'],
    ['document_type', 'identity'],
  ])('%s belongs to %s', (field, step) => {
    expect(stepForField(field)).toBe(step)
  })

  it('matches a nested key or a list item of a listed field', () => {
    expect(stepForField('language_codes[0]')).toBe('community')
    expect(stepForField('photos.0.status')).toBe('photos')
  })

  it('does not match a field that only starts with the same letters', () => {
    expect(stepForField('area_visibility')).toBeNull()
    expect(stepForField('first_name_extra')).toBeNull()
  })

  it('returns null for a field the table does not list', () => {
    expect(stepForField('age_min')).toBeNull()
    expect(stepForField('')).toBeNull()
  })
})

describe('fixTargetForStep', () => {
  it('opens the edit screen of a section, with the step as a URL slug', () => {
    expect(fixTargetForStep('education_career')).toEqual({
      to: '/me/edit/$section',
      params: { section: 'education-career' },
    })
    expect(fixTargetForStep('basics')).toEqual({
      to: '/me/edit/$section',
      params: { section: 'basics' },
    })
  })

  it('opens the photos and identity screens for their steps', () => {
    expect(fixTargetForStep('photos')).toEqual({ to: '/me/photos' })
    expect(fixTargetForStep('identity')).toEqual({ to: '/me/verification/identity' })
  })

  it('has no target for an unknown step', () => {
    expect(fixTargetForStep('preferences')).toBeNull()
  })
})
