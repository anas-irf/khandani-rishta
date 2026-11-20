import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Gender, SearchFilters } from '~/lib/api-types'
import { useCastes, useOptions, useReference } from '~/lib/reference'
import { activeFilterControls } from '../search-params'
import {
  ChipsField,
  CityField,
  FilterGroup,
  RangeField,
  RegionsField,
  SearchMultiField,
  SelectField,
  SwitchField,
} from './FilterControls'
import {
  ageOptions,
  educationRankOptions,
  heightOptions,
  incomeRankOptions,
} from './filter-options'

/** Field errors of `validation_failed`, by filter key (without the `filters.` prefix). */
export type FilterErrors = Partial<Record<keyof SearchFilters, string>>

type GroupKey =
  | 'basics'
  | 'community'
  | 'location'
  | 'education_work'
  | 'faith'
  | 'family'
  | 'lifestyle'
  | 'profile'

/** Which filter keys each group holds, for the count in its heading (16 section 6.6). */
export const GROUP_KEYS: Record<GroupKey, readonly (keyof SearchFilters)[]> = {
  basics: [
    'age_min',
    'age_max',
    'height_min_cm',
    'height_max_cm',
    'marital_statuses',
    'children_acceptance',
  ],
  community: ['religion_codes', 'sect_codes', 'caste_codes', 'mother_tongue_codes'],
  location: ['country_codes', 'region_ids', 'city_ids'],
  education_work: ['education_min_rank', 'employment_types', 'profession_codes', 'income_min_rank'],
  faith: ['religiosity_levels', 'hijab_types', 'beard_types'],
  family: ['family_values', 'family_types'],
  lifestyle: ['living_arrangements', 'work_after_marriage_options', 'smoking_options'],
  profile: ['managed_by', 'has_photo', 'verified_only', 'active_within_days', 'joined_within_days'],
}

/** "Basics", "Community" and "Location" start expanded; the others start collapsed. */
const EXPANDED: ReadonlySet<GroupKey> = new Set(['basics', 'community', 'location'])

function groupCount(filters: SearchFilters, group: GroupKey): number {
  const keys = new Set(GROUP_KEYS[group])
  return activeFilterControls(filters).filter((control) => control.some((key) => keys.has(key)))
    .length
}

/**
 * The filter form of 16 section 6.6. Every control maps to one key of `SearchFilters`; an
 * untouched control sends nothing. Hijab is offered to a male viewer, beard to a female viewer,
 * and `married` in "Marital status" only to a female viewer.
 */
