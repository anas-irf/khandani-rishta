import { RefreshCw } from 'lucide-react'
import { type ReactNode, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { cn } from '~/lib/utils'
import { ErrorState } from './ErrorState'
import { ListSkeleton } from './ListSkeleton'

/** A page of a cursor-paginated list (15 section 1). Pages may carry more fields. */
export type ListPage<T> = { items: T[]; next_cursor: string | null }

/**
 * The parts of a TanStack `useInfiniteQuery` result the list uses. Any infinite query whose
 * pages are `{ items, next_cursor }` fits.
 */
export type InfiniteListQuery<T> = {
  data: { pages: readonly ListPage<T>[] } | undefined
  isPending: boolean
  isError: boolean
  error: unknown
  isFetching: boolean
  isFetchingNextPage: boolean
  isFetchNextPageError?: boolean
  hasNextPage: boolean
  fetchNextPage: () => Promise<unknown>
  refetch: () => Promise<unknown>
}

export type InfiniteListProps<T> = {
  query: InfiniteListQuery<T>
  renderItem: (item: T, index: number) => ReactNode
  getKey: (item: T) => string
  /** Shown when the list has no items (an `EmptyState` with the screen's copy). */
  empty?: ReactNode
  /** First-load placeholder (default: compact card skeletons). */
  skeleton?: ReactNode
  /** Changes what is shown of the loaded items (a passed card that keeps its place). */
  arrange?: (items: T[]) => T[]
  /** Shows the "Refresh" control on wide screens (16 rule G5). Default true. */
  refreshable?: boolean
  /** Accessible name of the list. */
  label?: string
  /** Classes of the `<ul>`, in place of the default column of rows (for example `card-grid`). */
  listClassName?: string
  /** Classes of each `<li>`, in place of the hairline under a row. */
  itemClassName?: string
  className?: string
}

/**
 * A list over an infinite query (17 section 10, 16 rules G1, G3, G5, G6): a skeleton on the first
 * load, `ErrorState` when it fails, the `empty` slot, then the items with infinite scroll. A
 * sentinel watched by `IntersectionObserver` loads the next page; a "Load more" button does the
 * same for keyboards and browsers without the observer. Nothing more is requested once
 * `next_cursor` is null.
 */
export function InfiniteList<T>({
  query,
  renderItem,
  getKey,
  empty = null,
  skeleton,
  arrange,
  refreshable = true,
  label,
  listClassName = 'flex flex-col',
  itemClassName = 'border-b border-border',
  className,
}: InfiniteListProps<T>) {
  const { t } = useTranslation('shared')
  const sentinel = useRef<HTMLDivElement | null>(null)
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = query
  const canLoadMore = hasNextPage && !isFetchingNextPage && !isFetchNextPageError

  // Latest values for the observer callback, without re-creating the observer each render.
  const latest = useRef({ canLoadMore, fetchNextPage })
  latest.current = { canLoadMore, fetchNextPage }

  const hasData = query.data !== undefined
  useEffect(() => {
    const node = sentinel.current
    if (!node || !hasData || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && latest.current.canLoadMore) {
          void latest.current.fetchNextPage()
        }
      },
      { rootMargin: '400px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasData])

  if (query.isPending && !query.data) {
    return <div className={className}>{skeleton ?? <ListSkeleton />}</div>
  }
  if (!query.data) {
    return (
      <div className={className}>
        <ErrorState
          error={query.error}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      </div>
    )
  }

  const loaded = query.data.pages.flatMap((page) => page.items)
  const items = arrange ? arrange(loaded) : loaded
  const refreshing = query.isFetching && !isFetchingNextPage
  const refresh = refreshable ? (
    <div className="hidden justify-end wide:flex">
      <Button
        variant="quiet"
        size="compact"
        onClick={() => void query.refetch()}
        disabled={refreshing}
        aria-busy={refreshing || undefined}
      >
        <RefreshCw aria-hidden="true" className={cn(refreshing && 'animate-spin')} />
        {t('list.refresh')}
      </Button>
    </div>
  ) : null

  if (items.length === 0) {
    return (
      <div className={cn('flex flex-col gap-3', className)}>
        {refresh}
        {empty}
      </div>
    )
  }

  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)}>
      {refresh}
      <ul aria-label={label} className={listClassName}>
        {items.map((item, index) => (
          <li key={getKey(item)} className={itemClassName}>
            {renderItem(item, index)}
          </li>
        ))}
      </ul>
      <div ref={sentinel} aria-hidden="true" className="h-px" />
      {isFetchingNextPage ? (
        <div className="flex justify-center py-4">
          <Spinner label={t('list.loading_more')} />
        </div>
      ) : null}
      {isFetchNextPageError ? (
        <div role="alert" className="flex flex-col items-center gap-2 py-4 text-center">
          <p className="text-body-sm text-muted-foreground">{t('list.load_more_failed')}</p>
          <Button variant="secondary" onClick={() => void fetchNextPage()}>
            {t('common:actions.retry')}
          </Button>
        </div>
      ) : null}
      {canLoadMore ? (
        <div className="flex justify-center py-2">
          <Button variant="secondary" onClick={() => void fetchNextPage()}>
            {t('list.load_more')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
