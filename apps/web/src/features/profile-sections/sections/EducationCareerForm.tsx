// ONB-05 (07 section 7) and ME-EDIT `education_career` (08 section 2).
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/button'
import { Label } from '~/components/ui/label'
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select'
import { useReference } from '~/lib/reference'
import { FormShell, useManagedForm } from '../form-shell'
import { incomeCurrencies, initialIncomeCurrency } from '../income'
import { useSaveSection } from '../queries'
import {
  educationCareerFromProfile,
  educationCareerSchema,
  educationCareerToBody,
  isWorking,
  SECTION_NS,
} from '../schemas'
import type { SectionFormInnerProps } from './types'

export function EducationCareerForm({
  profile,
  mode,
  submitLabel,
  onSaved,
  footer,
  initialErrors,
  onDirtyChange,
}: SectionFormInnerProps) {
  const { t, i18n } = useTranslation('profile_sections')
  const reference = useReference()
  const save = useSaveSection('education_career')
  const [schema] = useState(() => educationCareerSchema())
  const [defaultValues] = useState(() => educationCareerFromProfile(profile))
  const bands = reference.income_bands
  const [currency, setCurrency] = useState(() =>
    initialIncomeCurrency(bands, profile.location.country_code, defaultValues.income_band_code),
  )
  const [choosingCurrency, setChoosingCurrency] = useState(false)
  const currencyId = useId()

  const managed = useManagedForm({
    namespace: SECTION_NS,
    mode,
    step: 'education_career',
    defaultValues,
    schema,
    initialErrors,
    onDirtyChange,
    submit: async (values) => {
      const saved = await save.mutateAsync(educationCareerToBody(values))
      await onSaved?.(saved)
    },
  })
  const { form } = managed

  const bandOptions = bands
    .filter((band) => band.currency_code === currency)
    .sort((a, b) => a.rank - b.rank)
    .map((band) => ({
      code: band.code,
      label: t('education_career.income_option', {
        label: i18n.language === 'ur' && band.label_ur ? band.label_ur : band.label,
        currency: band.currency_code,
      }),
    }))

  return (
    <FormShell
      form={form}
      controls={managed.controls}
      unmatched={managed.unmatched}
      failure={managed.failure}
      submitLabel={submitLabel}
      footer={footer}
      failureText={t(mode === 'onboarding' ? 'form.failed_onboarding' : 'form.failed')}
    >
      <form.AppField name="education_level_code">
        {(field) => (
          <field.SelectField
            label={t('education_career.education_level_label')}
            list="education_levels"
            required
          />
        )}
      </form.AppField>
      <form.AppField name="education_field_code">
        {(field) => (
          <field.SearchSelectField
            label={t('education_career.education_field_label')}
            list="education_fields"
          />
        )}
      </form.AppField>
      <form.AppField name="degree_title">
        {(field) => (
          <field.TextField
            label={t('education_career.degree_title_label')}
            placeholder={t('education_career.degree_title_placeholder')}
            maxLength={80}
          />
        )}
      </form.AppField>
      <form.AppField name="institute_name">
        {(field) => (
          <field.TextField
            label={t('education_career.institute_name_label')}
            helpText={t('education_career.private_help')}
            maxLength={120}
          />
        )}
      </form.AppField>
      <form.AppField name="employment_type">
        {(field) => (
          <field.SelectField
            label={t('education_career.employment_type_label')}
            list="employment_type"
            required
          />
        )}
      </form.AppField>

      <form.Subscribe selector={(state) => isWorking(state.values.employment_type)}>
        {(working) =>
          working ? (
            <>
              <form.AppField name="profession_code">
                {(field) => (
                  <field.SearchSelectField
                    label={t('education_career.profession_label')}
                    list="profession_categories"
                  />
                )}
              </form.AppField>
              <form.AppField name="job_title">
                {(field) => (
                  <field.TextField label={t('education_career.job_title_label')} maxLength={80} />
                )}
              </form.AppField>
              <form.AppField name="employer_name">
                {(field) => (
                  <field.TextField
                    label={t('education_career.employer_name_label')}
                    helpText={t('education_career.private_help')}
                    maxLength={120}
                  />
                )}
              </form.AppField>
              <div className="flex flex-col gap-2">
                <form.AppField name="income_band_code">
                  {(field) => (
                    <field.SelectField
                      label={t('education_career.income_label')}
                      helpText={t('education_career.private_help')}
                      options={bandOptions}
                      placeholder={t('education_career.income_none')}
                      variant="native"
                    />
                  )}
                </form.AppField>
                {choosingCurrency ? (
                  <div className="grid gap-1.5">
                    <Label htmlFor={currencyId}>{t('education_career.currency_label')}</Label>
                    <NativeSelect
                      id={currencyId}
                      value={currency}
                      onChange={(event) => {
                        // Choosing a currency reloads the list and clears the choice (07 7.2).
                        setCurrency(event.target.value)
                        form.setFieldValue('income_band_code', null)
                      }}
                    >
                      {incomeCurrencies(bands).map((code) => (
                        <NativeSelectOption key={code} value={code}>
                          {code}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="link"
                    className="h-11 w-fit px-0"
                    onClick={() => setChoosingCurrency(true)}
                  >
                    {t('education_career.change_currency')}
                  </Button>
                )}
              </div>
            </>
          ) : null
        }
      </form.Subscribe>
    </FormShell>
  )
}
