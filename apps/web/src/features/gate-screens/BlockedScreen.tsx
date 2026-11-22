// GATE-BLOCKED (16 section 6.2, 06 sections 8.4 and 9.4)
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { Button, buttonVariants } from '~/components/ui/button'
import { DeleteAccountDialog } from '~/features/settings/DeleteAccountDialog'
import { formatLongDateInZone } from '~/features/settings/zone-date'
import { useCurrentMe } from '~/lib/me'
import { cn } from '~/lib/utils'
import { GateLayout, PublicPageLink } from './GateLayout'
import { useGateRefresh } from './queries'

/** The socket is closed while the account is blocked (19 section 4), so the screen polls. */
const POLL_MS = 60_000

export function BlockedScreen() {
  const { t } = useTranslation('gate')
  const me = useCurrentMe()
  const online = useOnlineStatus()
  const [deleting, setDeleting] = useState(false)
  useGateRefresh(POLL_MS)

  const banned = me.gate === 'banned'
  const { status_reason: reason, suspended_until: until, purge_after: purgeAfter } = me.user
  const timeZone = me.user.timezone

  // "Reason: {reason}. Your account will be available again on {date}." (suspended), or
  // "Reason: {reason}. If you believe this is a mistake, email us." (banned).
  const body = [
    reason ? t('blocked.reason', { reason }) : null,
    banned
      ? t('blocked.banned.mistake')
      : until
        ? t('blocked.suspended.until', { date: formatLongDateInZone(until, timeZone) })
        : null,
  ]
    .filter(Boolean)
    .join(' ')

  const code = me.profile.public_code
  const mailto = `mailto:${me.config.support_email}?subject=${encodeURIComponent(
    t('blocked.support_subject', { code }),
  )}`

  return (
    <GateLayout title={banned ? t('blocked.banned.title') : t('blocked.suspended.title')}>
      {body ? <p className="text-body-lg">{body}</p> : null}
      <p className="text-body-sm text-muted-foreground tabular-nums">
        {t('blocked.profile_code', { code })}
      </p>
      <div className="flex flex-wrap gap-x-5">
        <PublicPageLink to="/community-guidelines">{t('layout.guidelines')}</PublicPageLink>
        <PublicPageLink to="/terms">{t('layout.terms')}</PublicPageLink>
      </div>

      {purgeAfter ? (
        <p role="status" className="text-body-md font-semibold">
          {t('blocked.data_deletion', { date: formatLongDateInZone(purgeAfter, timeZone) })}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <a
          href={mailto}
          className={cn(buttonVariants({ variant: 'default', size: 'lg', fill: 'row' }))}
        >
          {t('blocked.contact_support')}
        </a>
        {purgeAfter ? null : (
          <Button
            variant="secondary"
            size="lg"
            fill="row"
            disabled={!online}
            onClick={() => setDeleting(true)}
          >
            {t('blocked.delete_data')}
          </Button>
        )}
      </div>

      <DeleteAccountDialog open={deleting} onOpenChange={setDeleting} />
    </GateLayout>
  )
}
