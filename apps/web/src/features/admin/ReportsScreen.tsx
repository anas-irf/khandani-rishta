// ADM-REPORTS: the report queue (18 section 4.5).
import { Link } from '@tanstack/react-router'
import { CircleCheck } from 'lucide-react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '~/components/common/EmptyState'
import { Page } from '~/components/common/Page'
import { RelativeTime } from '~/components/common/RelativeTime'
import { Badge } from '~/components/ui/badge'
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select'
import { useLabelOf } from '~/lib/reference'
import { AdminList, type Column, tableLinkClass } from './components/DataTable'
import { FormField } from './components/FormField'
import { StatusBadge } from './components/StatusBadge'
import { useAdminReports } from './queries'
import { useSearchFilters } from './search'
import { REPORT_STATUSES, reportsSearch } from './search-schemas'
import { useQueueFocusNavigation } from './shortcuts'
import type { AdminReportListItem } from './types'

/** `priority` runs from 1 (most urgent) to 3 (13 section 6.5). */
export function PriorityBadge({ priority }: { priority: AdminReportListItem['priority'] }) {
  const { t } = useTranslation('admin')
  return (
    <Badge variant={priority === 1 ? 'danger' : priority === 2 ? 'warning' : 'secondary'}>
      {t('reports.priority', { priority })}
    </Badge>
  )
}

export function ReportsScreen() {
  const { t } = useTranslation('admin')
  const label = useLabelOf()
  const [filters, setFilters] = useSearchFilters(reportsSearch)
  const query = useAdminReports(filters.status)
  const container = useRef<HTMLDivElement>(null)
  useQueueFocusNavigation(container)

  const columns: Column<AdminReportListItem>[] = [
    {
      id: 'priority',
      header: t('reports.col.priority'),
      cell: (item) => <PriorityBadge priority={item.priority} />,
    },
    {
      id: 'reason',
      header: t('reports.col.reason'),
      cell: (item) => (
        <Link
          to="/admin/reports/$reportId"
          params={{ reportId: item.report_id }}
          data-queue-link=""
          className={tableLinkClass}
        >
          {label('report_reason', item.reason)}
        </Link>
      ),
    },
    {
      id: 'subject',
      header: t('reports.col.subject'),
      cell: (item) => t(`reports.subject.${item.subject_type}`),
    },
    {
      id: 'target',
      header: t('reports.col.target'),
      cell: (item) => (
        <>
          {item.target.first_name ?? item.target.public_code}
          <span className="ms-2 text-muted-foreground">{item.target.public_code}</span>
        </>
      ),
    },
    {
      id: 'reporter',
      header: t('reports.col.reporter'),
      cell: (item) =>
        item.reporter
          ? `${item.reporter.first_name ?? item.reporter.public_code} (${item.reporter.public_code})`
          : t('reports.source.system'),
    },
    {
      id: 'open_on_target',
      header: t('reports.col.open_on_target'),
      cell: (item) => item.open_reports_on_target,
    },
    {
      id: 'status',
      header: t('reports.col.status'),
      cell: (item) => <StatusBadge status={item.status} />,
    },
    {
      id: 'handled_by',
      header: t('reports.col.handled_by'),
      cell: (item) => item.handled_by_email ?? '-',
    },
    {
      id: 'created',
      header: t('reports.col.created'),
      cell: (item) => <RelativeTime value={item.created_at} />,
    },
  ]

  return (
    <div ref={container} className="flex min-w-0 flex-1 flex-col">
      <Page title={t('reports.title')} description={t('reports.description')}>
        <form
          aria-label={t('reports.filters')}
          onSubmit={(event) => event.preventDefault()}
          className="flex items-end gap-3"
        >
          <FormField label={t('reports.status')} className="w-56">
            {(props) => (
              <NativeSelect
                {...props}
                value={filters.status}
                onChange={(event) =>
                  setFilters({ status: event.target.value as (typeof REPORT_STATUSES)[number] })
                }
              >
                {REPORT_STATUSES.map((status) => (
                  <NativeSelectOption key={status} value={status}>
                    {t(`status.${status}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        </form>
        <AdminList
          caption={t('reports.caption')}
          query={query}
          columns={columns}
          getKey={(item) => item.report_id}
          empty={
            filters.status === 'open' ? (
              <EmptyState icon={CircleCheck} title={t('list.queue_empty')} />
            ) : (
              <EmptyState title={t('reports.empty')} />
            )
          }
        />
      </Page>
    </div>
  )
}
