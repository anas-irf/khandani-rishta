// The partner preferences form of ONB-09 and ME-PREFS (07 section 11, 16 section 6.20).
import { useStore } from '@tanstack/react-form'
import { TriangleAlert } from 'lucide-react'
import { type ReactNode, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Disclosure } from '~/components/common/Disclosure'
import { ErrorState } from '~/components/common/ErrorState'
import { FormSkeleton } from '~/components/common/FormSkeleton'
import type { SearchOption } from '~/components/common/fields'
import { DiamondTitle } from '~/components/common/Ornament'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { ChipsField, TextStatusNote } from '~/features/profile-sections/fields'
import { FormShell, useManagedForm } from '~/features/profile-sections/form-shell'
import { useOwnProfile } from '~/features/profile-sections/queries'
import type { ClientFieldError } from '~/lib/api'
import type { Gender, Preferences } from '~/lib/api-types'
import { useCurrentMe } from '~/lib/me'
import { useBarHeight } from '~/lib/media'
import { optionsOf, useOptions, useReference } from '~/lib/reference'
import { CityIdsField, useRegionOptions } from './PlacesFields'
import { usePreferences, useSavePreferences } from './queries'
import {
  type Dimension,
  hasPreference,
  type ImportanceKey,
  mustHaveCount,
  PREFERENCE_ALIASES,
  PREFERENCES_NS,
  type PreferencesValues,
  preferencesSchema,
  preferencesToBody,
  preferencesToValues,
} from './schemas'

export type PreferencesFormProps = {
  mode: 'onboarding' | 'edit'
  /** Default "Continue" in onboarding, "Save" when editing. */
  submitLabel?: string
  /** Called after `PUT /v1/me/preferences`; a returned promise keeps the form submitting. */
  onSaved?: (preferences: Preferences) => void | Promise<void>
  /** Rendered under the button (onboarding's Back, ME-PREFS's Cancel). */
  footer?: ReactNode
  initialErrors?: ClientFieldError[]
  onDirtyChange?: (dirty: boolean) => void
}

/**
 * Loads `GET /v1/me/preferences` (the stored row or the defaults of 07 section 12), shows the
 * two tiers with an importance control per row (11.3), and always saves the full object with
 * `PUT /v1/me/preferences`, even when nothing changed (11.1).
 */
export function PreferencesForm(props: PreferencesFormProps) {
  const query = usePreferences()
  const filled = useRef(false)
  if (query.isFetchedAfterMount && query.isSuccess) filled.current = true
  if (!filled.current && query.isError) {
    return (
      <ErrorState
        error={query.error}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    )
  }
  if (!filled.current || !query.data) return <FormSkeleton fields={6} />
  return <LoadedPreferencesForm {...props} preferences={query.data} />
}

const TIER_TWO_FIELDS = [
  'height',
  'children_acceptance',
  'caste_codes',
  'mother_tongue_codes',
  'employment_types',
  'profession_codes',
  'income_min_rank',
  'religiosity_levels',
  'hijab_types',
  'beard_types',
  'family_values',
  'family_types',
  'living_arrangements',
  'work_after_marriage_options',
  'smoking_options',
  'notes',
]

