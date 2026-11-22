// ONB-06 (07 section 8) and ME-EDIT `family` (08 section 2).
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TextStatusNote } from '../fields'
import { FieldGroup, FormShell, useManagedForm } from '../form-shell'
import { useSaveSection } from '../queries'
import { familyFromProfile, familySchema, familyToBody, SECTION_NS } from '../schemas'
import { subjectOf, wordingContext } from '../wording'
import type { SectionFormInnerProps } from './types'

export function FamilyForm({
  profile,
  mode,
  submitLabel,
  onSaved,
  footer,
  initialErrors,
  onDirtyChange,
}: SectionFormInnerProps) {
  const { t } = useTranslation('profile_sections')
  const save = useSaveSection('family')
  const [schema] = useState(() => familySchema())
  const [defaultValues] = useState(() => familyFromProfile(profile))
  const subject = subjectOf(profile.account_for.managed_by, profile.basics.gender)

  const managed = useManagedForm({
    namespace: SECTION_NS,
    mode,
    step: 'family',
    defaultValues,
    schema,
    initialErrors,
    onDirtyChange,
    aliases: { family_country_code: 'family_place', family_city_id: 'family_place' },
    submit: async (values) => {
      const saved = await save.mutateAsync(familyToBody(values))
      await onSaved?.(saved)
    },
  })
  const { form } = managed

  // A count of 0 or "Not set" hides the married count, which is then sent as null (07 8.1).
  const resetMarried = (kind: 'brothers' | 'sisters') => (value: number | null) => {
    if (value == null || value === 0) form.setFieldValue(`${kind}_married`, null)
  }

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
      <FieldGroup title={t('family.group_parents')}>
        <form.AppField name="father_status">
          {(field) => (
            <field.SelectField
              label={t('family.father_status_label')}
              list="parent_status"
              variant="radio"
              radioLayout="segmented"
            />
          )}
        </form.AppField>
        <form.AppField name="father_occupation">
          {(field) => (
            <field.TextField
              label={t('family.father_occupation_label')}
              placeholder={t('family.father_occupation_placeholder')}
              maxLength={80}
            />
          )}
        </form.AppField>
        <form.AppField name="mother_status">
          {(field) => (
            <field.SelectField
              label={t('family.mother_status_label')}
              list="parent_status"
              variant="radio"
              radioLayout="segmented"
            />
          )}
        </form.AppField>
        <form.AppField name="mother_occupation">
          {(field) => (
            <field.TextField
              label={t('family.mother_occupation_label')}
              placeholder={t('family.mother_occupation_placeholder')}
              maxLength={80}
            />
          )}
        </form.AppField>
      </FieldGroup>

      <FieldGroup title={t('family.group_siblings')}>
        <form.Subscribe
          selector={(state) => ({
            brothers: state.values.brothers_count,
            sisters: state.values.sisters_count,
          })}
        >
          {(counts) => (
            <>
              <form.AppField
                name="brothers_count"
                listeners={{ onChange: ({ value }) => resetMarried('brothers')(value) }}
              >
                {(field) => (
                  <field.NumberField
                    label={t('family.brothers_count_label')}
                    min={0}
                    max={15}
                    stepper
                    placeholder={t('family.not_set')}
                  />
                )}
              </form.AppField>
              {counts.brothers != null && counts.brothers > 0 ? (
                <form.AppField name="brothers_married">
                  {(field) => (
                    <field.NumberField
                      label={t('family.brothers_married_label')}
                      min={0}
                      max={counts.brothers ?? 0}
                      stepper
                      placeholder={t('family.not_set')}
                    />
                  )}
                </form.AppField>
              ) : null}
              <form.AppField
                name="sisters_count"
                listeners={{ onChange: ({ value }) => resetMarried('sisters')(value) }}
              >
                {(field) => (
                  <field.NumberField
                    label={t('family.sisters_count_label')}
                    min={0}
                    max={15}
                    stepper
                    placeholder={t('family.not_set')}
                  />
                )}
              </form.AppField>
              {counts.sisters != null && counts.sisters > 0 ? (
                <form.AppField name="sisters_married">
                  {(field) => (
                    <field.NumberField
                      label={t('family.sisters_married_label')}
                      min={0}
                      max={counts.sisters ?? 0}
                      stepper
                      placeholder={t('family.not_set')}
                    />
                  )}
                </form.AppField>
              ) : null}
            </>
          )}
        </form.Subscribe>
      </FieldGroup>

      <FieldGroup title={t('family.group_background')}>
        <form.AppField name="family_type">
          {(field) => (
            <field.SelectField
              label={t('family.family_type_label')}
              list="family_type"
              variant="radio"
              radioLayout="segmented"
            />
          )}
        </form.AppField>
        <form.AppField name="family_class">
          {(field) => (
            <field.SelectField label={t('family.family_class_label')} list="family_class" />
          )}
        </form.AppField>
        <form.AppField name="family_values">
          {(field) => (
            <field.SelectField label={t('family.family_values_label')} list="family_values" />
          )}
        </form.AppField>
        <form.AppField name="family_elsewhere">
          {(field) => (
            <field.SwitchField
              label={t('family.elsewhere_label', { context: wordingContext(subject) })}
            />
          )}
        </form.AppField>
        <form.Subscribe selector={(state) => state.values.family_elsewhere}>
          {(elsewhere) =>
            elsewhere ? (
              <form.AppField name="family_place">
                {(field) => (
                  <field.CityPickerField
                    label={t('family.family_place_label')}
                    countryLabel={t('family.family_country_label')}
                    cityLabel={t('family.family_city_label')}
                    legendHidden
                  />
                )}
              </form.AppField>
            ) : null
          }
        </form.Subscribe>
      </FieldGroup>

      <FieldGroup title={t('family.group_home')} help={t('family.home_help')}>
        <form.AppField name="home_ownership">
          {(field) => (
            <field.SelectField label={t('family.home_ownership_label')} list="home_ownership" />
          )}
        </form.AppField>
        <form.AppField name="home_type">
          {(field) => <field.SelectField label={t('family.home_type_label')} list="home_type" />}
        </form.AppField>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,8.5rem),1fr))] gap-3">
          <form.AppField
            name="home_size_value"
            listeners={{
              // The unit defaults to marla in Pakistan, otherwise square feet (07 8.1).
              onChange: ({ value }) => {
                if (value && !form.getFieldValue('home_size_unit')) {
                  form.setFieldValue(
                    'home_size_unit',
                    profile.location.country_code === 'PK' ? 'marla' : 'sq_ft',
                  )
                }
              },
            }}
          >
            {(field) => (
              <field.TextField
                label={t('family.home_size_label')}
                inputMode="decimal"
                maxLength={8}
              />
            )}
          </form.AppField>
          <form.AppField name="home_size_unit">
            {(field) => (
              <field.SelectField
                label={t('family.home_size_unit_label')}
                list="home_size_unit"
                variant="native"
              />
            )}
          </form.AppField>
        </div>
      </FieldGroup>

      <div className="flex flex-col gap-2">
        <form.AppField name="about_family">
          {(field) => (
            <field.TextAreaField
              label={t('family.about_family_label')}
              helpText={t('family.about_family_help')}
              maxLength={1000}
              rows={5}
            />
          )}
        </form.AppField>
        <TextStatusNote status={profile.text_status.about_family} />
        {mode === 'edit' ? (
          <p className="text-caption text-muted-foreground">{t('form.review_note')}</p>
        ) : null}
      </div>
    </FormShell>
  )
}
