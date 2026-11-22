// ADM-VERIFICATIONS: the verification request queue (18 section 4.4).
import { Link } from '@tanstack/react-router'
import { CircleCheck } from 'lucide-react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '~/components/common/EmptyState'
import { Page } from '~/components/common/Page'
import { RelativeTime } from '~/components/common/RelativeTime'
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select'
import { AdminList, type Column, tableLinkClass } from './components/DataTable'
import { FormField } from './components/FormField'
import { StatusBadge } from './components/StatusBadge'
import { useAdminVerifications } from './queries'
import { useSearchFilters } from './search'
import { VERIFICATION_STATUSES, verificationsSearch } from './search-schemas'
import { useQueueFocusNavigation } from './shortcuts'
import type { AdminVerificationListItem } from './types'

export function VerificationsScreen() {
  const { t } = useTranslation('admin')
  const [filters, setFilters] = useSearchFilters(verificationsSearch)
  const query = useAdminVerifications({ status: filters.status, kind: filters.kind })
  const container = useRef<HTMLDivElement>(null)
  useQueueFocusNavigation(container)

  const columns: Column<AdminVerificationListItem>[] = [
    {
      id: 'request',
      header: t('verifications.col.request'),
      cell: (item) => (
        <Link
          to="/admin/verifications/$requestId"
          params={{ requestId: item.request_id }}
          data-queue-link=""
          className={tableLinkClass}
        >
          {item.first_name ?? item.public_code}
          <span className="ms-2 font-normal text-muted-foreground">{item.public_code}</span>
        </Link>
      ),
    },
    {
      id: 'kind',
      header: t('verifications.col.kind'),
      cell: (item) => t(`verifications.kind.${item.kind}`),
    },
    {
      id: 'status',
      header: t('verifications.col.status'),
      cell: (item) => <StatusBadge status={item.status} />,
    },
    {
      id: 'created',
      header: t('verifications.col.created'),
      cell: (item) => <RelativeTime value={item.created_at} />,
    },
  ]

  return (
    <div ref={container} className="flex min-w-0 flex-1 flex-col">
      <Page title={t('verifications.title')} description={t('verifications.description')}>
        <form
          aria-label={t('verifications.filters')}
          onSubmit={(event) => event.preventDefault()}
          className="flex flex-wrap items-end gap-3"
        >
          <FormField label={t('verifications.status')} className="w-56">
            {(props) => (
              <NativeSelect
                {...props}
                value={filters.status}
                onChange={(event) =>
                  setFilters({
                    status: event.target.value as (typeof VERIFICATION_STATUSES)[number],
                  })
                }
              >
                {VERIFICATION_STATUSES.map((status) => (
                  <NativeSelectOption key={status} value={status}>
                    {t(`status.${status}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField label={t('verifications.kind_filter')} className="w-56">
            {(props) => (
              <NativeSelect
                {...props}
                value={filters.kind ?? ''}
                onChange={(event) =>
                  setFilters({
                    kind: (event.target.value || undefined) as 'id_document' | 'selfie' | undefined,
                  })
                }
              >
                <NativeSelectOption value="">{t('verifications.kind_all')}</NativeSelectOption>
                <NativeSelectOption value="id_document">
                  {t('verifications.kind.id_document')}
                </NativeSelectOption>
                <NativeSelectOption value="selfie">
                  {t('verifications.kind.selfie')}
                </NativeSelectOption>
              </NativeSelect>
            )}
          </FormField>
        </form>
        <AdminList
          caption={t('verifications.caption')}
          query={query}
          columns={columns}
          getKey={(item) => item.request_id}
          empty={
            filters.status === 'pending' ? (
              <EmptyState icon={CircleCheck} title={t('list.queue_empty')} />
            ) : (
              <EmptyState title={t('verifications.empty')} />
            )
          }
        />
      </Page>
    </div>
  )
}
