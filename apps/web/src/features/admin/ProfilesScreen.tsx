// ADM-PROFILES: the profile review queue and profile search (18 section 4.1).
import { Link } from '@tanstack/react-router'
import { CircleCheck, Search } from 'lucide-react'
import { type FormEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '~/components/common/EmptyState'
import { PageHeader } from '~/components/common/PageHeader'
import { RelativeTime } from '~/components/common/RelativeTime'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select'
import { useLabelOf } from '~/lib/reference'
import { AdminPhoto } from './components/AdminPhoto'
import { AdminList, type Column } from './components/DataTable'
import { FormField } from './components/FormField'
import { StatusBadge } from './components/StatusBadge'
import { fullName } from './names'
import { useAdminProfiles } from './queries'
import { useSearchFilters } from './search'
import { PROFILE_STATUSES, profilesSearch } from './search-schemas'
import { useQueueFocusNavigation } from './shortcuts'
import type { AdminProfileListItem } from './types'

export function ProfilesScreen() {
  const { t } = useTranslation('admin')
  const label = useLabelOf()
  const [filters, setFilters] = useSearchFilters(profilesSearch)
  const [draft, setDraft] = useState(filters.q ?? '')
  const container = useRef<HTMLDivElement>(null)
  useQueueFocusNavigation(container)

  const query = useAdminProfiles({ status: filters.status, q: filters.q })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setFilters({ q: draft.trim() || undefined })
  }

  const columns: Column<AdminProfileListItem>[] = [
    {
      id: 'photo',
      header: t('profiles.col.photo'),
      className: 'w-16',
      cell: (item) => (
        <AdminPhoto
          photoId={item.profile_id}
          url={item.photo_thumb_url}
          name={fullName(item.first_name, item.last_name, item.public_code)}
          gender={item.gender}
          size="thumb"
          width={40}
          height={40}
          className="size-10 rounded-md"
        />
      ),
    },
    {
      id: 'profile',
      header: t('profiles.col.profile'),
      cell: (item) => (
        <Link
          to="/admin/profiles/$profileId"
          params={{ profileId: item.profile_id }}
          data-queue-link=""
          className="font-medium text-primary underline-offset-2 hover:underline"
        >
          {fullName(item.first_name, item.last_name, item.public_code)}
          <span className="ms-2 font-normal text-muted-foreground">{item.public_code}</span>
        </Link>
      ),
    },
    {
      id: 'status',
      header: t('profiles.col.status'),
      cell: (item) => <StatusBadge status={item.status} />,
    },
    {
      id: 'person',
      header: t('profiles.col.person'),
      cell: (item) =>
        [item.gender ? label('gender', item.gender) : null, item.age]
          .filter((part) => part !== null && part !== undefined)
          .join(', ') || '-',
    },
    { id: 'city', header: t('profiles.col.city'), cell: (item) => item.city_name ?? '-' },
    {
      id: 'managed_by',
      header: t('profiles.col.managed_by'),
      cell: (item) => (item.managed_by ? label('managed_by', item.managed_by) : '-'),
    },
    {
      id: 'waiting',
      header: t('profiles.col.waiting'),
      cell: (item) =>
        item.onboarding_completed_at ? <RelativeTime value={item.onboarding_completed_at} /> : '-',
    },
    {
      id: 'system_reports',
      header: t('profiles.col.system_reports'),
      cell: (item) =>
        item.open_system_reports > 0 ? (
          <Badge variant="danger">
            {t('profiles.system_reports', { count: item.open_system_reports })}
          </Badge>
        ) : (
          '-'
        ),
    },
  ]

  const isQueue = filters.status === 'pending_review' && !filters.q

  return (
    <div ref={container} className="flex flex-col gap-4">
      <PageHeader title={t('profiles.title')} description={t('profiles.description')} />
      <form
        aria-label={t('profiles.filters')}
        onSubmit={submit}
        className="flex flex-wrap items-end gap-3"
      >
        <FormField label={t('profiles.status')} className="w-56">
          {(props) => (
            <NativeSelect
              {...props}
              value={filters.status}
              onChange={(event) =>
                setFilters({ status: event.target.value as (typeof PROFILE_STATUSES)[number] })
              }
            >
              {PROFILE_STATUSES.map((status) => (
                <NativeSelectOption key={status} value={status}>
                  {t(`status.${status}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField label={t('profiles.search')} className="w-80">
          {(props) => (
            <Input
              {...props}
              type="search"
              value={draft}
              placeholder={t('profiles.search_placeholder')}
              onChange={(event) => setDraft(event.target.value)}
            />
          )}
        </FormField>
        <Button type="submit">
          <Search aria-hidden="true" />
          {t('actions.search')}
        </Button>
      </form>
      <AdminList
        caption={t('profiles.caption')}
        query={query}
        columns={columns}
        getKey={(item) => item.profile_id}
        empty={
          isQueue ? (
            <EmptyState icon={CircleCheck} title={t('list.queue_empty')} />
          ) : (
            <EmptyState title={t('profiles.empty')} />
          )
        }
      />
    </div>
  )
}
