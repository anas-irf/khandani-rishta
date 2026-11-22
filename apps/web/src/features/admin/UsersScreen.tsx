// ADM-USERS: user search (18 section 5.1). There is no "browse members" list on purpose.
import { Link } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { type FormEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '~/components/common/EmptyState'
import { Page } from '~/components/common/Page'
import { RelativeTime } from '~/components/common/RelativeTime'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select'
import { formatDate } from '~/lib/format'
import { AdminList, type Column, tableLinkClass } from './components/DataTable'
import { FormField } from './components/FormField'
import { StatusBadge } from './components/StatusBadge'
import { fullName } from './names'
import { USER_SEARCH_MIN_LENGTH, useAdminUsers } from './queries'
import { useSearchFilters } from './search'
import { USER_ROLES, USER_STATUSES, usersSearch } from './search-schemas'
import { useQueueFocusNavigation } from './shortcuts'
import type { AdminUserListItem } from './types'

export function UsersScreen() {
  const { t } = useTranslation('admin')
  const [filters, setFilters] = useSearchFilters(usersSearch)
  const [draft, setDraft] = useState(filters.q ?? '')
  const [error, setError] = useState<string>()
  const container = useRef<HTMLDivElement>(null)
  useQueueFocusNavigation(container)

  const q = (filters.q ?? '').trim()
  const searching = q.length >= USER_SEARCH_MIN_LENGTH
  const query = useAdminUsers({ q, status: filters.status, role: filters.role })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const value = draft.trim()
    if (value.length < USER_SEARCH_MIN_LENGTH) {
      setError(t('users.too_short', { min: USER_SEARCH_MIN_LENGTH }))
      return
    }
    setError(undefined)
    setFilters({ q: value })
  }

  const columns: Column<AdminUserListItem>[] = [
    {
      id: 'user',
      header: t('users.col.user'),
      cell: (item) => (
        <Link
          to="/admin/users/$userId"
          params={{ userId: item.user_id }}
          data-queue-link=""
          className={tableLinkClass}
        >
          {item.email ?? fullName(item.first_name, item.last_name, item.public_code)}
        </Link>
      ),
    },
    {
      id: 'profile',
      header: t('users.col.profile'),
      cell: (item) => (
        <>
          {fullName(item.first_name, item.last_name, item.public_code)}
          <span className="ms-2 text-muted-foreground">{item.public_code}</span>
        </>
      ),
    },
    { id: 'role', header: t('users.col.role'), cell: (item) => <StatusBadge status={item.role} /> },
    {
      id: 'status',
      header: t('users.col.status'),
      cell: (item) => <StatusBadge status={item.status} />,
    },
    {
      id: 'profile_status',
      header: t('users.col.profile_status'),
      cell: (item) => <StatusBadge status={item.profile_status} />,
    },
    { id: 'created', header: t('users.col.created'), cell: (item) => formatDate(item.created_at) },
    {
      id: 'last_seen',
      header: t('users.col.last_seen'),
      cell: (item) => (item.last_seen_at ? <RelativeTime value={item.last_seen_at} /> : '-'),
    },
  ]

  return (
    <div ref={container} className="flex min-w-0 flex-1 flex-col">
      <Page title={t('users.title')} description={t('users.description')}>
        <form
          aria-label={t('users.filters')}
          onSubmit={submit}
          noValidate
          className="flex flex-wrap items-start gap-3"
        >
          <FormField
            label={t('users.search')}
            hint={t('users.search_hint')}
            error={error}
            className="w-96"
          >
            {(props) => (
              <Input
                {...props}
                type="search"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
            )}
          </FormField>
          <FormField label={t('users.status')} className="w-48">
            {(props) => (
              <NativeSelect
                {...props}
                value={filters.status ?? ''}
                onChange={(event) =>
                  setFilters({
                    status: (event.target.value || undefined) as
                      | (typeof USER_STATUSES)[number]
                      | undefined,
                  })
                }
              >
                <NativeSelectOption value="">{t('users.any')}</NativeSelectOption>
                {USER_STATUSES.map((status) => (
                  <NativeSelectOption key={status} value={status}>
                    {t(`status.${status}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField label={t('users.role')} className="w-48">
            {(props) => (
              <NativeSelect
                {...props}
                value={filters.role ?? ''}
                onChange={(event) =>
                  setFilters({
                    role: (event.target.value || undefined) as
                      | (typeof USER_ROLES)[number]
                      | undefined,
                  })
                }
              >
                <NativeSelectOption value="">{t('users.any')}</NativeSelectOption>
                {USER_ROLES.map((role) => (
                  <NativeSelectOption key={role} value={role}>
                    {t(`role.${role}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <Button type="submit" className="mt-[calc(1.375rem+8px)]">
            <Search aria-hidden="true" />
            {t('actions.search')}
          </Button>
        </form>
        {searching ? (
          <AdminList
            caption={t('users.caption')}
            query={query}
            columns={columns}
            getKey={(item) => item.user_id}
            empty={<EmptyState title={t('users.empty')} />}
          />
        ) : (
          <EmptyState icon={Search} title={t('users.prompt_title')} text={t('users.prompt_text')} />
        )}
      </Page>
    </div>
  )
}
