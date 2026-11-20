import { describe, expect, it } from 'vitest'
import { labelOf } from '~/lib/reference'
import { referenceBootstrap } from '~/mocks/fixtures/reference'
import { dimensionLabel, formatLookingForValues } from './looking-for'

const context = (viewerGender: 'male' | 'female' = 'female') => ({
  label: (list: string, code: string | null | undefined) => labelOf(referenceBootstrap, list, code),
  reference: referenceBootstrap,
  viewerGender,
})

describe('looking-for values (16 section 6.7, 10 section 11.1)', () => {
  it('shows an age pair as "25 to 32 years"', () => {
    expect(formatLookingForValues('age', ['25', '32'], context())).toBe('25 to 32 years')
  })

  it('shows a height pair in the 07 section 4.3 format, with open bounds', () => {
    expect(formatLookingForValues('height', ['157', '173'], context())).toBe(
      '5 ft 2 in (157 cm) to 5 ft 8 in (173 cm)',
    )
    expect(formatLookingForValues('height', ['160', ''], context())).toBe(
      'At least 5 ft 3 in (160 cm)',
    )
    expect(formatLookingForValues('height', ['', '180'], context())).toBe(
      'Up to 5 ft 11 in (180 cm)',
    )
  })

  it('labels codes and joins them with commas', () => {
    expect(formatLookingForValues('marital_status', ['never_married', 'divorced'], context())).toBe(
      'Never married, Divorced',
    )
    expect(formatLookingForValues('religion', ['islam'], context())).toBe('Islam')
    expect(formatLookingForValues('sect', ['sunni', 'shia'], context())).toBe('Sunni, Shia')
    expect(formatLookingForValues('mother_tongue', ['urdu', 'punjabi'], context())).toBe(
      'Urdu, Punjabi',
    )
  })

  it('shows a single rank as "At least {label}"', () => {
    expect(formatLookingForValues('education', ['masters'], context())).toBe(
      "At least Master's (MA, MSc, MBA)",
    )
    expect(formatLookingForValues('income', ['3'], context())).toBe(
      'At least 100,000 PKR a month or the equivalent abroad',
    )
  })

  it('resolves the prefixed entries of location, profession and family', () => {
    expect(
      formatLookingForValues('location', ['country:PK', 'region:Punjab', 'city:Lahore'], context()),
    ).toBe('Pakistan, Punjab, Lahore')
    expect(
      formatLookingForValues(
        'profession',
        ['employment:government_job', 'profession:doctor'],
        context(),
      ),
    ).toBe(
      `${labelOf(referenceBootstrap, 'employment_type', 'government_job')}, ${labelOf(referenceBootstrap, 'profession_categories', 'doctor')}`,
    )
    expect(formatLookingForValues('family', ['values:religious', 'type:joint'], context())).toBe(
      `${labelOf(referenceBootstrap, 'family_values', 'religious')}, ${labelOf(referenceBootstrap, 'family_type', 'joint')}`,
    )
  })

  it('reads appearance as hijab for a female viewer and beard for a male viewer', () => {
    expect(formatLookingForValues('appearance', ['hijab'], context('female'))).toBe(
      labelOf(referenceBootstrap, 'hijab', 'hijab'),
    )
    const beard = referenceBootstrap.options.beard?.[0]?.code ?? 'full_beard'
    expect(formatLookingForValues('appearance', [beard], context('male'))).toBe(
      labelOf(referenceBootstrap, 'beard', beard),
    )
  })

  it('labels the 18 dimensions and keeps an unknown one readable', () => {
    expect(dimensionLabel('appearance')).toBe('Hijab or beard')
    expect(dimensionLabel('living_arrangement')).toBe('Living after marriage')
    expect(dimensionLabel('star_sign')).toBe('star sign')
  })
})
