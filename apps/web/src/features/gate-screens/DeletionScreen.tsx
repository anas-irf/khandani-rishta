// GATE-DELETION (16 section 6.2, 06 sections 9.1 and 9.3)
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { Button } from '~/components/ui/button'
import { useCancelDeletion } from '~/features/settings/queries'
import { formatLongDateInZone } from '~/features/settings/zone-date'
import { useCurrentMe } from '~/lib/me'
import { GateLayout } from './GateLayout'
import { useGateRefresh } from './queries'

export function DeletionScreen() {
  const { t } = useTranslation('gate')
  const me = useCurrentMe()
  const online = useOnlineStatus()
  const cancel = useCancelDeletion()
  useGateRefresh()

  const date = me.user.purge_after
    ? formatLongDateInZone(me.user.purge_after, me.user.timezone)
    : ''

  return (
    <GateLayout title={t('deletion.title')}>
      <p className="text-body-lg">
        {date ? t('deletion.text', { date }) : t('deletion.text_no_date')}
      </p>
      <p className="text-foreground-secondary">{t('deletion.hidden')}</p>
      <div className="flex flex-wrap">
        <Button
          size="lg"
          fill="row"
          loading={cancel.isPending}
          disabled={!online}
          onClick={() =>
            cancel.mutate(undefined, {
              // The returned `Me` is in the cache; `AuthGate` routes by its gate.
              onSuccess: (result) => {
                if (result) toast.success(t('deletion.welcome_back'))
              },
            })
          }
        >
          {t('deletion.keep')}
        </Button>
      </div>
    </GateLayout>
  )
}
