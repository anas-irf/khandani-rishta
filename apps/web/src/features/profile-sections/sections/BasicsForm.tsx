// ONB-02 (07 section 4) and ME-EDIT `basics` (08 section 2).
import { TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '~/components/common/ConfirmDialog'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { ageFromDateOfBirth, formatLongDate } from '~/lib/format'
import { useLabelOf, useOptions } from '~/lib/reference'
import { LockedField } from '../fields'
import { FormShell, useLatest, useManagedForm } from '../form-shell'
import { useSaveSection } from '../queries'
import { basicsFromProfile, basicsSchema, basicsToBody, SECTION_NS } from '../schemas'
import { subjectOf, wordingContext } from '../wording'
import type { SectionFormInnerProps } from './types'

const CHILDREN_WITH_COUNT = ['living_with_me', 'not_living_with_me']

type GenderPrompt = { gender: string; resolve: (confirmed: boolean) => void }

export function BasicsForm({
  profile,
  mode,
  submitLabel,
  onSaved,
  footer,
  initialErrors,
  onDirtyChange,
}: SectionFormInnerProps) {
  const { t } = useTranslation('profile_sections')
  const label = useLabelOf()
  const save = useSaveSection('basics')
  const maritalOptions = useOptions('marital_status')
  const subject = subjectOf(profile.account_for.managed_by, profile.basics.gender)
  const context = useLatest({ subject, savedGender: profile.basics.gender })
  const [schema] = useState(() => basicsSchema(() => context.current))
  const [defaultValues] = useState(() => basicsFromProfile(profile))
  const [genderPrompt, setGenderPrompt] = useState<GenderPrompt | null>(null)
  const locked = new Set(profile.locked_fields)

  const askGenderChange = (gender: string) =>
    new Promise<boolean>((resolve) => setGenderPrompt({ gender, resolve }))

  const managed = useManagedForm({
    namespace: SECTION_NS,
    mode,
    step: 'basics',
    defaultValues,
    schema,
    initialErrors,
    onDirtyChange,
    // The too-young message depends on who the profile is for (07 section 16.2).
    rewrite: (error) =>
      error.field === 'date_of_birth' &&
      error.code === 'too_young' &&
      context.current.subject !== 'self'
        ? { ...error, code: 'too_young_other' }
        : error,
    submit: async (values) => {
      const saved = context.current.savedGender
      // 07 section 4.1: changing a saved gender during onboarding asks first.
      if (mode === 'onboarding' && saved && values.gender && values.gender !== saved) {
        const confirmed = await askGenderChange(label('gender', values.gender))
        if (!confirmed) return
      }
      const result = await save.mutateAsync(basicsToBody(values))
      await onSaved?.(result)
    },
  })
  const { form } = managed
  const wording = { context: wordingContext(subject) }

  return (
    <>
      <FormShell
        form={form}
        controls={managed.controls}
        unmatched={managed.unmatched}
        failure={managed.failure}
        submitLabel={submitLabel}
        footer={footer}
        failureText={t(mode === 'onboarding' ? 'form.failed_onboarding' : 'form.failed')}
      >
        {locked.has('first_name') ? (
          <LockedField
            label={t('basics.first_name_label')}
            value={profile.basics.first_name ?? ''}
          />
        ) : (
          <form.AppField name="first_name">
            {(field) => (
              <field.TextField
                label={t('basics.first_name_label')}
                autoComplete={subject === 'self' ? 'given-name' : 'off'}
                autoCapitalize="words"
                maxLength={40}
                required
              />
            )}
          </form.AppField>
        )}
        {locked.has('last_name') ? (
          <LockedField label={t('basics.last_name_label')} value={profile.basics.last_name ?? ''} />
        ) : (
          <form.AppField name="last_name">
            {(field) => (
              <field.TextField
                label={t('basics.last_name_label')}
                helpText={t('basics.last_name_help')}
                autoComplete={subject === 'self' ? 'family-name' : 'off'}
                autoCapitalize="words"
                maxLength={40}
                required
              />
            )}
          </form.AppField>
        )}
        {locked.has('gender') ? (
          <LockedField
            label={t('basics.gender_label')}
            value={label('gender', profile.basics.gender)}
          />
        ) : (
          <form.AppField
            name="gender"
            listeners={{
              onChange: ({ value }) => {
                // `married` is offered only to men (07 section 4.1).
                if (value === 'female' && form.getFieldValue('marital_status') === 'married') {
                  form.setFieldValue('marital_status', null)
                  form.setFieldValue('current_wives_count', null)
                }
              },
            }}
          >
            {(field) => (
              <field.SelectField
                label={t('basics.gender_label')}
                list="gender"
                variant="radio"
                radioLayout="segmented"
                required
              />
            )}
          </form.AppField>
        )}
        {locked.has('date_of_birth') ? (
          <LockedField
            label={t('basics.date_of_birth_label')}
            value={
              profile.basics.date_of_birth
                ? `${formatLongDate(profile.basics.date_of_birth)} (${t('common:format.age', {
                    age: ageFromDateOfBirth(profile.basics.date_of_birth),
                  })})`
                : ''
            }
          />
        ) : (
          <form.AppField name="date_of_birth">
            {(field) => (
              <field.DateOfBirthField
                label={t('basics.date_of_birth_label')}
                helpText={t('basics.date_of_birth_help')}
                required
              />
            )}
          </form.AppField>
        )}

        <form.Subscribe selector={(state) => state.values}>
          {(values) => (
            <>
              <form.AppField name="marital_status">
                {(field) => (
                  <field.SelectField
                    label={t('basics.marital_status_label')}
                    options={maritalOptions.filter(
                      (option) => option.code !== 'married' || values.gender === 'male',
                    )}
                    required
                  />
                )}
              </form.AppField>
              {values.marital_status === 'married' ? (
                <form.AppField name="current_wives_count">
                  {(field) => (
                    <field.NumberField
                      label={t('basics.current_wives_count_label')}
                      min={1}
                      max={3}
                      stepper
                      required
                    />
                  )}
                </form.AppField>
              ) : null}
              {values.marital_status && values.marital_status !== 'never_married' ? (
                <form.AppField name="children_status">
                  {(field) => (
                    <field.SelectField
                      label={t('basics.children_status_label', wording)}
                      list="children_status"
                      variant="radio"
                      radioLayout="cards"
                      required
                    />
                  )}
                </form.AppField>
              ) : null}
              {values.marital_status &&
              values.marital_status !== 'never_married' &&
              CHILDREN_WITH_COUNT.includes(values.children_status ?? '') ? (
                <form.AppField name="children_count">
                  {(field) => (
                    <field.NumberField
                      label={t('basics.children_count_label')}
                      min={1}
                      max={15}
                      stepper
                      required
                    />
                  )}
                </form.AppField>
              ) : null}
            </>
          )}
        </form.Subscribe>

        <form.AppField name="height_cm">
          {(field) => <field.HeightField label={t('basics.height_label')} required />}
        </form.AppField>

        {mode === 'onboarding' ? (
          <Alert variant="warning">
            <TriangleAlert aria-hidden="true" />
            <AlertDescription>{t('basics.warning')}</AlertDescription>
          </Alert>
        ) : null}
      </FormShell>

      <ConfirmDialog
        open={genderPrompt != null}
        onOpenChange={(open) => {
          if (!open) {
            genderPrompt?.resolve(false)
            setGenderPrompt(null)
          }
        }}
        title={t('basics.gender_dialog.title', { gender: genderPrompt?.gender ?? '' })}
        description={t('basics.gender_dialog.body')}
        confirmLabel={t('basics.gender_dialog.confirm')}
        cancelLabel={t('basics.gender_dialog.cancel')}
        onConfirm={() => genderPrompt?.resolve(true)}
      />
    </>
  )
}
