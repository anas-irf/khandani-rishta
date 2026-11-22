import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorState } from '~/components/common/ErrorState'
import type { InfiniteListQuery } from '~/components/common/InfiniteList'
import { inlineLinkClass } from '~/components/common/TextLink'
import { Button } from '~/components/ui/button'
import { Skeleton } from '~/components/ui/skeleton'
import { cn } from '~/lib/utils'

/** A link in a table cell: the gold underline on a target as tall as a touch target. */
export const tableLinkClass = cn(
  inlineLinkClass,
  'inline-flex min-h-touch min-w-touch flex-wrap items-center gap-x-2',
)

export type Column<T> = {
  id: string
  header: string
  cell: (item: T) => ReactNode
  className?: string
}

type DataTableProps<T> = {
  /** The table's name, read by screen readers. Visible when `captionVisible` is set. */
  caption: string
  captionVisible?: boolean
  columns: Column<T>[]
  rows: T[]
  getKey: (item: T) => string
  className?: string
}

/**
 * A dense, accessible table: a caption, column headers with `scope`, and logical spacing.
 * Staff screens are desktop only (18 section 1.1).
 */
export function DataTable<T>({
  caption,
  captionVisible = false,
  columns,
  rows,
  getKey,
  className,
}: DataTableProps<T>) {
  return (
    <div className={cn('relative overflow-x-auto', className)}>
      <table className="w-full border-collapse text-start text-body-sm">
        <caption
          className={cn(
            captionVisible
              ? 'caption-top px-3 pt-3 pb-1 text-start text-title-md font-bold'
              : 'sr-only',
          )}
        >
          {caption}
        </caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                className={cn(
                  'border-b border-input px-3 py-2 text-start align-bottom text-label-sm text-muted-foreground',
                  column.className,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={getKey(row)} className="border-b border-border">
              {columns.map((column) => (
                <td key={column.id} className={cn('px-3 py-2 align-middle', column.className)}>
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  const { t } = useTranslation('admin')
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-2">
      <span className="sr-only">{t('list.loading')}</span>
      {Array.from({ length: rows }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity.
        <Skeleton key={index} className="min-h-touch w-full" />
      ))}
    </div>
  )
}

type AdminListProps<T> = Omit<DataTableProps<T>, 'rows'> & {
  query: InfiniteListQuery<T>
  /** Shown when the list is empty. */
  empty: ReactNode
}

/**
 * A table over an infinite query (18 section 3): skeleton on the first load, `ErrorState` on
 * failure, the empty slot, then the rows with a "Load more" button. A filter change is a new
 * query key, so only the newest request is shown.
 */
export function AdminList<T>({ query, empty, ...table }: AdminListProps<T>) {
  const { t } = useTranslation('admin')

  if (query.isPending && !query.data) return <TableSkeleton />
  if (!query.data) {
    return (
      <ErrorState
        error={query.error}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    )
  }
  const rows = query.data.pages.flatMap((page) => page.items)
  if (rows.length === 0) return <>{empty}</>

  return (
    <div className="flex flex-col gap-3">
      <DataTable {...table} rows={rows} />
      {query.isFetchNextPageError ? (
        <p role="alert" className="text-caption font-semibold text-danger">
          {t('list.load_more_failed')}
        </p>
      ) : null}
      {query.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            loading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {t('list.load_more')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
