// ADM-ANNOUNCE: the home banner and the announcement notification (18 section 7.3).
import { Link } from '@tanstack/react-router'
import { Megaphone } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '~/components/common/ConfirmDialog'
import { Page } from '~/components/common/Page'
import { StatusBanner } from '~/components/common/StatusBanner'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { isApiError } from '~/lib/api'
import { RequireAdmin } from './access'
import { Panel } from './components/Facts'
import { CountedTextarea, FormField } from './components/FormField'
import { ErrorSummary, useDialogErrors } from './components/useDialogErrors'
import { validate } from './forms'
import { useAdminOverview, useAdminSettings, useSendAnnouncement } from './queries'
import { announcementSchema } from './schemas'
import { bannerText } from './settings-spec'
import type { AnnouncementBody } from './types'

export const ANNOUNCEMENT_CONFIRM_PHRASE = 'SEND'

export function AnnouncementsScreen() {
  return (
    <RequireAdmin>
      <Announcements />
    </RequireAdmin>
  )
}

function Announcements() {
  const { t } = useTranslation('admin')
  return (
    <Page title={t('announce.title')} description={t('announce.description')} width="column">
      <BannerPanel />
      <NotificationPanel />
    </Page>
  )
}

function BannerPanel() {
  const { t } = useTranslation('admin')
  const settings = useAdminSettings()
  const banner = bannerText(
    settings.data?.find((setting) => setting.key === 'announcement.banner')?.value,
  )

  return (
    <Panel
      title={t('announce.banner_title')}
      action={
        <Button asChild variant="secondary">
          <Link to="/admin/settings">{t('announce.banner_edit')}</Link>
        </Button>
      }
    >
      <p className="text-body-sm text-muted-foreground">{t('announce.banner_text')}</p>
      {banner ? (
        <StatusBanner variant="info" icon={Megaphone} title={t('announce.banner_current')}>
          {banner}
        </StatusBanner>
      ) : settings.isSuccess ? (
        <p className="text-body-sm">{t('announce.banner_none')}</p>
      ) : null}
    </Panel>
  )
}

function NotificationPanel() {
  const { t } = useTranslation('admin')
  const send = useSendAnnouncement()
  const overview = useAdminOverview()
  const [values, setValues] = useState({ text_en: '', text_ur: '', url: '' })
  const [confirming, setConfirming] = useState<AnnouncementBody | null>(null)
  const [sent, setSent] = useState<number | null>(null)
  const [limited, setLimited] = useState(false)
  const form = useDialogErrors(['text_en', 'text_ur', 'url'])
  const set = (key: keyof typeof values, value: string) =>
    setValues((previous) => ({ ...previous, [key]: value }))

  // Members who are active and whose profile is active or paused (18 section 7.3).
  const profiles = overview.data?.metrics.profiles_by_status
  const estimate = profiles ? profiles.active + profiles.paused : null

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    setSent(null)
    setLimited(false)
    const result = validate(announcementSchema, values, t)
    if (!result.ok) {
      form.setErrors(result.errors)
      return
    }
    form.clear()
    const data = result.data
    setConfirming({
      text_en: data.text_en,
      ...(data.text_ur ? { text_ur: data.text_ur } : {}),
      ...(data.url ? { url: data.url } : {}),
    })
  }

  const doSend = async (body: AnnouncementBody) => {
    try {
      const result = await send.mutateAsync(body)
      setSent(result.recipients_estimate)
      setValues({ text_en: '', text_ur: '', url: '' })
    } catch (error) {
      if (isApiError(error) && error.code === 'limit_reached') setLimited(true)
      else form.fail(error)
    }
  }

  return (
    <Panel title={t('announce.notification_title')}>
      <p className="text-body-sm text-muted-foreground">{t('announce.notification_text')}</p>
      {sent !== null ? (
        <StatusBanner variant="success">{t('announce.sent', { count: sent })}</StatusBanner>
      ) : null}
      {limited ? <StatusBanner variant="warning">{t('announce.limited')}</StatusBanner> : null}
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <ErrorSummary messages={form.rest} />
        <CountedTextarea
          label={t('announce.text_en')}
          error={form.errors.text_en}
          value={values.text_en}
          onChange={(value) => set('text_en', value)}
          max={300}
          rows={3}
          name="text_en"
        />
        <CountedTextarea
          label={t('announce.text_ur')}
          error={form.errors.text_ur}
          value={values.text_ur}
          onChange={(value) => set('text_ur', value)}
          max={300}
          rows={3}
          name="text_ur"
        />
        <FormField label={t('announce.url')} hint={t('announce.url_hint')} error={form.errors.url}>
          {(props) => (
            <Input
              {...props}
              name="url"
              type="url"
              dir="ltr"
              value={values.url}
              onChange={(event) => set('url', event.target.value)}
            />
          )}
        </FormField>
        <p className="text-body-sm text-muted-foreground">
          {estimate === null
            ? t('announce.estimate_unknown')
            : t('announce.estimate', { count: estimate })}
        </p>
        <div>
          <Button type="submit">{t('announce.send')}</Button>
        </div>
      </form>
      {confirming ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setConfirming(null)}
          title={t('announce.confirm_title')}
          description={t('announce.confirm_text', { count: estimate ?? 0 })}
          confirmLabel={t('announce.send')}
          confirmPhrase={ANNOUNCEMENT_CONFIRM_PHRASE}
          tone="danger"
          onConfirm={() => doSend(confirming)}
        />
      ) : null}
    </Panel>
  )
}
