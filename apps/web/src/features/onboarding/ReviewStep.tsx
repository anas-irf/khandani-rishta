// ONB-11 (07 section 14): review every answer, then "Create my profile".
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Lock, Pencil, Plus, TriangleAlert } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ErrorState } from '~/components/common/ErrorState'
import { FormSkeleton } from '~/components/common/FormSkeleton'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { PlainText } from '~/components/common/PlainText'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { useIdentity } from '~/features/identity/queries'
import { usePrivacy } from '~/features/me/queries'
import { useOwnPhotos } from '~/features/photos/queries'
import { usePreferences } from '~/features/preferences/queries'
import { DIMENSIONS, hasPreference, preferencesToValues } from '~/features/preferences/schemas'
import { stepForField } from '~/features/profile-sections/field-steps'
import { FormControlsProvider, InlineFailure } from '~/features/profile-sections/form-shell'
import { useOnboardingComplete, useOwnProfile } from '~/features/profile-sections/queries'
import { isWorking } from '~/features/profile-sections/schemas'
import { isApiError } from '~/lib/api'
import type { OwnPhoto, OwnProfile, Preferences, Privacy } from '~/lib/api-types'
import { ageFromDateOfBirth, formatHeight, formatHeightShort, formatLongDate } from '~/lib/format'
import { gateHome } from '~/lib/gate'
import { meQueryOptions } from '~/lib/me'
import { useLabelOf, useReference } from '~/lib/reference'
import { toSlug } from '~/lib/utils'
import { setCompletionErrors } from './completion-errors'
import { trackCompleted } from './funnel'
import { StepFooter } from './StepFooter'
import { useStepFlow } from './useStepFlow'

type Row = { label: string; value: string | null | undefined; private?: boolean }

export function ReviewStep() {
  const profile = useOwnProfile()
  const preferences = usePreferences()
  const privacy = usePrivacy()
  const identity = useIdentity()
  const photos = useOwnPhotos()
  const queries = [profile, preferences, privacy, identity, photos]
  const failed = queries.find((query) => query.isError)
  if (failed) {
    return (
      <ErrorState
        error={failed.error}
        onRetry={() => {
          for (const query of queries) if (query.isError) void query.refetch()
        }}
        retrying={queries.some((query) => query.isFetching)}
      />
    )
  }
  if (!profile.data || !preferences.data || !privacy.data || identity.isPending || !photos.data) {
    return <FormSkeleton fields={6} />
  }
  return (
    <Review
      profile={profile.data}
      preferences={preferences.data}
      privacy={privacy.data}
      identity={identity.data ?? null}
      photos={photos.data}
    />
  )
}

