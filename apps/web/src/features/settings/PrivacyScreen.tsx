// SET-PRIVACY (16 section 6.25, 09 section 3)
import { Link } from '@tanstack/react-router'
import { Eye } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '~/components/common/ConfirmDialog'
import { ErrorState } from '~/components/common/ErrorState'
import { PageHeader } from '~/components/common/PageHeader'
import { SectionCard } from '~/components/common/SectionCard'
import { useOwnProfile } from '~/features/profile-sections/queries'
import type { Privacy } from '~/lib/api-types'
import { useCurrentMe } from '~/lib/me'
import {
  type RadioCardOption,
  type SaveState,
  SettingRadioCards,
  SettingSelect,
  SettingSwitch,
  SettingsPage,
  SettingsSkeleton,
} from './controls'
import { nameExamples } from './name-examples'
import { usePrivacy, useUpdatePrivacy } from './queries'
import { toastSaveFailure } from './save-errors'

/**
 * Where "Preview how others see the profile" opens. The preview (08 section 4) is part of
 * `ME-PROFILE`; keep this in one place until it has a URL of its own.
 */
const PREVIEW_PATH = '/me'

const SAVED_MARK_MS = 2500

type PrivacyKey = keyof Privacy

/**
 * Saves one setting at a time with `PATCH /v1/me/privacy` carrying only its key (16 section
 * 6.25). Not optimistic: while a request runs the control shows a spinner and is disabled, on
 * success it shows the new value and a brief "Saved", on failure it keeps the old value and a
 * toast says so.
 */
function usePrivacySaver() {
  const { t } = useTranslation('settings')
  const update = useUpdatePrivacy()
  const [states, setStates] = useState<Partial<Record<PrivacyKey, SaveState>>>({})
  const timers = useRef(new Map<PrivacyKey, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending.values()) clearTimeout(timer)
    }
  }, [])

  const setState = useCallback((key: PrivacyKey, state: SaveState) => {
    setStates((current) => ({ ...current, [key]: state }))
  }, [])

  const save = useCallback(
    async <K extends PrivacyKey>(key: K, value: Privacy[K]) => {
      setState(key, 'saving')
      const previousTimer = timers.current.get(key)
      if (previousTimer) clearTimeout(previousTimer)
      try {
        await update.mutateAsync({ [key]: value } as Partial<Privacy>)
        setState(key, 'saved')
        timers.current.set(
          key,
          setTimeout(() => setState(key, 'idle'), SAVED_MARK_MS),
        )
      } catch (error) {
        setState(key, 'idle')
        toastSaveFailure(error, t('saving.failed'))
      }
    },
    [update, setState, t],
  )

  return { save, stateOf: (key: PrivacyKey): SaveState => states[key] ?? 'idle' }
}

const DISCOVERY: Privacy['discovery_visibility'][] = ['everyone', 'preference_match', 'hidden']
const INTEREST: Privacy['interest_permission'][] = ['everyone', 'verified_only', 'preference_match']
const NAME_DISPLAY: Privacy['name_display'][] = [
  'full_name',
  'first_name_last_initial',
  'first_name_only',
  'initials',
  'code_only',
]
const PHOTO_VISIBILITY: Privacy['photo_visibility'][] = [
  'members',
  'interests_and_connections',
  'connections',
  'approved_only',
]
const DETAIL_KEYS = [
  'caste_visibility',
  'income_visibility',
  'family_visibility',
  'career_details_visibility',
  'home_visibility',
  'area_visibility',
  'health_visibility',
] as const
const ACTIVITY_KEYS = [
  'show_last_active',
  'show_online_status',
  'record_my_visits',
  'send_read_receipts',
] as const
const VISIBILITY_VALUES = ['members', 'connections', 'nobody'] as const

export function PrivacyScreen() {
  const { t } = useTranslation('settings')
  const query = usePrivacy()

  return (
    <SettingsPage>
      <PageHeader title={t('privacy.title')} backTo="/settings" />
      {query.isPending ? (
        <SettingsSkeleton groups={4} />
      ) : query.isError ? (
        <ErrorState
          error={query.error}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      ) : (
        <PrivacyGroups privacy={query.data} />
      )}
    </SettingsPage>
  )
}

