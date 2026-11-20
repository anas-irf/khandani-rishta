import { useTranslation } from 'react-i18next'
import { formatDate } from '~/lib/format'
import { fallbackLabel, useLabelOf } from '~/lib/reference'
import type { AdminProfile } from '../types'
import { Facts } from './Facts'

type FieldKind = 'date' | 'city'
type FieldDef = { key: string; list?: string; kind?: FieldKind }

const SECTIONS: { id: string; fields: FieldDef[] }[] = [
  {
    id: 'account_for',
    fields: [{ key: 'managed_by', list: 'managed_by' }, { key: 'manager_name' }],
  },
  {
    id: 'basics',
    fields: [
      { key: 'first_name' },
      { key: 'last_name' },
      { key: 'gender', list: 'gender' },
      { key: 'date_of_birth', kind: 'date' },
      { key: 'marital_status', list: 'marital_status' },
      { key: 'children_status', list: 'children_status' },
      { key: 'children_count' },
      { key: 'current_wives_count' },
      { key: 'height_cm' },
    ],
  },
  {
    id: 'community',
    fields: [
      { key: 'religion_code', list: 'religions' },
      { key: 'sect_code', list: 'sects' },
      { key: 'caste_code', list: 'castes' },
      { key: 'caste_other' },
      { key: 'sub_caste_code', list: 'sub_castes' },
      { key: 'sub_caste_other' },
      { key: 'mother_tongue_code', list: 'languages' },
      { key: 'language_codes', list: 'languages' },
    ],
  },
  {
    id: 'location',
    fields: [
      { key: 'nationality_code', list: 'countries' },
      { key: 'country_code', list: 'countries' },
      { key: 'city', kind: 'city' },
      { key: 'city_other' },
      { key: 'area' },
      { key: 'residency_status', list: 'residency_status' },
      { key: 'origin_city', kind: 'city' },
      { key: 'origin_other' },
      { key: 'relocation', list: 'relocation' },
    ],
  },
  {
    id: 'education_career',
    fields: [
      { key: 'education_level_code', list: 'education_levels' },
      { key: 'education_field_code', list: 'education_fields' },
      { key: 'degree_title' },
      { key: 'institute_name' },
      { key: 'employment_type', list: 'employment_type' },
      { key: 'profession_code', list: 'profession_categories' },
      { key: 'job_title' },
      { key: 'employer_name' },
      { key: 'income_band_code', list: 'income_bands' },
    ],
  },
  {
    id: 'family',
    fields: [
      { key: 'father_status', list: 'parent_status' },
      { key: 'father_occupation' },
      { key: 'mother_status', list: 'parent_status' },
      { key: 'mother_occupation' },
      { key: 'brothers_count' },
      { key: 'brothers_married' },
      { key: 'sisters_count' },
      { key: 'sisters_married' },
      { key: 'family_type', list: 'family_type' },
      { key: 'family_class', list: 'family_class' },
      { key: 'family_values', list: 'family_values' },
      { key: 'family_country_code', list: 'countries' },
      { key: 'home_ownership', list: 'home_ownership' },
      { key: 'home_type', list: 'home_type' },
      { key: 'home_size_value' },
      { key: 'home_size_unit', list: 'home_size_unit' },
    ],
  },
  {
    id: 'lifestyle',
    fields: [
      { key: 'religiosity', list: 'religiosity' },
      { key: 'prayer_frequency', list: 'prayer_frequency' },
      { key: 'hijab', list: 'hijab' },
      { key: 'beard', list: 'beard' },
      { key: 'religious_education', list: 'religious_education' },
      { key: 'smoking', list: 'smoking' },
      { key: 'living_arrangement', list: 'living_arrangement' },
      { key: 'work_after_marriage', list: 'work_after_marriage' },
      { key: 'marriage_timeline', list: 'marriage_timeline' },
      { key: 'jahez_stance', list: 'jahez_stance' },
      { key: 'weight_kg' },
      { key: 'complexion', list: 'complexion' },
      { key: 'body_type', list: 'body_type' },
      { key: 'blood_group', list: 'blood_group' },
      { key: 'disability', list: 'disability' },
      { key: 'disability_details' },
      { key: 'hobby_codes', list: 'hobbies' },
    ],
  },
  {
    id: 'contacts',
    fields: [
      { key: 'phone_e164' },
      { key: 'whatsapp_e164' },
      { key: 'contact_email' },
      { key: 'guardian_name' },
      { key: 'guardian_relation', list: 'guardian_relation' },
      { key: 'guardian_phone_e164' },
      { key: 'preferred_contact', list: 'preferred_contact' },
      { key: 'best_time_to_call' },
    ],
  },
]

type CityValue = { name: string; region_name: string | null } | null

/** The sections of a profile as staff see them: every value, labelled from the reference data. */
export function ProfileSections({ profile }: { profile: AdminProfile['profile'] }) {
  const { t } = useTranslation('admin')
  const label = useLabelOf()
  const record = profile as unknown as Record<string, Record<string, unknown> | null>

  const show = (def: FieldDef, value: unknown): string | undefined => {
    if (value === null || value === undefined || value === '') return undefined
    if (typeof value === 'boolean') return value ? t('common.yes') : t('common.no')
    if (def.kind === 'date' && typeof value === 'string') return formatDate(value)
    if (def.kind === 'city') {
      const city = value as NonNullable<CityValue>
      return [city.name, city.region_name].filter(Boolean).join(', ')
    }
    const list = def.list
    if (Array.isArray(value)) {
      if (value.length === 0) return undefined
      return value.map((code) => (list ? label(list, String(code)) : String(code))).join(', ')
    }
    if (list) return label(list, String(value))
    return String(value)
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      {SECTIONS.map((section) => {
        const data = record[section.id]
        const title = t(`profile.section.${section.id}`)
        if (section.id === 'contacts' && data === null) {
          return (
            <Facts
              key={section.id}
              title={title}
              columns={1}
              facts={[{ label: title, value: t('profile.contacts_hidden') }]}
            />
          )
        }
        return (
          <Facts
            key={section.id}
            title={title}
            columns={2}
            facts={section.fields.map((def) => ({
              label: t(`profile.field.${def.key}`, { defaultValue: fallbackLabel(def.key) }),
              value: show(def, data?.[def.key]),
            }))}
          />
        )
      })}
    </div>
  )
}
