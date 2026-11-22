// SET-NOTIFS (16 section 6.26, 14 section 6)
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorState } from '~/components/common/ErrorState'
import { Page } from '~/components/common/Page'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { EMAIL_MATCH_DIGESTS, isOneOf } from '~/lib/api-enums'
import type { NotificationPreferences } from '~/lib/api-types'
import { useOptions } from '~/lib/reference'
import {
  type SaveState,
  SettingSelect,
  SettingSwitch,
  SettingsGroup,
  SettingsSkeleton,
} from './controls'
import {
  digestValue,
  type PreferenceSwitch,
  type PreferencesPatch,
  quietHoursOn,
  quietHoursToggle,
  quietTimeChange,
  switchValue,
  toTimeValue,
} from './notification-preferences'
import { useNotificationPreferences, useSaveNotificationPreferences } from './queries'
import { toastSaveFailure } from './save-errors'

/** Every change is sent as the complete object after this long without further changes. */
const SAVE_DELAY_MS = 500
const SAVED_MARK_MS = 2500

/**
 * The preferences as the member sees them while edits are waiting to be saved. Changes show at
 * once; the complete object is sent with `PUT` after 500 ms without further changes, and on
 * failure the screen goes back to the last saved values with a toast (16 section 6.26).
 */
function usePreferencesDraft(saved: NotificationPreferences) {
  const { t } = useTranslation('settings')
  const save = useSaveNotificationPreferences()
  const [draft, setDraft] = useState<NotificationPreferences | null>(null)
  const [state, setState] = useState<SaveState>('idle')
  const latest = useRef<NotificationPreferences | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const markTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const body = latest.current
    if (!body) return
    setState('saving')
    save.mutate(body, {
      onSuccess: () => {
        if (latest.current === body) {
          latest.current = null
          setDraft(null)
        }
        setState('saved')
        if (markTimer.current) clearTimeout(markTimer.current)
        markTimer.current = setTimeout(() => setState('idle'), SAVED_MARK_MS)
      },
      onError: (error) => {
        latest.current = null
        setDraft(null)
        setState('idle')
        toastSaveFailure(error, t('saving.failed'))
      },
    })
  }, [save, t])

  const flushRef = useRef(flush)
  flushRef.current = flush

  useEffect(
    () => () => {
      // Leaving the screen sends what is waiting instead of dropping it.
      if (timer.current) flushRef.current()
      if (markTimer.current) clearTimeout(markTimer.current)
    },
    [],
  )

  const change = useCallback(
    (patch: PreferencesPatch) => {
      const next = { ...(latest.current ?? saved), ...patch }
      latest.current = next
      setDraft(next)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => flushRef.current(), SAVE_DELAY_MS)
    },
    [saved],
  )

  return { preferences: draft ?? saved, change, state }
}

export function NotificationSettingsScreen() {
  const query = useNotificationPreferences()

  if (query.isSuccess) return <LoadedSettings saved={query.data} />
  return (
    <SettingsFrame>
      {query.isPending ? (
        <SettingsSkeleton groups={3} />
      ) : (
        <ErrorState
          error={query.error}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      )}
    </SettingsFrame>
  )
}

function SettingsFrame({
  layout,
  header,
  children,
}: {
  layout?: 'bands'
  header?: ReactNode
  children: ReactNode
}) {
  const { t } = useTranslation('settings')
  return (
    <Page
      title={t('notifications.title')}
      description={t('notifications.intro')}
      backTo="/settings"
      width="column"
      layout={layout}
      header={header}
    >
      {children}
    </Page>
  )
}

function LoadedSettings({ saved }: { saved: NotificationPreferences }) {
  const { t } = useTranslation('settings')
  const digestOptions = useOptions('email_match_digest')
  const { preferences, change, state } = usePreferencesDraft(saved)

  const toggle = (key: PreferenceSwitch, label: string) => (
    <SettingSwitch
      key={key}
      label={label}
      checked={switchValue(preferences, key)}
      onCheckedChange={(checked) => change({ [key]: checked })}
    />
  )

  const quietOn = quietHoursOn(preferences)
  const start = toTimeValue(preferences.quiet_hours_start) ?? ''
  const end = toTimeValue(preferences.quiet_hours_end) ?? ''

  return (
    <SettingsFrame layout="bands" header={<SaveStatusLine state={state} />}>
      <SettingsGroup title={t('notifications.push.title')}>
        <p className="text-caption text-muted-foreground">{t('notifications.push.web_note')}</p>
        {toggle('push_interests', t('notifications.push.interests'))}
        {toggle('push_messages', t('notifications.push.messages'))}
        {toggle('push_photo_requests', t('notifications.push.photo_requests'))}
        {toggle('push_matches', t('notifications.push.matches'))}
        {toggle('push_profile_views', t('notifications.push.profile_views'))}
      </SettingsGroup>

      <SettingsGroup title={t('notifications.email.title')}>
        {toggle('email_interests', t('notifications.email.interests'))}
        {toggle('email_messages', t('notifications.email.messages'))}
        <SettingSelect
          label={t('notifications.email.match_digest')}
          value={digestValue(preferences)}
          options={digestOptions.map((option) => ({ value: option.code, label: option.label }))}
          onChange={(value) => {
            if (isOneOf(EMAIL_MATCH_DIGESTS, value)) change({ email_match_digest: value })
          }}
        />
        {toggle('email_announcements', t('notifications.email.announcements'))}
        <p className="text-caption text-muted-foreground">{t('notifications.email.note')}</p>
      </SettingsGroup>

      <SettingsGroup title={t('notifications.quiet.title')}>
        <SettingSwitch
          label={t('notifications.quiet.switch')}
          checked={quietOn}
          onCheckedChange={(checked) => change(quietHoursToggle(checked))}
        />
        {quietOn ? (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-3">
            <TimeField
              label={t('notifications.quiet.from')}
              value={start}
              onChange={(value) => change(quietTimeChange('start', value))}
            />
            <TimeField
              label={t('notifications.quiet.to')}
              value={end}
              onChange={(value) => change(quietTimeChange('end', value))}
            />
          </div>
        ) : null}
        <p className="text-caption text-muted-foreground">{t('notifications.quiet.help')}</p>
      </SettingsGroup>
    </SettingsFrame>
  )
}

/** One live region for the whole screen: the spinner while saving, then "Saved". */
function SaveStatusLine({ state }: { state: SaveState }) {
  const { t } = useTranslation('settings')
  return (
    <p
      role="status"
      aria-live="polite"
      data-save-state={state}
      className="min-h-[22px] text-caption text-muted-foreground"
    >
      {state === 'saving' ? t('saving.working') : null}
      {state === 'saved' ? t('saving.saved') : null}
    </p>
  )
}

function TimeField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const id = useId()
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="time"
        step={60}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}
