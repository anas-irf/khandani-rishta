import { Bookmark, MoreVertical } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConfirmDialog } from '~/components/common/ConfirmDialog'
import { CharCount, FieldError } from '~/components/common/fields/field-shell'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { SwitchRow } from '~/components/common/SwitchRow'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { isApiError } from '~/lib/api'
import type { SavedSearch, SearchFilters } from '~/lib/api-types'
import { serverFieldMessage } from '~/lib/form-context'
import { formatDate } from '~/lib/format'
import {
  useCreateSavedSearch,
  useDeleteSavedSearch,
  useSavedSearches,
  useUpdateSavedSearch,
} from '../queries'

/** A saved search name has 1 to 60 characters (16 section 6.6). */
export const NAME_MAX = 60

/**
 * The saved searches above the form (16 section 6.6): one chip per saved search, newest first.
 * Tapping a chip loads its filters and runs the search; its menu renames, toggles the
 * notification and removes it (with a confirmation).
 */
export function SavedSearches({ onRun }: { onRun: (saved: SavedSearch) => void }) {
  const { t } = useTranslation('discovery')
  const saved = useSavedSearches()
  const [renaming, setRenaming] = useState<SavedSearch | null>(null)
  const [removing, setRemoving] = useState<SavedSearch | null>(null)
  const update = useUpdateSavedSearch()
  const remove = useDeleteSavedSearch()
  const online = useOnlineStatus()

  const items = saved.data ?? []
  if (items.length === 0) return null

  return (
    <section aria-label={t('saved.label')} className="flex flex-col gap-2">
      <h2 className="text-label-md text-muted-foreground">{t('saved.label')}</h2>
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="inline-flex max-w-full items-stretch rounded-lg border border-input"
          >
            <Button
              variant="ghost"
              onClick={() => onRun(item)}
              className="min-w-0 justify-start rounded-none rounded-s-lg ps-4 pe-2 text-start text-label-md"
            >
              <Bookmark aria-hidden="true" className="size-4 text-primary" />
              <span dir="auto" className="min-w-0">
                {item.name}
              </span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('saved.menu', { name: item.name })}
                  className="h-auto min-h-touch rounded-none rounded-e-lg"
                >
                  <MoreVertical aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setRenaming(item)} disabled={!online}>
                  {t('saved.rename')}
                </DropdownMenuItem>
                <DropdownMenuCheckboxItem
                  checked={item.notify_new}
                  disabled={!online}
                  onCheckedChange={(checked) =>
                    update.mutate(
                      { id: item.id, notify_new: checked === true },
                      { onSuccess: () => toast.success(t('saved.updated')) },
                    )
                  }
                >
                  {t('saved.notify')}
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setRemoving(item)}
                  disabled={!online}
                >
                  {t('saved.remove')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ))}
      </ul>
      <RenameDialog saved={renaming} onClose={() => setRenaming(null)} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => (open ? null : setRemoving(null))}
        title={t('saved.remove_title')}
        description={t('saved.remove_text', { name: removing?.name ?? '' })}
        confirmLabel={t('saved.remove')}
        tone="danger"
        onConfirm={() => (removing ? remove.mutateAsync(removing.id) : undefined)}
      />
    </section>
  )
}

function NameField({
  value,
  onChange,
  error,
}: {
  value: string
  onChange: (value: string) => void
  error: string | null
}) {
  const { t } = useTranslation('discovery')
  const id = useId()
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{t('saved.name_label')}</Label>
      <Input
        id={id}
        name="name"
        dir="auto"
        value={value}
        maxLength={NAME_MAX}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-count${error ? ` ${id}-error` : ''}`}
        onChange={(event) => onChange(event.target.value)}
      />
      <CharCount id={`${id}-count`}>
        {t('saved.name_count', { count: value.length, max: NAME_MAX })}
      </CharCount>
      <FieldError id={`${id}-error`} message={error ?? undefined} />
    </div>
  )
}

/** The message for a name the client or the API refused. */
function nameError(error: unknown): string | null {
  if (!isApiError(error) || error.code !== 'validation_failed') return null
  const field = error.fields.find((item) => item.field === 'name')
  return field ? serverFieldMessage('discovery', field) : null
}

function RenameDialog({ saved, onClose }: { saved: SavedSearch | null; onClose: () => void }) {
  const { t } = useTranslation(['discovery', 'common', 'errors'])
  const update = useUpdateSavedSearch()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [seen, setSeen] = useState<SavedSearch | null>(null)
  if (saved !== seen) {
    setSeen(saved)
    setName(saved?.name ?? '')
    setError(null)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!saved) return
    const trimmed = name.trim()
    if (!trimmed) return setError(t('errors:field.required'))
    update.mutate(
      { id: saved.id, name: trimmed },
      {
        onSuccess: () => {
          toast.success(t('discovery:saved.updated'))
          onClose()
        },
        onError: (failure) => setError(nameError(failure)),
      },
    )
  }

  return (
    <Dialog open={saved !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('discovery:saved.rename_title')}</DialogTitle>
          </DialogHeader>
          <NameField value={name} onChange={setName} error={error} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" loading={update.isPending}>
              {t('common:actions.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * "Save this search" (16 section 6.6): a name (1 to 60 characters, prefilled "Search {date}") and
 * "Notify me about new members who match". `limit_reached` opens the limit dialog with
 * "You can keep up to 10 saved searches. Remove one first."
 */
export function SaveSearchDialog({
  open,
  onOpenChange,
  filters,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  filters: SearchFilters
}) {
  const { t } = useTranslation(['discovery', 'common', 'errors'])
  const create = useCreateSavedSearch()
  const [name, setName] = useState('')
  const [notify, setNotify] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setName(t('discovery:saved.name_default', { date: formatDate(new Date()) }))
      setNotify(false)
      setError(null)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return setError(t('errors:field.required'))
    create.mutate(
      { name: trimmed, filters, notify_new: notify },
      {
        onSuccess: () => {
          toast.success(t('discovery:saved.saved'))
          onOpenChange(false)
        },
        onError: (failure) => {
          setError(nameError(failure))
          if (isApiError(failure) && failure.code === 'limit_reached') onOpenChange(false)
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('discovery:saved.dialog_title')}</DialogTitle>
          </DialogHeader>
          <NameField value={name} onChange={setName} error={error} />
          <SwitchRow
            label={t('discovery:saved.notify_label')}
            checked={notify}
            onCheckedChange={setNotify}
          />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" loading={create.isPending}>
              {t('discovery:saved.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
