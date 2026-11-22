// ADM-CASTES: caste suggestions and the caste list (18 section 6).
import { CircleCheck, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConfirmDialog } from '~/components/common/ConfirmDialog'
import { EmptyState } from '~/components/common/EmptyState'
import { ErrorState } from '~/components/common/ErrorState'
import { Page } from '~/components/common/Page'
import { RelativeTime } from '~/components/common/RelativeTime'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { useCastes } from '~/lib/reference'
import { useIsAdmin } from './access'
import { CreateCasteDialog, EditCasteDialog, PromoteDialog } from './components/CasteDialogs'
import { AdminList, type Column, DataTable, TableSkeleton } from './components/DataTable'
import { FormField } from './components/FormField'
import { useAdminCastes, useCasteSuggestions, useRejectSuggestion } from './queries'
import { useSearchFilters } from './search'
import { castesSearch } from './search-schemas'
import type { AdminCaste, CasteSuggestionItem } from './types'

type Dialog =
  | { kind: 'promote'; suggestion: CasteSuggestionItem }
  | { kind: 'reject'; suggestion: CasteSuggestionItem }
  | { kind: 'create' }
  | { kind: 'edit'; caste: AdminCaste }
  | null

export function CastesScreen() {
  const { t } = useTranslation('admin')
  const isAdmin = useIsAdmin()
  const [filters, setFilters] = useSearchFilters(castesSearch)
  const [dialog, setDialog] = useState<Dialog>(null)
  const reject = useRejectSuggestion()
  const parents = useCastes().map((caste) => ({ code: caste.code, name: caste.name }))

  return (
    <Tabs
      value={filters.tab}
      onValueChange={(tab) => setFilters({ tab: tab as 'suggestions' | 'castes' })}
      className="min-w-0 flex-1 gap-0"
    >
      <Page
        title={t('castes.title')}
        description={t('castes.description')}
        actions={
          isAdmin && filters.tab === 'castes' ? (
            <Button onClick={() => setDialog({ kind: 'create' })}>
              <Plus aria-hidden="true" />
              {t('castes.add')}
            </Button>
          ) : undefined
        }
        header={
          <TabsList aria-label={t('castes.tabs')}>
            <TabsTrigger value="suggestions">{t('castes.tab_suggestions')}</TabsTrigger>
            <TabsTrigger value="castes">{t('castes.tab_castes')}</TabsTrigger>
          </TabsList>
        }
      >
        <TabsContent value="suggestions">
          <Suggestions
            isAdmin={isAdmin}
            onPromote={(suggestion) => setDialog({ kind: 'promote', suggestion })}
            onReject={(suggestion) => setDialog({ kind: 'reject', suggestion })}
          />
        </TabsContent>
        <TabsContent value="castes">
          <CasteList isAdmin={isAdmin} onEdit={(caste) => setDialog({ kind: 'edit', caste })} />
        </TabsContent>
      </Page>

      {dialog?.kind === 'promote' ? (
        <PromoteDialog
          suggestion={dialog.suggestion}
          parents={parents}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === 'create' ? (
        <CreateCasteDialog parents={parents} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'edit' ? (
        <EditCasteDialog caste={dialog.caste} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'reject' ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          title={t('castes.reject_title', { name: dialog.suggestion.name })}
          description={t('castes.reject_text')}
          confirmLabel={t('castes.reject')}
          tone="ink"
          onConfirm={async () => {
            await reject.mutateAsync(dialog.suggestion.id)
            toast.success(t('castes.rejected'))
          }}
        />
      ) : null}
    </Tabs>
  )
}

function Suggestions({
  isAdmin,
  onPromote,
  onReject,
}: {
  isAdmin: boolean
  onPromote: (suggestion: CasteSuggestionItem) => void
  onReject: (suggestion: CasteSuggestionItem) => void
}) {
  const { t } = useTranslation('admin')
  const query = useCasteSuggestions()

  const columns: Column<CasteSuggestionItem>[] = [
    {
      id: 'name',
      header: t('castes.col.name'),
      cell: (item) => (
        <>
          <span className="font-semibold">{item.name}</span>
          <span className="block text-caption text-muted-foreground">{item.normalized_name}</span>
        </>
      ),
    },
    { id: 'parent', header: t('castes.col.parent'), cell: (item) => item.parent_name ?? '-' },
    { id: 'usage', header: t('castes.col.usage'), cell: (item) => item.usage_count },
    {
      id: 'similar',
      header: t('castes.col.similar'),
      cell: (item) =>
        item.similar.length === 0 ? (
          '-'
        ) : (
          <ul className="flex flex-wrap gap-1">
            {item.similar.map((similar) => (
              <li key={similar.code}>
                <Badge variant="warning">{similar.name}</Badge>
              </li>
            ))}
          </ul>
        ),
    },
    {
      id: 'created',
      header: t('castes.col.created'),
      cell: (item) => <RelativeTime value={item.created_at} />,
    },
    {
      id: 'actions',
      header: t('castes.col.actions'),
      cell: (item) => (
        <span className="flex flex-wrap gap-2">
          {isAdmin ? (
            <Button onClick={() => onPromote(item)}>
              {t('castes.promote')}
              <span className="sr-only"> {item.name}</span>
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => onReject(item)}>
            {t('castes.reject')}
            <span className="sr-only"> {item.name}</span>
          </Button>
        </span>
      ),
    },
  ]

  return (
    <AdminList
      caption={t('castes.suggestions_caption')}
      query={query}
      columns={columns}
      getKey={(item) => item.id}
      empty={<EmptyState icon={CircleCheck} title={t('list.queue_empty')} />}
    />
  )
}

/** Top-level castes first, each followed by its sub-castes. */
function arrange(castes: AdminCaste[]): AdminCaste[] {
  const byParent = new Map<string, AdminCaste[]>()
  const top: AdminCaste[] = []
  for (const caste of castes) {
    if (caste.parent_code) {
      byParent.set(caste.parent_code, [...(byParent.get(caste.parent_code) ?? []), caste])
    } else {
      top.push(caste)
    }
  }
  const order = (a: AdminCaste, b: AdminCaste) =>
    a.sort_order - b.sort_order || a.name.localeCompare(b.name)
  return top
    .sort(order)
    .flatMap((caste) => [caste, ...(byParent.get(caste.code) ?? []).sort(order)])
}

function CasteList({ isAdmin, onEdit }: { isAdmin: boolean; onEdit: (caste: AdminCaste) => void }) {
  const { t } = useTranslation('admin')
  const query = useAdminCastes()
  const [filter, setFilter] = useState('')

  const rows = useMemo(() => {
    const all = arrange(query.data ?? [])
    const needle = filter.trim().toLowerCase()
    if (!needle) return all
    return all.filter((caste) =>
      [caste.code, caste.name, ...caste.aliases].some((text) =>
        text.toLowerCase().includes(needle),
      ),
    )
  }, [query.data, filter])

  if (query.isPending) return <TableSkeleton />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />

  const columns: Column<AdminCaste>[] = [
    {
      id: 'name',
      header: t('castes.col.name'),
      cell: (caste) => (
        <span className={caste.parent_code ? 'ps-6' : 'font-semibold'}>
          {caste.name}
          {caste.name_ur ? (
            <span dir="rtl" className="ms-2 text-muted-foreground">
              {caste.name_ur}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'code',
      header: t('castes.col.code'),
      cell: (caste) => <code className="text-caption">{caste.code}</code>,
    },
    {
      id: 'aliases',
      header: t('castes.col.aliases'),
      cell: (caste) => caste.aliases.join(', ') || '-',
    },
    { id: 'order', header: t('castes.col.order'), cell: (caste) => caste.sort_order },
    {
      id: 'active',
      header: t('castes.col.active'),
      cell: (caste) => (
        <Badge variant={caste.is_active ? 'success' : 'secondary'}>
          {caste.is_active ? t('castes.active_yes') : t('castes.active_no')}
        </Badge>
      ),
    },
  ]
  if (isAdmin) {
    columns.push({
      id: 'actions',
      header: t('castes.col.actions'),
      cell: (caste) => (
        <Button variant="secondary" onClick={() => onEdit(caste)}>
          {t('actions.edit')}
          <span className="sr-only"> {caste.name}</span>
        </Button>
      ),
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <FormField label={t('castes.filter')} className="w-80">
        {(props) => (
          <Input
            {...props}
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        )}
      </FormField>
      {rows.length === 0 ? (
        <EmptyState title={t('castes.none_found')} />
      ) : (
        <DataTable
          caption={t('castes.list_caption')}
          columns={columns}
          rows={rows}
          getKey={(caste) => caste.code}
        />
      )}
    </div>
  )
}