function PrivacyGroups({ privacy }: { privacy: Privacy }) {
  const { t } = useTranslation('settings')
  const me = useCurrentMe()
  const profile = useOwnProfile()
  const { save, stateOf } = usePrivacySaver()
  const [confirmHidden, setConfirmHidden] = useState(false)

  const examples = nameExamples(
    me.profile.first_name,
    profile.data?.basics.last_name,
    me.profile.public_code,
  )
  const withMustHaves = (value: string): RadioCardOption['extra'] =>
    value === 'preference_match' ? (
      <Link to="/me/preferences" className="text-sm font-medium text-primary underline">
        {t('privacy.review_must_haves')}
      </Link>
    ) : undefined

  const discoveryOptions: RadioCardOption[] = DISCOVERY.map((value) => ({
    value,
    label: t(`privacy.fields.discovery_visibility.options.${value}.label`),
    help: t(`privacy.fields.discovery_visibility.options.${value}.help`),
    extra: withMustHaves(value),
  }))
  const interestOptions: RadioCardOption[] = INTEREST.map((value) => ({
    value,
    label: t(`privacy.fields.interest_permission.options.${value}.label`),
    help: t(`privacy.fields.interest_permission.options.${value}.help`),
    extra: withMustHaves(value),
  }))
  const nameOptions: RadioCardOption[] = NAME_DISPLAY.map((value) => ({
    value,
    label: t(`privacy.fields.name_display.options.${value}`),
    help: examples[value]
      ? t('privacy.fields.name_display.example', { example: examples[value] })
      : undefined,
  }))
  const photoOptions: RadioCardOption[] = PHOTO_VISIBILITY.map((value) => ({
    value,
    label: t(`privacy.fields.photo_visibility.options.${value}.label`),
    help: t(`privacy.fields.photo_visibility.options.${value}.help`),
  }))
  const visibilityOptions = VISIBILITY_VALUES.map((value) => ({
    value,
    label: t(`privacy.visibility_options.${value}`),
  }))

  return (
    <>
      <Link
        to={PREVIEW_PATH}
        className="inline-flex min-h-11 items-center gap-2 self-start rounded-md font-medium text-primary underline-offset-4 hover:underline"
      >
        <Eye aria-hidden="true" className="size-5" />
        {t('privacy.preview_link')}
      </Link>

      <SectionCard title={t('privacy.groups.find')}>
        <SettingRadioCards
          title={t('privacy.fields.discovery_visibility.title')}
          value={privacy.discovery_visibility}
          options={discoveryOptions}
          state={stateOf('discovery_visibility')}
          onChange={(value) => {
            const next = value as Privacy['discovery_visibility']
            if (next === 'hidden') setConfirmHidden(true)
            else void save('discovery_visibility', next)
          }}
        />
        <SettingRadioCards
          title={t('privacy.fields.interest_permission.title')}
          value={privacy.interest_permission}
          options={interestOptions}
          state={stateOf('interest_permission')}
          onChange={(value) =>
            void save('interest_permission', value as Privacy['interest_permission'])
          }
        />
      </SectionCard>

      <SectionCard title={t('privacy.groups.name_photos')}>
        <SettingRadioCards
          title={t('privacy.fields.name_display.title')}
          value={privacy.name_display}
          options={nameOptions}
          state={stateOf('name_display')}
          note={t('privacy.fields.name_display.note')}
          onChange={(value) => void save('name_display', value as Privacy['name_display'])}
        />
        <SettingRadioCards
          title={t('privacy.fields.photo_visibility.title')}
          value={privacy.photo_visibility}
          options={photoOptions}
          state={stateOf('photo_visibility')}
          note={t('privacy.fields.photo_visibility.note')}
          onChange={(value) => void save('photo_visibility', value as Privacy['photo_visibility'])}
        />
        <SettingSwitch
          label={t('privacy.fields.allow_photo_requests.title')}
          help={t('privacy.fields.allow_photo_requests.help')}
          checked={privacy.allow_photo_requests}
          state={stateOf('allow_photo_requests')}
          onCheckedChange={(checked) => void save('allow_photo_requests', checked)}
        />
        {me.gate === 'ok' ? (
          <Link
            to="/photo-requests"
            search={{ box: 'received' }}
            className="inline-flex min-h-11 items-center self-start rounded-md font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('privacy.photo_requests_link')}
          </Link>
        ) : null}
      </SectionCard>

      <SectionCard title={t('privacy.groups.details')}>
        {DETAIL_KEYS.map((key) => (
          <SettingSelect
            key={key}
            label={t(`privacy.fields.${key}.title`)}
            help={t(`privacy.fields.${key}.help`)}
            value={privacy[key]}
            options={visibilityOptions}
            state={stateOf(key)}
            onChange={(value) => void save(key, value as Privacy[typeof key])}
          />
        ))}
        <p className="text-sm text-muted-foreground">{t('privacy.details_note')}</p>
      </SectionCard>

      <SectionCard title={t('privacy.groups.activity')}>
        {ACTIVITY_KEYS.map((key) => (
          <SettingSwitch
            key={key}
            label={t(`privacy.fields.${key}.title`)}
            help={t(`privacy.fields.${key}.help`)}
            checked={privacy[key]}
            state={stateOf(key)}
            onCheckedChange={(checked) => void save(key, checked)}
          />
        ))}
      </SectionCard>

      <ConfirmDialog
        open={confirmHidden}
        onOpenChange={setConfirmHidden}
        title={t('privacy.hide_dialog.title')}
        description={t('privacy.hide_dialog.text')}
        confirmLabel={t('privacy.hide_dialog.confirm')}
        onConfirm={() => save('discovery_visibility', 'hidden')}
      />
    </>
  )
}
