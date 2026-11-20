import type { TOptions } from 'i18next'
import type { Gender, ReferenceBootstrap } from '~/lib/api-types'
import { formatHeight } from '~/lib/format'
import { i18n } from '~/lib/i18n'
import { incomeRankLabel } from '../discovery/search/filter-options'

/** The 18 dimension keys of 10 section 4, in the fixed order of 10 section 11.1. */
export const DIMENSIONS = [
  'age',
  'height',
  'marital_status',
  'children',
  'religion',
  'sect',
  'caste',
  'mother_tongue',
  'location',
  'education',
  'profession',
  'income',
  'religiosity',
  'appearance',
  'family',
  'living_arrangement',
  'work_after_marriage',
  'smoking',
] as const

const KNOWN: ReadonlySet<string> = new Set(DIMENSIONS)

/** The label of a dimension (16 section 6.7); an unknown key shows with spaces. */
export function dimensionLabel(dimension: string): string {
  return KNOWN.has(dimension)
    ? i18n.t(`discovery:dimension.${dimension}`)
    : dimension.replaceAll('_', ' ')
}

/** Lists whose labels a dimension's codes use. */
const CODE_LISTS: Partial<Record<string, string>> = {
  marital_status: 'marital_status',
  children: 'children_acceptance',
  religion: 'religions',
  sect: 'sects',
  caste: 'castes',
  mother_tongue: 'languages',
  religiosity: 'religiosity',
  living_arrangement: 'living_arrangement',
  work_after_marriage: 'work_after_marriage',
  smoking: 'smoking',
}

/** Lists of the prefixed entries of `location`, `profession` and `family` (10 section 11.1). */
const PREFIXED: Partial<Record<string, Record<string, string | null>>> = {
  location: { country: 'countries', region: null, city: null },
  profession: { employment: 'employment_type', profession: 'profession_categories' },
  family: { values: 'family_values', type: 'family_type' },
}

export type LabelFn = (list: string, code: string | null | undefined) => string

/**
 * The values of a looking-for line as text (16 section 6.7, 10 section 11.1): labels joined with
 * commas, an age pair as "25 to 32 years", a height pair in the 07 section 4.3 format with an
 * open bound as "At least" or "Up to", and a single rank as "At least {label}".
 */
export function formatLookingForValues(
  dimension: string,
  values: readonly string[],
  context: { label: LabelFn; reference: ReferenceBootstrap; viewerGender: Gender | null },
): string {
  const { label, reference, viewerGender } = context
  const t = (key: string, options: TOptions = {}): string =>
    i18n.t(`profile:looking_for.${key}`, options)

  switch (dimension) {
    case 'age': {
      const [min, max] = values
      return t('age', { min, max })
    }
    case 'height': {
      const [rawMin = '', rawMax = ''] = values
      const min = rawMin ? formatHeight(Number(rawMin)) : null
      const max = rawMax ? formatHeight(Number(rawMax)) : null
      if (min && max) return t('range', { min, max })
      if (min) return t('at_least', { value: min })
      if (max) return t('up_to', { value: max })
      return ''
    }
    case 'education': {
      const [code] = values
      return t('at_least', { value: label('education_levels', code) })
    }
    case 'income': {
      const rank = Number(values[0])
      return incomeRankLabel(reference, rank) ?? t('at_least', { value: values[0] ?? '' })
    }
    case 'appearance': {
      // The owner's wish about the viewer: `hijab_types` for a female viewer, `beard_types` for
      // a male viewer (10 section 11.1).
      const list = viewerGender === 'female' ? 'hijab' : 'beard'
      return values.map((code) => label(list, code)).join(', ')
    }
    default:
      break
  }

  const prefixed = PREFIXED[dimension]
  if (prefixed) {
    return values
      .map((entry) => {
        const index = entry.indexOf(':')
        if (index < 0) return entry
        const prefix = entry.slice(0, index)
        const value = entry.slice(index + 1)
        const list = prefixed[prefix]
        return list ? label(list, value) : value
      })
      .join(', ')
  }

  const list = CODE_LISTS[dimension]
  return list ? values.map((code) => label(list, code)).join(', ') : values.join(', ')
}