function LoadedPreferencesForm({
  mode,
  submitLabel,
  onSaved,
  footer,
  initialErrors,
  onDirtyChange,
  preferences,
}: PreferencesFormProps & { preferences: Preferences }) {
  const { t, i18n } = useTranslation(PREFERENCES_NS)
  const me = useCurrentMe()
  const reference = useReference()
  const profile = useOwnProfile()
  const save = useSavePreferences()
  const candidateGender: Gender | null = me.profile.gender
  const female = candidateGender === 'female'
  const [defaultValues] = useState(() => preferencesToValues(preferences))
  const [placesOpen, setPlacesOpen] = useState(
    preferences.region_ids.length > 0 || preferences.city_ids.length > 0,
  )
  const essentialsId = useId()
  const summaryRef = useBarHeight('--action-bar')

  const sectsOf = (religion: string) =>
    reference.religions.find((entry) => entry.code === religion)?.sects.map((sect) => sect.code) ??
    []

  const managed = useManagedForm({
    namespace: PREFERENCES_NS,
    mode,
    step: 'preferences',
    defaultValues,
    schema: preferencesSchema,
    aliases: PREFERENCE_ALIASES,
    initialErrors,
    onDirtyChange,
    submit: async (values) => {
      const saved = await save.mutateAsync(preferencesToBody(values, { candidateGender, sectsOf }))
      await onSaved?.(saved)
    },
  })
  const { form } = managed
  const values = useStore(form.store, (state) => state.values)
  const tierTwoHasError = useStore(form.store, (state) =>
    TIER_TWO_FIELDS.some(
      (name) => (state.fieldMeta[name as keyof PreferencesValues]?.errors.length ?? 0) > 0,
    ),
  )
  const musts = mustHaveCount(values, candidateGender)

  const localName = (item: { name: string; name_ur: string | null }) =>
    i18n.language === 'ur' && item.name_ur ? item.name_ur : item.name
  const maritalOptions = useOptions('marital_status').filter(
    (option) => option.code !== 'married' || female,
  )
  const sectOptions = values.religion_codes.flatMap((code) =>
    (reference.religions.find((entry) => entry.code === code)?.sects ?? []).map((sect) => ({
      code: sect.code,
      label: localName(sect),
    })),
  )
  const regionOptions = useRegionOptions(values.country_codes)
  const casteOptions = useMemo<SearchOption[]>(
    () =>
      reference.castes.map((caste) => ({
        code: caste.code,
        label: i18n.language === 'ur' && caste.name_ur ? caste.name_ur : caste.name,
        aliases: caste.aliases,
      })),
    [reference, i18n.language],
  )
  // One entry per distinct rank, named after its first level (05 section 7).
  const educationOptions = useMemo(() => {
    const seen = new Set<number>()
    const list: { code: string; label: string }[] = []
    for (const level of reference.education_levels) {
      if (seen.has(level.rank)) continue
      seen.add(level.rank)
      const name = (i18n.language === 'ur' && level.name_ur ? level.name_ur : level.name).replace(
        /\s*\(.*\)\s*$/,
        '',
      )
      list.push({ code: String(level.rank), label: t('rows.education_option', { name }) })
    }
    return list
  }, [reference, t, i18n.language])
  // The PKR bands by rank, as "At least ... PKR a month or the equivalent abroad" (05 10.3).
  const incomeOptions = useMemo(
    () =>
      reference.income_bands
        .filter((band) => band.currency_code === 'PKR')
        .sort((a, b) => a.rank - b.rank)
        .flatMap((band) => {
          const amount = /\d[\d,]*/.exec(band.label)?.[0]
          if (!amount || band.rank === 1) return []
          return [{ code: String(band.rank), label: t('rows.income_option', { amount }) }]
        }),
    [reference, t],
  )

  const row = (
    dimension: Dimension,
    importance: ImportanceKey,
    label: string,
    control: ReactNode,
  ) => (
    <div className="flex flex-col gap-4 border-b border-border pb-6">
      {control}
      <form.AppField name={importance}>
        {(field) => (
          <field.ImportanceField
            label={t('importance_label', { row: label })}
            disabled={!hasPreference(dimension, values, candidateGender)}
          />
        )}
      </form.AppField>
    </div>
  )

  const chips = (
    name: keyof PreferencesValues,
    label: string,
    options: { code: string; label: string }[],
  ) => (
    <form.AppField name={name}>
      {() => <ChipsField label={label} options={options} emptyLabel={t('any')} />}
    </form.AppField>
  )

  const list = (name: string) => optionsOf(reference, name, i18n.language)

  return (
    <FormShell
      form={form}
      controls={managed.controls}
      unmatched={managed.unmatched}
      failure={managed.failure}
      submitLabel={
        submitLabel ??
        (mode === 'onboarding' ? t('common:actions.continue') : t('common:actions.save'))
      }
      footer={footer}
      failureText={t(mode === 'onboarding' ? 'failed_onboarding' : 'failed')}
      inColumn
    >
      {musts >= 5 ? (
        <Alert variant="warning">
          <TriangleAlert aria-hidden="true" />
          <AlertDescription>{t('must_warning', { count: musts })}</AlertDescription>
        </Alert>
      ) : null}

      <section className="flex flex-col gap-6" aria-labelledby={essentialsId}>
        <h3 id={essentialsId} className="text-title-md font-bold">
          <DiamondTitle>{t('tier_essentials')}</DiamondTitle>
        </h3>
        {row(
          'age',
          'age_importance',
          t('rows.age'),
          <form.AppField name="age">
            {(field) => <field.AgeRangeField label={t('rows.age')} />}
          </form.AppField>,
        )}
        {row(
          'marital_status',
          'marital_status_importance',
          t('rows.marital_status'),
          chips('marital_statuses', t('rows.marital_status'), maritalOptions),
        )}
        {row(
          'religion',
          'religion_importance',
          t('rows.religion'),
          <form.AppField
            name="religion_codes"
            listeners={{
              // Sects stay only for the religions still selected.
              onChange: ({ value }) => {
                const allowed = new Set(value.flatMap(sectsOf))
                const current = form.getFieldValue('sect_codes')
                const kept = current.filter((code) => allowed.has(code))
                if (kept.length !== current.length) form.setFieldValue('sect_codes', kept)
              },
            }}
          >
            {() => (
              <ChipsField
                label={t('rows.religion')}
                options={list('religions')}
                emptyLabel={t('any')}
              />
            )}
          </form.AppField>,
        )}
        {sectOptions.length > 0
          ? row(
              'sect',
              'sect_importance',
              t('rows.sect'),
              chips('sect_codes', t('rows.sect'), sectOptions),
            )
          : null}
        {row(
          'location',
          'location_importance',
          t('rows.location'),
          <div className="flex flex-col gap-4">
            <form.AppField name="country_codes">
              {(field) => (
                <field.MultiSelectField
                  label={t('rows.countries')}
                  list="countries"
                  max={20}
                  emptyLabel={t('any')}
                />
              )}
            </form.AppField>
            {placesOpen ? (
              <>
                <form.AppField name="region_ids">
                  {(field) => (
                    <field.MultiSelectField
                      label={t('rows.regions')}
                      options={regionOptions}
                      max={20}
                      emptyLabel={t('any')}
                    />
                  )}
                </form.AppField>
                <form.AppField name="city_ids">
                  {() => (
                    <CityIdsField label={t('rows.cities')} countryCodes={values.country_codes} />
                  )}
                </form.AppField>
              </>
            ) : (
              <Button
                type="button"
                variant="link"
                className="self-start"
                onClick={() => setPlacesOpen(true)}
              >
                {t('rows.add_places')}
              </Button>
            )}
          </div>,
        )}
        {row(
          'education',
          'education_importance',
          t('rows.education'),
          <form.AppField name="education_min_rank">
            {(field) => (
              <field.SelectField
                label={t('rows.education')}
                options={educationOptions}
                placeholder={t('any')}
                variant="native"
              />
            )}
          </form.AppField>,
        )}
      </section>

      <Disclosure ornament title={t('more')} forceOpen={tierTwoHasError} contentClassName="gap-6">
        {row(
          'height',
          'height_importance',
          t('rows.height'),
          <form.AppField name="height">
            {(field) => <field.HeightRangeField label={t('rows.height')} />}
          </form.AppField>,
        )}
        {row(
          'children',
          'children_importance',
          t('rows.children'),
          <form.AppField name="children_acceptance">
            {(field) => (
              <field.SelectField
                label={t('rows.children')}
                list="children_acceptance"
                variant="radio"
                radioLayout="cards"
                required
              />
            )}
          </form.AppField>,
        )}
        {row(
          'caste',
          'caste_importance',
          t('rows.caste'),
          <form.AppField name="caste_codes">
            {(field) => (
              <field.MultiSelectField
                label={t('rows.caste')}
                options={casteOptions}
                max={30}
                emptyLabel={t('any')}
              />
            )}
          </form.AppField>,
        )}
        {row(
          'mother_tongue',
          'mother_tongue_importance',
          t('rows.mother_tongue'),
          <form.AppField name="mother_tongue_codes">
            {(field) => (
              <field.MultiSelectField
                label={t('rows.mother_tongue')}
                list="languages"
                emptyLabel={t('any')}
              />
            )}
          </form.AppField>,
        )}
        {row(
          'profession',
          'profession_importance',
          t('rows.profession'),
          <div className="flex flex-col gap-4">
            {chips('employment_types', t('rows.employment'), list('employment_type'))}
            <form.AppField name="profession_codes">
              {(field) => (
                <field.MultiSelectField
                  label={t('rows.profession_list')}
                  list="profession_categories"
                  max={20}
                  emptyLabel={t('any')}
                />
              )}
            </form.AppField>
          </div>,
        )}
        {row(
          'income',
          'income_importance',
          t('rows.income'),
          <form.AppField name="income_min_rank">
            {(field) => (
              <field.SelectField
                label={t('rows.income')}
                options={incomeOptions}
                placeholder={t('any')}
                variant="native"
              />
            )}
          </form.AppField>,
        )}
        {row(
          'religiosity',
          'religiosity_importance',
          t('rows.religiosity'),
          chips('religiosity_levels', t('rows.religiosity'), list('religiosity')),
        )}
        {row(
          'appearance',
          'appearance_importance',
          female ? t('rows.appearance_beard') : t('rows.appearance_hijab'),
          female
            ? chips('beard_types', t('rows.appearance_beard'), list('beard'))
            : chips('hijab_types', t('rows.appearance_hijab'), list('hijab')),
        )}
        {row(
          'family',
          'family_importance',
          t('rows.family'),
          <div className="flex flex-col gap-4">
            {chips('family_values', t('rows.family_values'), list('family_values'))}
            {chips('family_types', t('rows.family_types'), list('family_type'))}
          </div>,
        )}
        {row(
          'living_arrangement',
          'living_arrangement_importance',
          t('rows.living_arrangement'),
          chips('living_arrangements', t('rows.living_arrangement'), list('living_arrangement')),
        )}
        {row(
          'work_after_marriage',
          'work_after_marriage_importance',
          female ? t('rows.work_after_marriage_female') : t('rows.work_after_marriage_male'),
          chips(
            'work_after_marriage_options',
            female ? t('rows.work_after_marriage_female') : t('rows.work_after_marriage_male'),
            list('work_after_marriage'),
          ),
        )}
        {row(
          'smoking',
          'smoking_importance',
          t('rows.smoking'),
          chips('smoking_options', t('rows.smoking'), list('smoking')),
        )}
        <div className="flex flex-col gap-2">
          <form.AppField name="notes">
            {(field) => (
              <field.TextAreaField
                label={t('notes_label')}
                helpText={t('notes_help')}
                maxLength={1000}
                rows={4}
              />
            )}
          </form.AppField>
          {profile.data ? <TextStatusNote status={profile.data.text_status.partner_notes} /> : null}
        </div>
      </Disclosure>

      <p
        ref={summaryRef}
        aria-live="polite"
        className="sticky bottom-[var(--bottom-nav,0px)] z-10 border-t border-border bg-background py-3 text-label-md"
      >
        {t('must_summary', { count: musts })}
      </p>
    </FormShell>
  )
}
