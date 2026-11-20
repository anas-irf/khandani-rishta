// ADM-PHOTOS: the photo review queue (18 section 4.2).
import { Link } from '@tanstack/react-router'
import { Check, CircleCheck, Flag } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { EmptyState } from '~/components/common/EmptyState'
import { ErrorState } from '~/components/common/ErrorState'
import { InfiniteList } from '~/components/common/InfiniteList'
import { PageHeader } from '~/components/common/PageHeader'
import { StatusBanner } from '~/components/common/StatusBanner'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select'
import { useOptions } from '~/lib/reference'
import { AdminPhoto } from './components/AdminPhoto'
import { TableSkeleton } from './components/DataTable'
import { Facts, Panel } from './components/Facts'
import { FormField } from './components/FormField'
import { StatusBadge } from './components/StatusBadge'
import { useAdminPhotos, useApprovePhoto, useRejectPhoto } from './queries'
import { useSearchFilters } from './search'
import { PHOTO_STATUSES, photosSearch } from './search-schemas'
import { useQueueSelection } from './selection'
import { useShortcuts } from './shortcuts'
import type { AdminPhotoItem } from './types'

/** The automatic check says "flag": such photos come first in the queue. */
function isFlagged(item: AdminPhotoItem): boolean {
  return item.moderation?.result === 'flag'
}

function scoreValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

