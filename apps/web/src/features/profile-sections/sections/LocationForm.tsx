// ONB-04 (07 section 6) and ME-EDIT `location` (08 section 2).
import { useStore } from '@tanstack/react-form'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOptions, useRegions } from '~/lib/reference'
import { FormShell, useLatest, useManagedForm } from '../form-shell'
import { useSaveSection } from '../queries'
import {
  asksResidency,
  type LocationContext,
  locationFromProfile,
  locationSchema,
  locationToBody,
  SECTION_NS,
} from '../schemas'
import { subjectOf, wordingContext } from '../wording'
import type { SectionFormInnerProps } from './types'

const PLACE_FIELDS = ['country_code', 'region_id', 'city_id', 'city_other']

export function LocationForm({
  profile,
  mode,
  submitLabel,
  onSaved,
  footer,
  initialErrors,
  onDirtyChange,
}: SectionFormInnerProps) {
  const { t } = useTranslation('profile_sections')
  const save = useSaveSection('location')
  const residencyOptions = useOptions('residency_status')
  const context = useLatest<LocationContext>({ countryHasRegions: () => false })
  const [schema] = useState(() => locationSchema(() => context.current))
  const [defaultValues] = useState(() => locationFromProfile(profile))

  const managed = useManagedForm({
    namespace: SECTION_NS,
    mode,
    step: 'location',
    defaultValues,
    schema,
    initialErrors,
    onDirtyChange,
    aliases: {
      ...Object.fromEntries(PLACE_FIELDS.map((field) => [field, 'place'])),
      origin_city_id: 'origin',
      origin_other: 'origin',
    },
    submit: async (values) => {
      const saved = await save.mutateAsync(locationToBody(values))
      await onSaved?.(saved)
    },
  })
  const { form } = managed
  const placeCountry = useRef(defaultValues.place.country_code)

  // A typed city needs a region when the country has regions (07 section 6.2 rule 3).
  const country = useStore(form.store, (state) => state.values.place.country_code)
  const regions = useRegions(country)
  context.current = {
    countryHasRegions: (code) => code === country && (regions.data?.length ?? 0) > 0,
  }

  // `citizen` applies only to dual nationals here, so it moves to the end (07 section 6.1).
  const residency = [
    ...residencyOptions.filter((option) => option.code !== 'citizen'),
    ...residencyOptions.filter((option) => option.code === 'citizen'),
  ]
  const subject = subjectOf(profile.account_for.managed_by, profile.basics.gender)

  return (
    <FormShell
      form={form}
      controls={managed.controls}
      unmatched={managed.unmatched}
      failure={managed.failure}
      submitLabel={submitLabel}
      footer={footer}
      failureText={t(mode === 'onboarding' ? 'form.failed_onboarding' : 'form.failed')}
      label={t('location.title', { context: wordingContext(subject) })}
    >
      <form.AppField
        name="place"
        listeners={{
          // Changing the country also clears the area (07 section 6.1).
          onChange: ({ value }) => {
            if (value.country_code !== placeCountry.current) form.setFieldValue('area', null)
            placeCountry.current = value.country_code
          },
        }}
      >
        {(field) => (
          <field.CityPickerField
            label={t('location.place_label')}
            countryLabel={t('location.country_label')}
            regionLabel={t('location.region_label')}
            cityLabel={t('location.city_label')}
            cityOtherLabel={t('location.city_other_label')}
            legendHidden
            required
          />
        )}
      </form.AppField>
      <form.AppField name="area">
        {(field) => (
          <field.TextField
            label={t('location.area_label')}
            helpText={t('location.area_help')}
            maxLength={80}
          />
        )}
      </form.AppField>
      <form.AppField name="nationality_code">
        {(field) => (
          <field.SearchSelectField
            label={t('location.nationality_label')}
            list="countries"
            required
          />
        )}
      </form.AppField>
      <form.Subscribe selector={(state) => asksResidency(state.values)}>
        {(asks) =>
          asks ? (
            <form.AppField name="residency_status">
              {(field) => (
                <field.SelectField
                  label={t('location.residency_label')}
                  options={residency}
                  required
                />
              )}
            </form.AppField>
          ) : null
        }
      </form.Subscribe>
      <form.AppField name="origin">
        {(field) => (
          <field.CityPickerField
            label={t('location.origin_label')}
            helpText={t('location.origin_help')}
            cityLabel={t('location.origin_city_label')}
            cityOtherLabel={t('location.origin_other_label')}
            hideCountry
          />
        )}
      </form.AppField>
      <form.AppField name="relocation">
        {(field) => (
          <field.SelectField
            label={t('location.relocation_label')}
            list="relocation"
            variant="radio"
            radioLayout="cards"
          />
        )}
      </form.AppField>
    </FormShell>
  )
}