export function SearchFilterForm({
  filters,
  onChange,
  errors = {},
  viewerGender,
  viewerCountry,
}: {
  filters: SearchFilters
  onChange: (next: SearchFilters) => void
  errors?: FilterErrors
  viewerGender: Gender | null
  viewerCountry: string
}) {
  const { t, i18n } = useTranslation('discovery')
  const reference = useReference()
  const set = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) =>
    onChange({ ...filters, [key]: value })

  const maritalAll = useOptions('marital_status')
  const marital = useMemo(
    () => maritalAll.filter((option) => option.code !== 'married' || viewerGender === 'female'),
    [maritalAll, viewerGender],
  )
  const children = useOptions('children_acceptance').filter((option) => option.code !== 'any')
  const religions = useOptions('religions')
  const castes = useCastes()
  const casteOptions = useMemo(
    () =>
      castes.map((caste) => ({
        code: caste.code,
        label: i18n.language === 'ur' && caste.name_ur ? caste.name_ur : caste.name,
        aliases: caste.aliases,
      })),
    [castes, i18n.language],
  )
  const languages = useOptions('languages')
  const countries = useOptions('countries')
  const employment = useOptions('employment_type')
  const professions = useOptions('profession_categories')
  const religiosity = useOptions('religiosity')
  const hijab = useOptions('hijab')
  const beard = useOptions('beard')
  const familyValues = useOptions('family_values')
  const familyTypes = useOptions('family_type')
  const living = useOptions('living_arrangement')
  const work = useOptions('work_after_marriage')
  const smoking = useOptions('smoking')
  const managedBy = useOptions('managed_by')

  const sects = useMemo(() => {
    const chosen = new Set(filters.religion_codes ?? [])
    return reference.religions
      .filter((religion) => chosen.has(religion.code))
      .flatMap((religion) =>
        religion.sects.map((sect) => ({
          code: sect.code,
          label: i18n.language === 'ur' && sect.name_ur ? sect.name_ur : sect.name,
        })),
      )
  }, [reference, filters.religion_codes, i18n.language])

  const ages = useMemo(() => ageOptions(), [])
  const heights = useMemo(() => heightOptions(), [])
  const education = useMemo(() => educationRankOptions(reference), [reference])
  const income = useMemo(() => incomeRankOptions(reference), [reference])

  const group = (key: GroupKey) => ({
    title: t(`search.groups.${key}`),
    count: groupCount(filters, key),
    defaultOpen: EXPANDED.has(key),
  })

  return (
    <div className="flex flex-col">
      <FilterGroup {...group('basics')}>
        <RangeField
          label={t('search.fields.age')}
          options={ages}
          min={filters.age_min}
          max={filters.age_max}
          error={errors.age_min ?? errors.age_max}
          onChange={({ min, max }) => onChange({ ...filters, age_min: min, age_max: max })}
        />
        <RangeField
          label={t('search.fields.height')}
          options={heights}
          min={filters.height_min_cm}
          max={filters.height_max_cm}
          error={errors.height_min_cm ?? errors.height_max_cm}
          onChange={({ min, max }) =>
            onChange({ ...filters, height_min_cm: min, height_max_cm: max })
          }
        />
        <ChipsField
          label={t('search.fields.marital_status')}
          options={marital}
          value={filters.marital_statuses}
          error={errors.marital_statuses}
          onChange={(value) => set('marital_statuses', value)}
        />
        <SelectField
          label={t('search.fields.children')}
          anyLabel={t('search.any')}
          options={children.map((option) => ({ value: option.code, label: option.label }))}
          value={filters.children_acceptance}
          error={errors.children_acceptance}
          onChange={(value) =>
            set('children_acceptance', value as SearchFilters['children_acceptance'])
          }
        />
      </FilterGroup>

      <FilterGroup {...group('community')}>
        <ChipsField
          label={t('search.fields.religion')}
          options={religions}
          value={filters.religion_codes}
          error={errors.religion_codes}
          onChange={(value) => {
            // Sects of religions that are no longer chosen are dropped with them.
            const allowed = new Set(
              reference.religions
                .filter((religion) => value.includes(religion.code))
                .flatMap((religion) => religion.sects.map((sect) => sect.code)),
            )
            onChange({
              ...filters,
              religion_codes: value,
              sect_codes: filters.sect_codes?.filter((code) => allowed.has(code)),
            })
          }}
        />
        {sects.length > 0 ? (
          <ChipsField
            label={t('search.fields.sect')}
            options={sects}
            value={filters.sect_codes}
            error={errors.sect_codes}
            onChange={(value) => set('sect_codes', value)}
          />
        ) : null}
        <SearchMultiField
          label={t('search.fields.caste')}
          options={casteOptions}
          value={filters.caste_codes}
          error={errors.caste_codes}
          onChange={(value) => set('caste_codes', value)}
        />
        <SearchMultiField
          label={t('search.fields.mother_tongue')}
          options={languages}
          value={filters.mother_tongue_codes}
          error={errors.mother_tongue_codes}
          onChange={(value) => set('mother_tongue_codes', value)}
        />
      </FilterGroup>

      <FilterGroup {...group('location')}>
        <SearchMultiField
          label={t('search.fields.country')}
          options={countries}
          value={filters.country_codes}
          error={errors.country_codes}
          onChange={(value) => set('country_codes', value)}
        />
        <RegionsField
          label={t('search.fields.region')}
          countries={filters.country_codes ?? []}
          value={filters.region_ids}
          onChange={(value) => set('region_ids', value)}
        />
        <CityField
          label={t('search.fields.city')}
          countries={filters.country_codes ?? []}
          fallbackCountry={viewerCountry}
          value={filters.city_ids}
          onChange={(value) => set('city_ids', value)}
        />
      </FilterGroup>

      <FilterGroup {...group('education_work')}>
        <SelectField
          label={t('search.fields.education')}
          anyLabel={t('search.any')}
          options={education}
          value={filters.education_min_rank}
          error={errors.education_min_rank}
          onChange={(value) => set('education_min_rank', value)}
        />
        <ChipsField
          label={t('search.fields.employment')}
          options={employment}
          value={filters.employment_types}
          onChange={(value) => set('employment_types', value)}
        />
        <SearchMultiField
          label={t('search.fields.profession')}
          options={professions}
          value={filters.profession_codes}
          onChange={(value) => set('profession_codes', value)}
        />
        <SelectField
          label={t('search.fields.income')}
          anyLabel={t('search.any')}
          options={income}
          value={filters.income_min_rank}
          error={errors.income_min_rank}
          onChange={(value) => set('income_min_rank', value)}
        />
      </FilterGroup>

      <FilterGroup {...group('faith')}>
        <ChipsField
          label={t('search.fields.religiosity')}
          options={religiosity}
          value={filters.religiosity_levels}
          onChange={(value) => set('religiosity_levels', value)}
        />
        {viewerGender === 'male' ? (
          <ChipsField
            label={t('search.fields.hijab')}
            options={hijab}
            value={filters.hijab_types}
            onChange={(value) => set('hijab_types', value)}
          />
        ) : null}
        {viewerGender === 'female' ? (
          <ChipsField
            label={t('search.fields.beard')}
            options={beard}
            value={filters.beard_types}
            onChange={(value) => set('beard_types', value)}
          />
        ) : null}
      </FilterGroup>

      <FilterGroup {...group('family')}>
        <ChipsField
          label={t('search.fields.family_values')}
          options={familyValues}
          value={filters.family_values}
          onChange={(value) => set('family_values', value)}
        />
        <ChipsField
          label={t('search.fields.family_type')}
          options={familyTypes}
          value={filters.family_types}
          onChange={(value) => set('family_types', value)}
        />
      </FilterGroup>

      <FilterGroup {...group('lifestyle')}>
        <ChipsField
          label={t('search.fields.living')}
          options={living}
          value={filters.living_arrangements}
          onChange={(value) => set('living_arrangements', value)}
        />
        <ChipsField
          label={t('search.fields.work')}
          options={work}
          value={filters.work_after_marriage_options}
          onChange={(value) => set('work_after_marriage_options', value)}
        />
        <ChipsField
          label={t('search.fields.smoking')}
          options={smoking}
          value={filters.smoking_options}
          onChange={(value) => set('smoking_options', value)}
        />
      </FilterGroup>

      <FilterGroup {...group('profile')}>
        <ChipsField
          label={t('search.fields.managed_by')}
          options={managedBy}
          value={filters.managed_by}
          onChange={(value) => set('managed_by', value)}
        />
        <SwitchField
          label={t('search.fields.has_photo')}
          checked={filters.has_photo === true}
          onChange={(value) => set('has_photo', value || undefined)}
        />
        <SwitchField
          label={t('search.fields.verified_only')}
          checked={filters.verified_only === true}
          onChange={(value) => set('verified_only', value || undefined)}
        />
        <SelectField
          label={t('search.fields.active')}
          anyLabel={t('search.any_time')}
          options={[1, 7, 30].map((days) => ({
            value: days,
            label: t(`search.active_option.${days}`),
          }))}
          value={filters.active_within_days}
          error={errors.active_within_days}
          onChange={(value) => set('active_within_days', value)}
        />
        <SelectField
          label={t('search.fields.joined')}
          anyLabel={t('search.any_time')}
          options={[7, 30].map((days) => ({
            value: days,
            label: t(`search.joined_option.${days}`),
          }))}
          value={filters.joined_within_days}
          error={errors.joined_within_days}
          onChange={(value) => set('joined_within_days', value)}
        />
      </FilterGroup>
    </div>
  )
}
