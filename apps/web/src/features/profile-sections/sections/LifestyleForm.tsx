// ONB-07 (07 section 9) and ME-EDIT `lifestyle` (08 section 2).
import { useStore } from '@tanstack/react-form'
import { ChevronDown, Sparkles } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '~/components/common/ConfirmDialog'
import { Button } from '~/components/ui/button'
import { ageFromDateOfBirth } from '~/lib/format'
import { useLabelOf, useReference } from '~/lib/reference'
import { track } from '~/lib/track'
import { cn } from '~/lib/utils'
import { ChipsField, TextStatusNote } from '../fields'
import { FieldGroup, FormShell, useLatest, useManagedForm } from '../form-shell'
import { buildAboutMeDraft } from '../help-me-write'
import { useSaveSection } from '../queries'
import {
  type LifestyleContext,
  type LifestyleValues,
  lifestyleFromProfile,
  lifestyleSchema,
  lifestyleShows,
  lifestyleToBody,
  SECTION_NS,
} from '../schemas'
import { subjectOf, wordingContext } from '../wording'
import type { SectionFormInnerProps } from './types'

const HOBBY_CATEGORIES = [
  'faith',
  'sports',
  'arts',
  'food',
  'outdoors',
  'technology',
  'home',
  'social',
  'learning',
]

const APPEARANCE_FIELDS = [
  'weight_kg',
  'complexion',
  'body_type',
  'blood_group',
  'disability',
  'disability_details',
]

