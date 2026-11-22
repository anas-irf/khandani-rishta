import { useTranslation } from 'react-i18next'
import { Band } from '~/components/common/Band'
import { ErrorState } from '~/components/common/ErrorState'
import { Skeleton } from '~/components/ui/skeleton'

/** A detail screen's record beside what is decided about it. */
export const detailGridClass = 'grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4'

/** A detail screen before it has its data: the skeleton, or the error with "Try again". */
export function DetailState({
  query,
}: {
  query: { isPending: boolean; error: unknown; refetch: () => Promise<unknown> }
}) {
  const { t } = useTranslation('admin')
  return (
    <Band as="div" className="flex-1">
      {query.isPending ? (
        <div role="status" aria-busy="true" className="flex flex-col gap-4">
          <span className="sr-only">{t('list.loading')}</span>
          <Skeleton className="h-12 w-1/2" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      )}
    </Band>
  )
}
