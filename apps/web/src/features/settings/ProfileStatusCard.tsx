import { useTranslation } from 'react-i18next'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { Button } from '~/components/ui/button'
import { useCurrentMe } from '~/lib/me'
import type { AccountDialog } from './AccountDialogs'
import { SettingsGroup } from './controls'
import { useNikahCheck, useResumeProfile } from './queries'

type StatusLine = 'active' | 'paused' | 'closed' | 'not_live'

/** The status line of 08 section 7. */
export function statusLineOf(status: string): StatusLine {
  if (status === 'active' || status === 'paused' || status === 'closed') return status
  return 'not_live'
}

/**
 * "Profile status" (16 section 6.27 group 3, 08 section 7): the status in words and the actions
 * allowed from it. Pause, close and reopen ask first; resume does not.
 */
export function ProfileStatusCard({ onOpen }: { onOpen: (dialog: AccountDialog) => void }) {
  const { t } = useTranslation('settings')
  const me = useCurrentMe()
  const online = useOnlineStatus()
  const resume = useResumeProfile()
  const status = me.profile.status
  const closed = status === 'closed'
  // The reopen dialog depends on whether a nikah was confirmed (08 section 7.4).
  const nikah = useNikahCheck(closed)

  return (
    <SettingsGroup title={t('account.status.title')}>
      <p data-profile-status={status}>{t(`account.status.line.${statusLineOf(status)}`)}</p>
      <div className="flex flex-wrap gap-3">
        {status === 'active' ? (
          <Button variant="secondary" disabled={!online} onClick={() => onOpen('pause')}>
            {t('account.status.pause.action')}
          </Button>
        ) : null}
        {status === 'paused' ? (
          <Button
            variant="secondary"
            loading={resume.isPending}
            disabled={!online}
            onClick={() => resume.mutate()}
          >
            {t('account.status.resume.action')}
          </Button>
        ) : null}
        {status === 'active' || status === 'paused' ? (
          <Button variant="secondary" disabled={!online} onClick={() => onOpen('close')}>
            {t('account.status.close.action')}
          </Button>
        ) : null}
        {closed ? (
          <Button
            variant="secondary"
            loading={nikah.isPending}
            disabled={!online}
            onClick={() => onOpen('reopen')}
          >
            {t('account.status.reopen.action')}
          </Button>
        ) : null}
      </div>
    </SettingsGroup>
  )
}
