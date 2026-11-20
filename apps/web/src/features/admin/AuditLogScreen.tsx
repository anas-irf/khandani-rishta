// ADM-AUDIT: who did what (18 section 8).
import { Link } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '~/components/common/EmptyState'
import { PageHeader } from '~/components/common/PageHeader'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select'
import { AUDIT_TARGET_TYPES, isOneOf } from '~/lib/api-enums'
import { RequireAdmin } from './access'
import { AUDIT_ACTIONS } from './audit-codes'
import { AdminList, type Column } from './components/DataTable'
import { FormField } from './components/FormField'
import { auditColumns } from './components/Tables'
import { useAuditLog } from './queries'
import { useSearchFilters } from './search'
import { auditSearch } from './search-schemas'
import type { AuditEntry } from './types'

export function AuditLogScreen() {
  return (
    <RequireAdmin>
      <AuditLog />
    </RequireAdmin>
  )
}

function AuditLog() {
  const { t } = useTranslation('admin')
  const [filters, setFilters] = useSearchFilters(auditSearch)
  const [draft, setDraft] = useState({
    actor_user_id: filters.actor_user_id ?? '',
    target_id: filters.target_id ?? '',
  })
  const query = useAuditLog({
    actor_user_id: filters.actor_user_id,
    action: filters.action,
    target_type: filters.target_type,
    target_id: filters.target_id,
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setFilters({
      actor_user_id: draft.actor_user_id.trim() || undefined,
      target_id: draft.target_id.trim() || undefined,
    })
  }

  // The actor links to the account; the other columns come from the shared audit columns.
  const columns: Column<AuditEntry>[] = auditColumns(t).map((column) =>
    column.id === 'actor'
      ? {
          ...column,
          cell: (entry: AuditEntry) => (
            <Link
              to="/admin/users/$userId"
              params={{ userId: entry.actor.user_id }}
              className="text-primary hover:underline"
            >
              {entry.actor.email ?? entry.actor.user_id}
            </Link>
          ),
        }
      : column,
  )

  const filtered = Boolean(
    filters.actor_user_id || filters.action || filters.target_type || filters.target_id,
  )

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('audit.title')} description={t('audit.description')} />
      <form
        aria-label={t('audit.filters')}
        onSubmit={submit}
        className="flex flex-wrap items-end gap-3"
      >
        <FormField label={t('audit.filter_actor')} className="w-72">
          {(props) => (
            <Input
              {...props}
              value={draft.actor_user_id}
              onChange={(event) => setDraft({ ...draft, actor_user_id: event.target.value })}
            />
          )}
        </FormField>
        <FormField label={t('audit.filter_action')} className="w-64">
          {(props) => (
            <NativeSelect
              {...props}
              value={filters.action ?? ''}
              onChange={(event) => setFilters({ action: event.target.value || undefined })}
            >
              <NativeSelectOption value="">{t('audit.any_action')}</NativeSelectOption>
              {AUDIT_ACTIONS.map((action) => (
                <NativeSelectOption key={action} value={action}>
                  {action}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField label={t('audit.filter_target_type')} className="w-56">
          {(props) => (
            <NativeSelect
              {...props}
              value={filters.target_type ?? ''}
              onChange={(event) => {
                const value = event.target.value
                setFilters({
                  target_type: isOneOf(AUDIT_TARGET_TYPES, value) ? value : undefined,
                })
              }}
            >
              <NativeSelectOption value="">{t('audit.any_target')}</NativeSelectOption>
              {AUDIT_TARGET_TYPES.map((type) => (
                <NativeSelectOption key={type} value={type}>
                  {t(`audit.target.${type}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField label={t('audit.filter_target_id')} className="w-72">
          {(props) => (
            <Input
              {...props}
              value={draft.target_id}
              onChange={(event) => setDraft({ ...draft, target_id: event.target.value })}
            />
          )}
        </FormField>
        <Button type="submit">
          <Search aria-hidden="true" />
          {t('actions.apply')}
        </Button>
      </form>
      <AdminList
        caption={t('audit.caption')}
        query={query}
        columns={columns}
        getKey={(entry) => entry.id}
        empty={<EmptyState title={filtered ? t('audit.empty_filtered') : t('audit.empty')} />}
      />
    </div>
  )
}
