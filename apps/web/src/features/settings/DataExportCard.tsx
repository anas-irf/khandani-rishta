import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorState } from '~/components/common/ErrorState'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { SectionCard } from '~/components/common/SectionCard'
import { Button, buttonVariants } from '~/components/ui/button'
import { Skeleton } from '~/components/ui/skeleton'
import { formatDate } from '~/lib/format'
import { cn } from '~/lib/utils'
import { useDataExport, useRequestExport } from './queries'

/**
 * "Your data" (16 section 6.27, 09 section 12.1): the state of the latest export and the control
 * for it. A request is possible once every 24 hours (the limit dialog explains otherwise); while
 * the file is being prepared the state is refetched every 15 seconds.
 */
export function DataExportCard() {
  const { t } = useTranslation('settings')
  const online = useOnlineStatus()
  const query = useDataExport()
  const request = useRequestExport()

  const requestButton = (label: string, variant: 'default' | 'secondary' = 'default') => (
    <Button
      variant={variant}
      loading={request.isPending}
      disabled={!online}
      onClick={() => request.mutate()}
    >
      {label}
    </Button>
  )

  let content: ReactNode
  if (query.isPending) {
    content = (
      <div role="status" aria-busy="true" className="flex flex-col gap-3">
        <span className="sr-only">{t('saving.working')}</span>
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-11 w-44 rounded-[var(--radius-input)]" />
      </div>
    )
  } else if (query.isError) {
    content = (
      <ErrorState
        error={query.error}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    )
  } else {
    const latest = query.data
    switch (latest?.status) {
      case 'queued':
        content = <p data-export-status="queued">{t('account.data.queued')}</p>
        break
      case 'ready':
        content = (
          <>
            <p data-export-status="ready">
              {t('account.data.ready', {
                date: latest.expires_at ? formatDate(latest.expires_at) : '',
              })}
            </p>
            <div className="flex flex-wrap gap-2">
              {latest.download_url ? (
                <a
                  href={latest.download_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(buttonVariants({ variant: 'default' }))}
                >
                  {t('account.data.download')}
                </a>
              ) : null}
              {requestButton(t('account.data.request_new'), 'secondary')}
            </div>
          </>
        )
        break
      case 'failed':
        content = (
          <>
            <p data-export-status="failed">{t('account.data.failed')}</p>
            {requestButton(t('account.data.try_again'))}
          </>
        )
        break
      case 'expired':
        content = (
          <>
            <p data-export-status="expired">{t('account.data.expired')}</p>
            {requestButton(t('account.data.request'))}
          </>
        )
        break
      default:
        content = (
          <>
            <p data-export-status="none">{t('account.data.none')}</p>
            {requestButton(t('account.data.request'))}
          </>
        )
    }
  }

  return <SectionCard title={t('account.data.title')}>{content}</SectionCard>
}