export function LifestyleForm({
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
  const label = useLabelOf()
  const save = useSaveSection('lifestyle')
  const subject = subjectOf(profile.account_for.managed_by, profile.basics.gender)
  const wording = { context: wordingContext(subject) }
  const context = useLatest<LifestyleContext>({
    gender: profile.basics.gender,
    religionCode: profile.community.religion_code,
  })
  const [schema] = useState(() => lifestyleSchema())
  const [defaultValues] = useState(() => lifestyleFromProfile(profile))
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const [activePrompt, setActivePrompt] = useState<number | null>(null)
  const [replaceDraft, setReplaceDraft] = useState<string | null>(null)
  const appearanceId = useId()

  const managed = useManagedForm({
    namespace: SECTION_NS,
    mode,
    step: 'lifestyle',
    defaultValues,
    schema,
    initialErrors,
    onDirtyChange,
    submit: async (values) => {
      const saved = await save.mutateAsync(lifestyleToBody(values, context.current))
      await onSaved?.(saved)
    },
  })
  const { form } = managed

  // A collapsed group opens when one of its fields has an error, so focus can reach it.
  const appearanceHasError = useStore(form.store, (state) =>
    APPEARANCE_FIELDS.some(
      (name) => (state.fieldMeta[name as keyof LifestyleValues]?.errors.length ?? 0) > 0,
    ),
  )
  const appearanceShown = appearanceOpen || appearanceHasError

  const hobbyGroups = useMemo(
    () =>
      HOBBY_CATEGORIES.map((category) => ({
        key: category,
        title: t(`lifestyle.hobby_category.${category}`),
        options: reference.hobbies
          .filter((hobby) => hobby.category === category)
          .map((hobby) => ({
            code: hobby.code,
            label: i18n.language === 'ur' && hobby.name_ur ? hobby.name_ur : hobby.name,
          })),
      })).filter((group) => group.options.length > 0),
    [reference, t, i18n.language],
  )

  const shows = (field: keyof LifestyleValues) => lifestyleShows(field, context.current)

  /** 07 section 9.3: the draft from the saved answers and the ones on this form. */
  const draft = () => {
    const values = form.state.values
    const { basics, education_career: education, location, family } = profile
    return buildAboutMeDraft(
      {
        subject,
        firstName: basics.first_name,
        age: basics.date_of_birth ? ageFromDateOfBirth(basics.date_of_birth) : null,
        job:
          education.job_title ??
          (education.profession_code
            ? label('profession_categories', education.profession_code)
            : null),
        city: location.city?.name ?? location.city_other,
        educationLevel: education.education_level_code
          ? label('education_levels', education.education_level_code)
          : null,
        educationField: education.education_field_code
          ? label('education_fields', education.education_field_code)
          : null,
        religiosity: values.religiosity,
        familyType: family.family_type,
        hobbies: values.hobby_codes.map((code) => label('hobbies', code)),
      },
      (key, options) => i18n.t(key, options ?? {}),
    )
  }

  const insertDraft = (text: string) => {
    form.setFieldValue('about_me', text)
    if (mode === 'onboarding') track('onboarding_help_me_write_used')
  }

  const onHelpMeWrite = () => {
    const text = draft()
    if (form.getFieldValue('about_me')?.trim()) setReplaceDraft(text)
    else insertDraft(text)
  }

  const workLabel =
    profile.basics.gender === 'male'
      ? t('lifestyle.work_male_profile_label', wording)
      : t('lifestyle.work_female_profile_label', wording)

  const prompts = [
    t('lifestyle.prompt_1', wording),
    t('lifestyle.prompt_2', wording),
    t('lifestyle.prompt_3'),
  ]

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
        <FieldGroup title={t('lifestyle.group_practice')}>
          <form.AppField name="religiosity">
            {(field) => (
              <field.SelectField
                label={t('lifestyle.religiosity_label', wording)}
                list="religiosity"
              />
            )}
          </form.AppField>
          {shows('prayer_frequency') ? (
            <form.AppField name="prayer_frequency">
              {(field) => (
                <field.SelectField
                  label={t('lifestyle.prayer_frequency_label')}
                  list="prayer_frequency"
                />
              )}
            </form.AppField>
          ) : null}
          {shows('hijab') ? (
            <form.AppField name="hijab">
              {(field) => <field.SelectField label={t('lifestyle.hijab_label')} list="hijab" />}
            </form.AppField>
          ) : null}
          {shows('beard') ? (
            <form.AppField name="beard">
              {(field) => <field.SelectField label={t('lifestyle.beard_label')} list="beard" />}
            </form.AppField>
          ) : null}
          {shows('religious_education') ? (
            <form.AppField name="religious_education">
              {(field) => (
                <field.SelectField
                  label={t('lifestyle.religious_education_label')}
                  list="religious_education"
                />
              )}
            </form.AppField>
          ) : null}
          <form.AppField name="smoking">
            {(field) => (
              <field.SelectField label={t('lifestyle.smoking_label', wording)} list="smoking" />
            )}
          </form.AppField>
        </FieldGroup>

        <FieldGroup title={t('lifestyle.group_plans')}>
          <form.AppField name="living_arrangement">
            {(field) => (
              <field.SelectField
                label={t('lifestyle.living_arrangement_label', wording)}
                list="living_arrangement"
                variant="radio"
                radioLayout="cards"
              />
            )}
          </form.AppField>
          <form.AppField name="work_after_marriage">
            {(field) => (
              <field.SelectField
                label={workLabel}
                list="work_after_marriage"
                variant="radio"
                radioLayout="cards"
              />
            )}
          </form.AppField>
          <form.AppField name="marriage_timeline">
            {(field) => (
              <field.SelectField
                label={t('lifestyle.marriage_timeline_label', wording)}
                list="marriage_timeline"
              />
            )}
          </form.AppField>
          <form.AppField name="jahez_stance">
            {(field) => (
              <field.SelectField
                label={t('lifestyle.jahez_stance_label')}
                list="jahez_stance"
                variant="radio"
                radioLayout="cards"
              />
            )}
          </form.AppField>
        </FieldGroup>

        <section className="flex flex-col gap-5">
          <h3 className="text-base font-semibold">
            <button
              type="button"
              aria-expanded={appearanceShown}
              aria-controls={appearanceId}
              onClick={() => setAppearanceOpen((open) => !open)}
              className="flex min-h-11 w-full items-center justify-between gap-2 text-start"
            >
              <span>
                {t('lifestyle.group_appearance')}{' '}
                <span className="font-normal text-muted-foreground">{t('common:optional')}</span>
              </span>
              <ChevronDown
                aria-hidden="true"
                className={cn('size-5 transition-transform', appearanceShown && 'rotate-180')}
              />
            </button>
          </h3>
          <div id={appearanceId} hidden={!appearanceShown} className="flex flex-col gap-5">
            {appearanceShown ? (
              <>
                <form.AppField name="weight_kg">
                  {(field) => (
                    <field.NumberField label={t('lifestyle.weight_kg_label')} max={200} />
                  )}
                </form.AppField>
                <form.AppField name="complexion">
                  {(field) => (
                    <field.SelectField label={t('lifestyle.complexion_label')} list="complexion" />
                  )}
                </form.AppField>
                <form.AppField name="body_type">
                  {(field) => (
                    <field.SelectField label={t('lifestyle.body_type_label')} list="body_type" />
                  )}
                </form.AppField>
                <form.AppField name="blood_group">
                  {(field) => (
                    <field.SelectField
                      label={t('lifestyle.blood_group_label')}
                      list="blood_group"
                    />
                  )}
                </form.AppField>
                <form.AppField name="disability">
                  {(field) => (
                    <field.SelectField label={t('lifestyle.disability_label')} list="disability" />
                  )}
                </form.AppField>
                <form.Subscribe
                  selector={(state) =>
                    state.values.disability != null && state.values.disability !== 'none'
                  }
                >
                  {(withDetails) =>
                    withDetails ? (
                      <form.AppField name="disability_details">
                        {(field) => (
                          <field.TextField
                            label={t('lifestyle.disability_details_label')}
                            maxLength={300}
                          />
                        )}
                      </form.AppField>
                    ) : null
                  }
                </form.Subscribe>
                <p className="text-sm text-muted-foreground">{t('lifestyle.health_help')}</p>
              </>
            ) : null}
          </div>
        </section>

        <FieldGroup title={t('lifestyle.group_hobbies')}>
          <form.AppField name="hobby_codes">
            {() => (
              <ChipsField
                label={t('lifestyle.hobbies_label')}
                groups={hobbyGroups}
                max={10}
                maxMessage={t('lifestyle.hobbies_max')}
              />
            )}
          </form.AppField>
        </FieldGroup>

        <FieldGroup title={t('lifestyle.group_about', wording)}>
          <div className="flex flex-col gap-2">
            <p id={`${appearanceId}-prompts`} className="text-sm font-medium">
              {t('lifestyle.prompts_label')}
            </p>
            <ul aria-labelledby={`${appearanceId}-prompts`} className="flex flex-col gap-1">
              {prompts.map((prompt, index) => (
                <li key={prompt}>
                  <button
                    type="button"
                    aria-pressed={activePrompt === index}
                    onClick={() => setActivePrompt(activePrompt === index ? null : index)}
                    className={cn(
                      'min-h-11 w-full rounded-[var(--radius-input)] border px-3 py-2 text-start text-sm transition-colors',
                      activePrompt === index
                        ? 'border-primary bg-primary-soft'
                        : 'border-border bg-surface hover:bg-muted',
                    )}
                  >
                    {prompt}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <form.AppField name="about_me">
            {(field) => (
              <field.TextAreaField
                label={t('lifestyle.about_me_label', wording)}
                helpText={t('lifestyle.about_me_help')}
                maxLength={1500}
                rows={7}
              />
            )}
          </form.AppField>
          <Button type="button" variant="outline" className="self-start" onClick={onHelpMeWrite}>
            <Sparkles aria-hidden="true" />
            {t('lifestyle.help_me_write')}
          </Button>
          <TextStatusNote status={profile.text_status.about_me} />
          {mode === 'edit' ? (
            <p className="text-sm text-muted-foreground">{t('form.review_note')}</p>
          ) : null}
        </FieldGroup>
      </FormShell>

      <ConfirmDialog
        open={replaceDraft != null}
        onOpenChange={(open) => {
          if (!open) setReplaceDraft(null)
        }}
        title={t('lifestyle.replace_dialog.title')}
        description=""
        confirmLabel={t('lifestyle.replace_dialog.confirm')}
        cancelLabel={t('lifestyle.replace_dialog.cancel')}
        onConfirm={() => {
          if (replaceDraft != null) insertDraft(replaceDraft)
        }}
      />
    </>
  )
}
