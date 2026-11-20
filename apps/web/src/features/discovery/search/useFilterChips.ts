import { useTranslation } from 'react-i18next'
import type { SearchFilters } from '~/lib/api-types'
import { useLabelOf, useReference } from '~/lib/reference'
import { activeFilterControls } from '../search-params'
import { knownCityName } from './FilterControls'
import { educationRankOptions, heightOptions, incomeRankOptions } from './filter-options'

export type FilterChip = { keys: (keyof SearchFilters)[]; label: string }

/** The label key of `search.fields` for each control, by its first filter key. */
const FIELD_LABEL: Partial<Record<keyof SearchFilters, string>> = {
  age_min: 'age',
  age_max: 'age',
  height_min_cm: 'height',
  height_max_cm: 'height',
  marital_statuses: 'marital_status',
  children_acceptance: 'children',
  religion_codes: 'religion',
  sect_codes: 'sect',
  caste_codes: 'caste',
  mother_tongue_codes: 'mother_tongue',
  country_codes: 'country',
  region_ids: 'region',
  city_ids: 'city',
  education_min_rank: 'education',
  employment_types: 'employment',
  profession_codes: 'profession',
  income_min_rank: 'income',
  religiosity_levels: 'religiosity',
  hijab_types: 'hijab',
  beard_types: 'beard',
  family_values: 'family_values',
  family_types: 'family_type',
  living_arrangements: 'living',
  work_after_marriage_options: 'work',
  smoking_options: 'smoking',
  managed_by: 'managed_by',
  has_photo: 'has_photo',
  verified_only: 'verified_only',
  active_within_days: 'active',
  joined_within_days: 'joined',
}

/** The list each code-array filter takes its labels from. */
const CODE_LIST: Partial<Record<keyof SearchFilters, string>> = {
  marital_statuses: 'marital_status',
  religion_codes: 'religions',
  sect_codes: 'sects',
  caste_codes: 'castes',
  mother_tongue_codes: 'languages',
  country_codes: 'countries',
  employment_types: 'employment_type',
  profession_codes: 'profession_categories',
  religiosity_levels: 'religiosity',
  hijab_types: 'hijab',
  beard_types: 'beard',
  family_values: 'family_values',
  family_types: 'family_type',
  living_arrangements: 'living_arrangement',
  work_after_marriage_options: 'work_after_marriage',
  smoking_options: 'smoking',
  managed_by: 'managed_by',
}

/**
 * One chip per active filter for the results summary (16 section 6.6): the control's label and a
 * short value ("Age: 25 to 32", "Religion: Islam"). The chip's close control removes `keys`.
 */
export function useFilterChips(filters: SearchFilters): FilterChip[] {
  const { t } = useTranslation('discovery')
  const label = useLabelOf()
  const reference = useReference()

  const range = (
    min: number | undefined,
    max: number | undefined,
    format: (n: number) => string,
  ) => {
    if (min !== undefined && max !== undefined) return `${format(min)} - ${format(max)}`
    if (min !== undefined) return `${t('search.from')} ${format(min)}`
    return `${t('search.to')} ${format(max ?? 0)}`
  }
  const heightLabel = (cm: number) =>
    heightOptions().find((option) => option.value === cm)?.label ?? `${cm} cm`

  return activeFilterControls(filters).map((keys) => {
    const key = keys[0] as keyof SearchFilters
    const name = t(`search.fields.${FIELD_LABEL[key] ?? key}`)
    let value = ''
    switch (key) {
      case 'age_min':
        value = range(filters.age_min, filters.age_max, String)
        break
      case 'height_min_cm':
        value = range(filters.height_min_cm, filters.height_max_cm, heightLabel)
        break
      case 'children_acceptance':
        value = label('children_acceptance', filters.children_acceptance)
        break
      case 'region_ids':
        return { keys, label: name }
      case 'city_ids':
        value = (filters.city_ids ?? [])
          .map((id) => knownCityName(id) ?? t('search.city_unknown'))
          .join(', ')
        break
      case 'education_min_rank':
        value =
          educationRankOptions(reference).find((o) => o.value === filters.education_min_rank)
            ?.label ?? ''
        break
      case 'income_min_rank':
        value =
          incomeRankOptions(reference).find((o) => o.value === filters.income_min_rank)?.label ?? ''
        break
      case 'has_photo':
      case 'verified_only':
        return { keys, label: name }
      case 'active_within_days':
        value = t(`search.active_option.${filters.active_within_days}`)
        break
      case 'joined_within_days':
        value = t(`search.joined_option.${filters.joined_within_days}`)
        break
      default: {
        const list = CODE_LIST[key]
        const codes = filters[key]
        if (list && Array.isArray(codes)) {
          value = (codes as string[]).map((code) => label(list, code)).join(', ')
        }
      }
    }
    return { keys, label: value ? `${name}: ${value}` : name }
  })
}