export function PhotosScreen() {
  const { t } = useTranslation('admin')
  const [filters, setFilters] = useSearchFilters(photosSearch)
  const query = useAdminPhotos(filters.status)
  const reasons = useOptions('photo_rejection_reason')
  const approve = useApprovePhoto()
  const reject = useRejectPhoto()

  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  const selection = useQueueSelection(items, (item) => item.photo_id)
  const current = selection.selected
  const busy = approve.isPending || reject.isPending

  const doApprove = async () => {
    if (!current || busy || current.status !== 'pending_review') return
    await approve.mutateAsync(current.photo_id)
    toast.success(t('photo.approved'))
  }
  const doReject = async (code: string) => {
    if (!current || busy) return
    await reject.mutateAsync({ photoId: current.photo_id, reason: code })
    toast.success(
      t('photo.rejected', {
        reason: reasons.find((option) => option.code === code)?.label ?? code,
      }),
    )
  }
  const swallow = (action: () => Promise<void>) => () => void action().catch(() => undefined)

  useShortcuts({
    a: swallow(doApprove),
    j: selection.next,
    k: selection.previous,
    ...Object.fromEntries(
      reasons
        .slice(0, 8)
        .map((reason, index) => [String(index + 1), swallow(() => doReject(reason.code))]),
    ),
  })

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('photos.title')} description={t('photos.description')} />
      <FormField label={t('photos.status')} className="w-56">
        {(props) => (
          <NativeSelect
            {...props}
            value={filters.status}
            onChange={(event) =>
              setFilters({ status: event.target.value as (typeof PHOTO_STATUSES)[number] })
            }
          >
            {PHOTO_STATUSES.map((status) => (
              <NativeSelectOption key={status} value={status}>
                {t(`status.${status}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>

      {query.isPending ? (
        <TableSkeleton />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : items.length === 0 || !current ? (
        <EmptyState icon={CircleCheck} title={t('list.queue_empty')} />
      ) : (
        <div className="grid grid-cols-[18rem_minmax(0,1fr)] items-start gap-4">
          <nav aria-label={t('photos.queue')}>
            <InfiniteList
              query={query}
              getKey={(item) => item.photo_id}
              label={t('photos.queue')}
              listClassName="gap-2"
              renderItem={(item) => (
                <button
                  type="button"
                  aria-current={selection.isSelected(item) ? 'true' : undefined}
                  onClick={() => selection.select(item)}
                  className="flex min-h-11 w-full items-center gap-3 rounded-md border border-border bg-surface p-2 text-start hover:bg-muted aria-[current=true]:border-primary aria-[current=true]:bg-primary-soft"
                >
                  <AdminPhoto
                    photoId={item.photo_id}
                    url={item.large_url}
                    name={item.first_name ?? item.public_code}
                    gender={item.gender}
                    size="thumb"
                    width={48}
                    height={60}
                    className="h-15 w-12 shrink-0 rounded"
                  />
                  <span className="flex min-w-0 flex-col text-sm">
                    <span className="truncate font-medium">
                      {item.first_name ?? item.public_code}
                    </span>
                    <span className="text-muted-foreground">{item.public_code}</span>
                    {isFlagged(item) ? (
                      <Badge variant="warning">
                        <Flag aria-hidden="true" />
                        {t('photos.flagged')}
                      </Badge>
                    ) : null}
                  </span>
                </button>
              )}
            />
          </nav>
          <PhotoReview
            item={current}
            busy={busy}
            reasons={reasons}
            onApprove={swallow(doApprove)}
            onReject={(code) => void doReject(code).catch(() => undefined)}
          />
        </div>
      )}
    </div>
  )
}

function PhotoReview({
  item,
  busy,
  reasons,
  onApprove,
  onReject,
}: {
  item: AdminPhotoItem
  busy: boolean
  reasons: { code: string; label: string }[]
  onApprove: () => void
  onReject: (code: string) => void
}) {
  const { t } = useTranslation('admin')
  const name = item.first_name ?? item.public_code
  const checklist = t('photo.checklist', { returnObjects: true }) as {
    finding: string
    decision: string
  }[]

  return (
    <section aria-label={t('photos.review')} className="flex min-w-0 flex-col gap-4">
      {item.would_be_primary ? (
        <StatusBanner variant="info">{t('photos.banner_first')}</StatusBanner>
      ) : null}
      {item.profile_is_photo_verified ? (
        <StatusBanner variant="warning">{t('photos.banner_verified')}</StatusBanner>
      ) : null}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
        <div className="flex flex-col gap-2">
          <AdminPhoto
            photoId={item.photo_id}
            url={item.large_url}
            name={name}
            gender={item.gender}
            size="large"
            width={480}
            height={600}
            className="aspect-[4/5] w-full rounded-[var(--radius-card)]"
          />
          <div className="flex items-center gap-2">
            <StatusBadge status={item.status} />
            <Link
              to="/admin/profiles/$profileId"
              params={{ profileId: item.profile_id }}
              className="text-sm text-primary hover:underline"
            >
              {t('photos.open_profile', { code: item.public_code })}
            </Link>
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <Panel title={t('photos.other_photos')}>
            {item.other_photos.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('photos.no_other')}</p>
            ) : (
              <ul className="grid grid-cols-3 gap-2">
                {item.other_photos.map((photo) => (
                  <li key={photo.photo_id} className="flex flex-col gap-1">
                    <AdminPhoto
                      photoId={photo.photo_id}
                      url={photo.medium_url}
                      isPrimary={photo.is_primary}
                      name={name}
                      gender={item.gender}
                      size="medium"
                      width={120}
                      height={150}
                      className="aspect-[4/5] rounded-md"
                    />
                    <span className="flex flex-wrap gap-1">
                      <StatusBadge status={photo.status} />
                      {photo.is_primary ? (
                        <Badge variant="outline">{t('photo.primary')}</Badge>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Facts
            title={t('photos.automatic')}
            columns={1}
            facts={
              item.moderation
                ? Object.entries(item.moderation).map(([key, value]) => ({
                    label: key,
                    value: scoreValue(value),
                  }))
                : [{ label: t('photos.automatic'), value: t('photos.no_automatic') }]
            }
          />
        </div>
      </div>

      <div
        role="toolbar"
        aria-label={t('photos.decision')}
        className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4"
      >
        <Button
          className="w-fit"
          disabled={busy || item.status !== 'pending_review'}
          aria-keyshortcuts="A"
          onClick={onApprove}
        >
          <Check aria-hidden="true" />
          {t('photo.approve')}
          <kbd className="ms-1 text-xs opacity-80">A</kbd>
        </Button>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">{t('photos.reject_with')}</legend>
          <div className="grid grid-cols-2 gap-2">
            {reasons.slice(0, 8).map((reason, index) => (
              <Button
                key={reason.code}
                variant="secondary"
                className="justify-start"
                disabled={busy}
                aria-keyshortcuts={String(index + 1)}
                onClick={() => onReject(reason.code)}
              >
                <kbd className="rounded border border-border bg-muted px-1.5 text-xs">
                  {index + 1}
                </kbd>
                {reason.label}
              </Button>
            ))}
          </div>
        </fieldset>
      </div>

      <Panel title={t('photo.checklist_title')}>
        <table className="w-full text-sm">
          <caption className="sr-only">{t('photo.checklist_title')}</caption>
          <thead>
            <tr>
              <th scope="col" className="pb-1 text-start font-medium text-muted-foreground">
                {t('photo.checklist_finding')}
              </th>
              <th scope="col" className="pb-1 text-start font-medium text-muted-foreground">
                {t('photo.checklist_decision')}
              </th>
            </tr>
          </thead>
          <tbody>
            {checklist.map((row) => (
              <tr key={row.finding} className="border-t border-border">
                <td className="py-1.5 pe-3 align-top">{row.finding}</td>
                <td className="py-1.5 align-top">{row.decision}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </section>
  )
}