function Review({
  profile,
  preferences,
  privacy,
  identity,
  photos,
}: {
  profile: OwnProfile
  preferences: Preferences
  privacy: Privacy
  identity: OwnProfile['identity']
  photos: OwnPhoto[]
}) {
  const { t, i18n } = useTranslation(['onboarding', 'profile_sections', 'preferences', 'photos'])
  const label = useLabelOf()
  const reference = useReference()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const flow = useStepFlow()
  const online = useOnlineStatus()
  const complete = useOnboardingComplete()
  const [failure, setFailure] = useState<unknown>(null)
  const {
    account_for,
    basics,
    community,
    location,
    education_career: education,
    family,
    lifestyle,
  } = profile
  const rowLabel = (key: string) => t(`onboarding:review.labels.${key}`)
  const sectionLabel = (key: string) => t(`profile_sections:${key}`)

  const finish = async () => {
    setFailure(null)
    try {
      const me = await complete.mutateAsync()
      trackCompleted(me.gate)
      // `Me` is already replaced; the history entry is replaced so Back cannot return here.
      const target =
        me.gate === 'ok'
          ? '/onboarding/done'
          : me.gate === 'pending_review'
            ? '/account/review'
            : gateHome(me)
      await navigate({ to: target, replace: true })
    } catch (error) {
      if (isApiError(error) && error.code === 'validation_failed') {
        const first = error.fields[0]
        const step = first ? stepForField(first.field) : null
        toast.error(t('onboarding:review.missing'))
        if (step) {
          setCompletionErrors(step, error.fields)
          await navigate({
            to: '/onboarding/$step',
            params: { step: toSlug(step) },
            search: { edit: true },
          })
        }
        return
      }
      if (isApiError(error) && error.code === 'invalid_state') {
        const fresh = await queryClient.fetchQuery({ ...meQueryOptions(), staleTime: 0 })
        await navigate({ to: gateHome(fresh), replace: true })
        return
      }
      if (!isApiError(error) || !['account_banned', 'account_suspended'].includes(error.code)) {
        setFailure(error)
      }
    }
  }

  const names = (list: string, codes: string[]) => codes.map((code) => label(list, code)).join(', ')
  const working = isWorking(education.employment_type)
  const casteName = community.caste_code
    ? label('castes', community.caste_code)
    : community.caste_other
  const subCasteName = community.sub_caste_code
    ? label('sub_castes', community.sub_caste_code)
    : community.sub_caste_other
  const children =
    basics.marital_status && basics.marital_status !== 'never_married' && basics.children_status
      ? basics.children_count
        ? t('onboarding:review.labels.children_value', {
            status: label('children_status', basics.children_status),
            count: basics.children_count,
          })
        : label('children_status', basics.children_status)
      : null
  const siblings = (count: number | null, married: number | null) =>
    count == null
      ? null
      : married != null && count > 0
        ? t('onboarding:review.labels.siblings_value', { count, married })
        : String(count)

  const familyRows: Row[] = [
    {
      label: sectionLabel('family.father_status_label'),
      value: label('parent_status', family.father_status),
    },
    { label: sectionLabel('family.father_occupation_label'), value: family.father_occupation },
    {
      label: sectionLabel('family.mother_status_label'),
      value: label('parent_status', family.mother_status),
    },
    { label: sectionLabel('family.mother_occupation_label'), value: family.mother_occupation },
    {
      label: sectionLabel('family.brothers_count_label'),
      value: siblings(family.brothers_count, family.brothers_married),
    },
    {
      label: sectionLabel('family.sisters_count_label'),
      value: siblings(family.sisters_count, family.sisters_married),
    },
    {
      label: sectionLabel('family.family_type_label'),
      value: label('family_type', family.family_type),
    },
    {
      label: sectionLabel('family.family_class_label'),
      value: label('family_class', family.family_class),
    },
    {
      label: sectionLabel('family.family_values_label'),
      value: label('family_values', family.family_values),
    },
    {
      label: sectionLabel('family.family_country_label'),
      value: label('countries', family.family_country_code),
    },
    {
      label: sectionLabel('family.home_ownership_label'),
      value: label('home_ownership', family.home_ownership),
      private: true,
    },
    {
      label: sectionLabel('family.home_type_label'),
      value: label('home_type', family.home_type),
      private: true,
    },
    {
      label: sectionLabel('family.home_size_label'),
      value:
        family.home_size_value != null
          ? `${family.home_size_value} ${label('home_size_unit', family.home_size_unit)}`
          : null,
      private: true,
    },
    { label: sectionLabel('family.about_family_label'), value: family.about_family },
  ]
  const lifestyleRows: Row[] = [
    { label: rowLabel('religiosity'), value: label('religiosity', lifestyle.religiosity) },
    {
      label: rowLabel('prayer_frequency'),
      value: label('prayer_frequency', lifestyle.prayer_frequency),
    },
    { label: rowLabel('hijab'), value: label('hijab', lifestyle.hijab) },
    { label: rowLabel('beard'), value: label('beard', lifestyle.beard) },
    {
      label: rowLabel('religious_education'),
      value: label('religious_education', lifestyle.religious_education),
    },
    { label: rowLabel('smoking'), value: label('smoking', lifestyle.smoking) },
    {
      label: rowLabel('living_arrangement'),
      value: label('living_arrangement', lifestyle.living_arrangement),
    },
    {
      label: rowLabel('work_after_marriage'),
      value: label('work_after_marriage', lifestyle.work_after_marriage),
    },
    {
      label: rowLabel('marriage_timeline'),
      value: label('marriage_timeline', lifestyle.marriage_timeline),
    },
    { label: rowLabel('jahez_stance'), value: label('jahez_stance', lifestyle.jahez_stance) },
    {
      label: rowLabel('weight'),
      value:
        lifestyle.weight_kg != null
          ? t('onboarding:review.labels.weight_value', { kg: lifestyle.weight_kg })
          : null,
    },
    { label: rowLabel('complexion'), value: label('complexion', lifestyle.complexion) },
    { label: rowLabel('body_type'), value: label('body_type', lifestyle.body_type) },
    {
      label: rowLabel('blood_group'),
      value: label('blood_group', lifestyle.blood_group),
      private: true,
    },
    {
      label: rowLabel('disability'),
      value: [label('disability', lifestyle.disability), lifestyle.disability_details]
        .filter(Boolean)
        .join(': '),
      private: true,
    },
    { label: rowLabel('hobbies'), value: names('hobbies', lifestyle.hobby_codes) },
    {
      label: rowLabel('about_me'),
      value: lifestyle.about_me ? lifestyle.about_me.slice(0, 200) : null,
    },
  ]
  const lookingFor = lookingForLines(preferences, profile, {
    t: (key, values) => t(key, values ?? {}),
    label,
    reference,
    language: i18n.language,
  })

  return (
    <FormControlsProvider
      value={{
        mode: 'onboarding',
        isDirty: false,
        isSubmitting: complete.isPending,
        submit: finish,
      }}
    >
      <div className="flex flex-col gap-4">
        <ReviewCard step="account_for" title={t('onboarding:review.cards.account_for')}>
          <Rows
            rows={[
              { label: rowLabel('managed_by'), value: label('managed_by', account_for.managed_by) },
              {
                label: rowLabel('manager_name'),
                value: account_for.managed_by === 'self' ? null : account_for.manager_name,
              },
            ]}
          />
        </ReviewCard>
        <ReviewCard step="basics" title={t('onboarding:review.cards.basics')}>
          <Rows
            rows={[
              {
                label: rowLabel('full_name'),
                value: [basics.first_name, basics.last_name].filter(Boolean).join(' '),
              },
              { label: rowLabel('gender'), value: label('gender', basics.gender) },
              {
                label: rowLabel('date_of_birth'),
                value: basics.date_of_birth
                  ? t('onboarding:review.labels.date_of_birth_value', {
                      date: formatLongDate(basics.date_of_birth),
                      age: ageFromDateOfBirth(basics.date_of_birth),
                    })
                  : null,
              },
              {
                label: rowLabel('marital_status'),
                value: label('marital_status', basics.marital_status),
              },
              {
                label: rowLabel('current_wives_count'),
                value:
                  basics.marital_status === 'married' && basics.current_wives_count != null
                    ? String(basics.current_wives_count)
                    : null,
              },
              { label: rowLabel('children'), value: children },
              {
                label: rowLabel('height'),
                value: basics.height_cm ? formatHeight(basics.height_cm) : null,
              },
            ]}
          />
        </ReviewCard>
        <ReviewCard step="community" title={t('onboarding:review.cards.community')}>
          <Rows
            rows={[
              { label: rowLabel('religion'), value: label('religions', community.religion_code) },
              { label: rowLabel('sect'), value: label('sects', community.sect_code) },
              { label: rowLabel('caste'), value: casteName },
              { label: rowLabel('sub_caste'), value: subCasteName },
              {
                label: rowLabel('mother_tongue'),
                value: label('languages', community.mother_tongue_code),
              },
              { label: rowLabel('languages'), value: names('languages', community.language_codes) },
            ]}
          />
        </ReviewCard>
        <ReviewCard step="location" title={t('onboarding:review.cards.location')}>
          <Rows
            rows={[
              { label: rowLabel('city'), value: location.city?.name ?? location.city_other },
              { label: rowLabel('region'), value: location.city?.region_name ?? null },
              { label: rowLabel('country'), value: label('countries', location.country_code) },
              { label: rowLabel('area'), value: location.area, private: true },
              {
                label: rowLabel('nationality'),
                value: label('countries', location.nationality_code),
              },
              {
                label: rowLabel('residency'),
                value:
                  location.country_code !== location.nationality_code
                    ? label('residency_status', location.residency_status)
                    : null,
              },
              {
                label: rowLabel('origin'),
                value: location.origin_city?.name ?? location.origin_other,
              },
              { label: rowLabel('relocation'), value: label('relocation', location.relocation) },
            ]}
          />
        </ReviewCard>
        <ReviewCard step="education_career" title={t('onboarding:review.cards.education_career')}>
          <Rows
            rows={[
              {
                label: rowLabel('education_level'),
                value: label('education_levels', education.education_level_code),
              },
              {
                label: rowLabel('education_field'),
                value: label('education_fields', education.education_field_code),
              },
              { label: rowLabel('degree_title'), value: education.degree_title },
              { label: rowLabel('institute_name'), value: education.institute_name, private: true },
              {
                label: rowLabel('employment_type'),
                value: label('employment_type', education.employment_type),
              },
              {
                label: rowLabel('profession'),
                value: working ? label('profession_categories', education.profession_code) : null,
              },
              { label: rowLabel('job_title'), value: working ? education.job_title : null },
              {
                label: rowLabel('employer_name'),
                value: working ? education.employer_name : null,
                private: true,
              },
              {
                label: rowLabel('income'),
                value: working ? label('income_bands', education.income_band_code) : null,
                private: true,
              },
            ]}
          />
        </ReviewCard>
        <ReviewCard
          step="family"
          title={t('onboarding:review.cards.family')}
          empty={!hasRows(familyRows)}
        >
          {hasRows(familyRows) ? (
            <Rows rows={familyRows} />
          ) : (
            <NotAdded text={t('onboarding:review.not_added_yet')} />
          )}
        </ReviewCard>
        <ReviewCard
          step="lifestyle"
          title={t('onboarding:review.cards.lifestyle')}
          empty={!hasRows(lifestyleRows)}
        >
          {hasRows(lifestyleRows) ? (
            <Rows rows={lifestyleRows} />
          ) : (
            <NotAdded text={t('onboarding:review.not_added_yet')} />
          )}
        </ReviewCard>
        <ReviewCard
          step="photos"
          title={t('onboarding:review.cards.photos')}
          empty={photos.length === 0}
          description={t(`onboarding:photos.visibility.${privacy.photo_visibility}`)}
        >
          {photos.length > 0 ? (
            <ul className="grid grid-cols-3 gap-2">
              {photos.map((photo) => (
                <li
                  key={photo.id}
                  className="relative aspect-square overflow-hidden rounded-[var(--radius-input)] bg-muted"
                >
                  {photo.thumb_url ? (
                    <img
                      src={photo.thumb_url}
                      alt=""
                      width={120}
                      height={120}
                      draggable={false}
                      className="size-full object-cover"
                    />
                  ) : null}
                  {photo.status !== 'approved' || photo.is_primary ? (
                    <span className="absolute inset-x-0 bottom-0 bg-foreground/75 px-1.5 py-0.5 text-center text-xs text-background">
                      {photo.status === 'approved'
                        ? t('photos:status.main')
                        : t(`photos:status.${photo.status}`)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <NotAdded text={t('onboarding:review.no_photos')} />
          )}
        </ReviewCard>
        <ReviewCard step="preferences" title={t('onboarding:review.cards.preferences')}>
          <ul className="flex flex-col gap-1.5">
            {lookingFor.map((line) => (
              <li key={line.key} className="flex flex-wrap items-center gap-2">
                <span dir="auto">{line.text}</span>
                {line.must ? (
                  <Badge variant="secondary">{t('onboarding:review.must')}</Badge>
                ) : null}
              </li>
            ))}
          </ul>
        </ReviewCard>
        <ReviewCard step="identity" title={t('onboarding:review.cards.identity')} empty={!identity}>
          {identity ? (
            <Rows
              rows={[
                {
                  label: rowLabel('document'),
                  value: label('document_type', identity.document_type),
                },
                { label: rowLabel('number'), value: identity.number_masked },
              ]}
            />
          ) : (
            <NotAdded text={t('onboarding:review.not_added')} />
          )}
        </ReviewCard>

        <Alert variant="warning">
          <TriangleAlert aria-hidden="true" />
          <AlertDescription>{t('profile_sections:basics.warning')}</AlertDescription>
        </Alert>
        {failure ? (
          <InlineFailure
            error={failure}
            text={t('onboarding:failed')}
            onRetry={() => void finish()}
            retrying={complete.isPending}
          />
        ) : null}
        <div className="flex flex-col gap-3">
          <Button
            type="button"
            className="w-full md:w-auto md:self-start"
            loading={complete.isPending}
            disabled={!online}
            onClick={() => void finish()}
          >
            {t('onboarding:review.submit')}
          </Button>
          {flow.edit ? null : <StepFooter />}
        </div>
      </div>
    </FormControlsProvider>
  )
}

function hasRows(rows: Row[]): boolean {
  return rows.some((row) => row.value != null && row.value !== '')
}

function ReviewCard({
  step,
  title,
  description,
  empty = false,
  children,
}: {
  step: string
  title: string
  description?: string
  empty?: boolean
  children: ReactNode
}) {
  const { t } = useTranslation('onboarding')
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-lg font-semibold">{title}</h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        <Button asChild variant="ghost" className="-me-2 text-primary">
          <Link
            to="/onboarding/$step"
            params={{ step: toSlug(step) }}
            search={{ edit: true }}
            aria-label={
              empty
                ? t('review.add_label', { card: title })
                : t('review.edit_label', { card: title })
            }
          >
            {empty ? <Plus aria-hidden="true" /> : <Pencil aria-hidden="true" />}
            {empty ? t('review.add') : t('review.edit')}
          </Link>
        </Button>
      </header>
      {children}
    </section>
  )
}

function NotAdded({ text }: { text: string }) {
  return <p className="text-muted-foreground">{text}</p>
}

function Rows({ rows }: { rows: Row[] }) {
  const { t } = useTranslation('onboarding')
  const shown = rows.filter((row) => row.value != null && row.value !== '')
  return (
    <dl className="grid gap-2 sm:grid-cols-[minmax(0,12rem)_1fr] sm:gap-x-4">
      {shown.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-sm text-muted-foreground">{row.label}</dt>
          <dd className="flex items-start gap-1.5">
            <PlainText as="span" text={row.value} />
            {row.private ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center pt-1 text-muted-foreground">
                    <Lock aria-hidden="true" className="size-3.5" />
                    <span className="sr-only">{t('review.private')}</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t('review.private')}</TooltipContent>
              </Tooltip>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** One line per dimension that has a preference (07 section 14.1, "Looking for"). */
function lookingForLines(
  preferences: Preferences,
  profile: OwnProfile,
  helpers: {
    t: (key: string, values?: Record<string, unknown>) => string
    label: (list: string, code: string | null | undefined) => string
    reference: ReturnType<typeof useReference>
    language: string
  },
) {
  const { t, label, reference } = helpers
  const gender = profile.basics.gender
  const values = preferencesToValues(preferences)
  const join = (list: string, codes: (string | number)[]) =>
    codes.map((code) => label(list, String(code))).join(', ')
  const k = (key: string) => `onboarding:review.looking_for.${key}`
  const rankName = (rank: number | null) => {
    const level = reference.education_levels.find((entry) => entry.rank === rank)
    return level
      ? t('preferences:rows.education_option', { name: level.name.replace(/\s*\(.*\)\s*$/, '') })
      : ''
  }
  const incomeName = (rank: number | null) => {
    const band = reference.income_bands.find(
      (entry) => entry.currency_code === 'PKR' && entry.rank === rank,
    )
    const amount = band ? /\d[\d,]*/.exec(band.label)?.[0] : null
    return amount ? t('preferences:rows.income_option', { amount }) : ''
  }
  const text: Record<string, () => string> = {
    age: () => t(k('age'), { min: preferences.age_min, max: preferences.age_max }),
    marital_status: () =>
      t(k('marital_status'), { values: join('marital_status', preferences.marital_statuses) }),
    religion: () => t(k('religion'), { values: join('religions', preferences.religion_codes) }),
    sect: () => t(k('sect'), { values: join('sects', preferences.sect_codes) }),
    location: () => {
      const places = preferences.region_ids.length + preferences.city_ids.length
      const parts = [join('countries', preferences.country_codes)]
      if (places > 0) parts.push(t(k('places_count'), { count: places }))
      return t(k('location'), { values: parts.filter(Boolean).join(', ') })
    },
    education: () => t(k('education'), { value: rankName(preferences.education_min_rank) }),
    height: () => {
      const { height_min_cm: min, height_max_cm: max } = preferences
      const value =
        min != null && max != null
          ? `${formatHeightShort(min)} - ${formatHeightShort(max)}`
          : min != null
            ? t(k('height_from'), { min: formatHeightShort(min) })
            : t(k('height_to'), { max: formatHeightShort(max ?? 0) })
      return t(k('height'), { value })
    },
    children: () =>
      t(k('children'), { value: label('children_acceptance', preferences.children_acceptance) }),
    caste: () => t(k('caste'), { values: join('castes', preferences.caste_codes) }),
    mother_tongue: () =>
      t(k('mother_tongue'), { values: join('languages', preferences.mother_tongue_codes) }),
    profession: () =>
      t(k('profession'), {
        values: [
          join('employment_type', preferences.employment_types),
          join('profession_categories', preferences.profession_codes),
        ]
          .filter(Boolean)
          .join(', '),
      }),
    income: () => t(k('income'), { value: incomeName(preferences.income_min_rank) }),
    religiosity: () =>
      t(k('religiosity'), { values: join('religiosity', preferences.religiosity_levels) }),
    appearance: () =>
      gender === 'female'
        ? t(k('appearance_beard'), { values: join('beard', preferences.beard_types) })
        : t(k('appearance_hijab'), { values: join('hijab', preferences.hijab_types) }),
    family: () =>
      t(k('family'), {
        values: [
          join('family_values', preferences.family_values),
          join('family_type', preferences.family_types),
        ]
          .filter(Boolean)
          .join(', '),
      }),
    living_arrangement: () =>
      t(k('living_arrangement'), {
        values: join('living_arrangement', preferences.living_arrangements),
      }),
    work_after_marriage: () =>
      t(k('work_after_marriage'), {
        values: join('work_after_marriage', preferences.work_after_marriage_options),
      }),
    smoking: () => t(k('smoking'), { values: join('smoking', preferences.smoking_options) }),
  }
  return DIMENSIONS.filter((dimension) => hasPreference(dimension.key, values, gender)).map(
    (dimension) => ({
      key: dimension.key,
      text: text[dimension.key]?.() ?? dimension.key,
      must: preferences[dimension.importance] === 'must',
    }),
  )
}
