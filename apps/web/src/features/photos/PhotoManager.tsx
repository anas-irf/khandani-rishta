import {
  CircleX,
  Clock,
  ImageOff,
  Loader2,
  type LucideIcon,
  MoreVertical,
  Plus,
  RotateCcw,
  Star,
  X,
} from 'lucide-react'
import { type ChangeEvent, type DragEvent, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConfirmDialog } from '~/components/common/ConfirmDialog'
import { ErrorState } from '~/components/common/ErrorState'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Progress } from '~/components/ui/progress'
import { Skeleton } from '~/components/ui/skeleton'
import { isApiError } from '~/lib/api'
import type { OwnPhoto } from '~/lib/api-types'
import { IMAGE_ACCEPT } from '~/lib/image'
import { useCurrentMe } from '~/lib/me'
import { cn } from '~/lib/utils'
import {
  countsTowardLimit,
  moveId,
  moveIdTo,
  useDeletePhoto,
  useMakePrimary,
  useOwnPhotos,
  useReorderPhotos,
} from './queries'
import { type UploadSlot, usePhotoUploads } from './usePhotoUploads'

export type PhotoManagerProps = {
  /**
   * `me` on `ME-PHOTOS`; `onboarding` when `ONB-08` composes it (07 section 10), which adds
   * the privacy choice and its own buttons around it.
   */
  context: 'onboarding' | 'me'
}

type PendingAction = { kind: 'primary' | 'remove'; photo: OwnPhoto }

/**
 * The photo grid of `ME-PHOTOS` (08 section 5.5) and `ONB-08` (07 section 10.1): uploads with
 * progress (08 section 5.2), status labels, the main photo, reordering (drag, or "Move
 * earlier" and "Move later"), removal with confirmation (16 rule G8), rejection messages and
 * the photo rules (13 section 4.1). Every change waits for the server.
 */
export function PhotoManager({ context }: PhotoManagerProps) {
  const { t } = useTranslation('photos')
  const me = useCurrentMe()
  const photosMax = me.config.photos_max
  const photoVerified = me.profile.badges.includes('photo_verified')
  const photosQuery = useOwnPhotos()
  const makePrimary = useMakePrimary()
  const reorder = useReorderPhotos()
  const deletePhoto = useDeletePhoto()
  const uploads = usePhotoUploads({
    photosMax,
    onMessage: (message) => toast.error(t(message.key, message.values ?? {})),
  })
  const inputRef = useRef<HTMLInputElement>(null)
  const rulesId = useId()
  const [viewerId, setViewerId] = useState<string | null>(null)
  const [verifiedWarning, setVerifiedWarning] = useState<PendingAction | null>(null)
  const [removeTarget, setRemoveTarget] = useState<OwnPhoto | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)

  if (photosQuery.isPending) return <GridSkeleton slots={photosMax} />
  if (photosQuery.isError) {
    return (
      <ErrorState
        error={photosQuery.error}
        onRetry={() => void photosQuery.refetch()}
        retrying={photosQuery.isFetching}
      />
    )
  }

  const photos = photosQuery.data
  const ids = photos.map((photo) => photo.id)
  const activeCount = photos.filter(countsTowardLimit).length + uploads.slots.length
  const freeSlots = Math.max(0, photosMax - activeCount)
  const atLimit = freeSlots === 0
  const problems = photos.filter(
    (photo) => photo.status === 'rejected' || photo.status === 'failed',
  )
  const viewerPhoto = photos.find((photo) => photo.id === viewerId) ?? null
  const isEmpty = photos.length === 0 && uploads.slots.length === 0

  const openPicker = () => {
    if (!atLimit) inputRef.current?.click()
  }

  const onPicked = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length > 0) uploads.addFiles(files, freeSlots)
  }

  const doMakePrimary = (photo: OwnPhoto) =>
    makePrimary.mutateAsync(photo.id).then(
      () => {
        toast.success(t('toast.main_changed'))
      },
      (error: unknown) => {
        if (isApiError(error) && error.code === 'invalid_state')
          toast.error(t('toast.main_invalid'))
        throw error
      },
    )

  // 08 section 5.5 rule 1: changing or removing the main photo of a photo-verified profile.
  const requestPrimary = (photo: OwnPhoto) => {
    if (photoVerified) setVerifiedWarning({ kind: 'primary', photo })
    else void doMakePrimary(photo).catch(() => undefined)
  }

  const requestRemove = (photo: OwnPhoto) => {
    if (photoVerified && photo.is_primary) setVerifiedWarning({ kind: 'remove', photo })
    else setRemoveTarget(photo)
  }

  const saveOrder = (next: string[]) => {
    if (next.join() === ids.join()) return
    reorder.mutate(next, { onError: () => toast.error(t('toast.order_failed')) })
  }

  const move = (photo: OwnPhoto, delta: -1 | 1) => saveOrder(moveId(ids, photo.id, delta))

  const onDrop = (event: DragEvent, target: OwnPhoto) => {
    event.preventDefault()
    const source = dragId ?? event.dataTransfer.getData('text/plain')
    setDragId(null)
    if (source && ids.includes(source)) saveOrder(moveIdTo(ids, source, target.id))
  }

  const slotActions = (photo: OwnPhoto, index: number) => ({
    canMakeMain: photo.status === 'approved' && !photo.is_primary,
    canMoveEarlier: index > 0 && !reorder.isPending,
    canMoveLater: index < photos.length - 1 && !reorder.isPending,
  })

  return (
    <div className="flex flex-col gap-5" data-photo-context={context}>
      {context === 'me' && isEmpty ? (
        <p className="text-muted-foreground">{t('grid.empty')}</p>
      ) : null}

      <ul
        aria-label={t('grid.label')}
        aria-busy={reorder.isPending || undefined}
        className="grid grid-cols-3 gap-3"
      >
        {photos.map((photo, index) => {
          const actions = slotActions(photo, index)
          return (
            <li
              key={photo.id}
              data-photo-status={photo.status}
              draggable={photos.length > 1 && !reorder.isPending}
              onDragStart={(event) => {
                setDragId(photo.id)
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', photo.id)
              }}
              onDragEnd={() => setDragId(null)}
              onDragOver={(event) => {
                if (dragId && dragId !== photo.id) event.preventDefault()
              }}
              onDrop={(event) => onDrop(event, photo)}
              className={cn(
                'relative aspect-square overflow-hidden rounded-[var(--radius-input)] border border-border bg-muted',
                dragId === photo.id && 'opacity-50',
              )}
            >
              <button
                type="button"
                className="block size-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                aria-label={t('grid.open', { position: index + 1 })}
                onClick={() => setViewerId(photo.id)}
              >
                <OwnPhotoImage photo={photo} position={index + 1} />
              </button>
              <StatusLabel photo={photo} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="absolute end-1 top-1 size-11 rounded-full bg-surface/90"
                    aria-label={t('grid.options', { position: index + 1 })}
                  >
                    <MoreVertical aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setViewerId(photo.id)}>
                    {t('actions.view')}
                  </DropdownMenuItem>
                  {actions.canMakeMain ? (
                    <DropdownMenuItem onSelect={() => requestPrimary(photo)}>
                      {t('actions.make_main')}
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem
                    disabled={!actions.canMoveEarlier}
                    onSelect={() => move(photo, -1)}
                  >
                    {t('actions.move_earlier')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!actions.canMoveLater}
                    onSelect={() => move(photo, 1)}
                  >
                    {t('actions.move_later')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => requestRemove(photo)}>
                    {t('actions.remove')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          )
        })}

        {uploads.slots.map((slot) => (
          <li
            key={slot.id}
            data-upload-state={slot.state}
            className="relative aspect-square overflow-hidden rounded-[var(--radius-input)] border border-border bg-muted"
          >
            <UploadSlotView
              slot={slot}
              onCancel={() => uploads.cancel(slot.id)}
              onRetry={() => uploads.retry(slot.id)}
              onDismiss={() => uploads.dismiss(slot.id)}
            />
          </li>
        ))}

        {Array.from({ length: freeSlots }, (_, index) => {
          const position = photos.length + uploads.slots.length + index
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: empty slots have no identity.
            <li key={`empty-${index}`} className="aspect-square">
              <button
                type="button"
                onClick={openPicker}
                aria-label={t('grid.add_named', { count: freeSlots, max: photosMax })}
                className="flex size-full flex-col items-center justify-center gap-1 rounded-[var(--radius-input)] border-2 border-dashed border-border bg-surface text-muted-foreground hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus aria-hidden="true" className="size-7" />
                {position === 0 ? (
                  <span className="text-sm font-medium">{t('status.main')}</span>
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>

      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        multiple
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        data-testid="photo-input"
        onChange={onPicked}
      />

      {atLimit ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t('grid.limit', { max: photosMax })}
        </p>
      ) : (
        <Button variant="secondary" className="self-start" onClick={openPicker}>
          <Plus aria-hidden="true" />
          {t('grid.add')}
        </Button>
      )}

      {photos.length > 1 ? (
        <p className="hidden text-sm text-muted-foreground md:block">{t('grid.drag_hint')}</p>
      ) : null}

      {problems.length > 0 ? (
        <section aria-labelledby={`${rulesId}-problems`} className="flex flex-col gap-3">
          <h2 id={`${rulesId}-problems`} className="font-semibold">
            {t('rejections.title')}
          </h2>
          <ul className="flex flex-col gap-3">
            {problems.map((photo) => (
              <li
                key={photo.id}
                className="flex flex-col gap-2 rounded-[var(--radius-input)] border border-danger/40 bg-danger-soft p-3"
              >
                <p>{rejectionText(t, photo)}</p>
                <div className="flex flex-wrap gap-2">
                  {photo.status === 'rejected' ? (
                    <Button
                      variant="link"
                      className="h-11 px-0"
                      onClick={() => {
                        const rules = document.getElementById(rulesId)
                        rules?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                        rules?.focus({ preventScroll: true })
                      }}
                    >
                      {t('rejections.guidelines')}
                    </Button>
                  ) : null}
                  <Button variant="secondary" onClick={() => requestRemove(photo)}>
                    {t('actions.remove')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <PhotoRules id={rulesId} context={context} />

      <PhotoViewer
        photo={viewerPhoto}
        position={viewerPhoto ? ids.indexOf(viewerPhoto.id) + 1 : 0}
        count={photos.length}
        reordering={reorder.isPending}
        onClose={() => setViewerId(null)}
        onMakeMain={requestPrimary}
        onMove={move}
        onRemove={requestRemove}
      />

      <ConfirmDialog
        open={verifiedWarning !== null}
        onOpenChange={(open) => {
          if (!open) setVerifiedWarning(null)
        }}
        title={t('verified_dialog.title')}
        description={t('verified_dialog.description')}
        confirmLabel={t('verified_dialog.confirm')}
        cancelLabel={t('verified_dialog.cancel')}
        onConfirm={async () => {
          const pending = verifiedWarning
          if (!pending) return
          if (pending.kind === 'remove') {
            setRemoveTarget(pending.photo)
            return
          }
          await doMakePrimary(pending.photo)
        }}
      />

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null)
        }}
        title={t('remove_dialog.title')}
        description={t('remove_dialog.description')}
        confirmLabel={t('remove_dialog.confirm')}
        cancelLabel={t('remove_dialog.cancel')}
        destructive
        onConfirm={async () => {
          if (!removeTarget) return
          await deletePhoto.mutateAsync(removeTarget.id)
          if (viewerId === removeTarget.id) setViewerId(null)
          toast.success(t('toast.removed'))
        }}
      />
    </div>
  )
}

type TFunction = ReturnType<typeof useTranslation<'photos'>>['t']

/** The message of block 3 (08 section 5.5; reasons from 13 section 4.3). */
function rejectionText(t: TFunction, photo: OwnPhoto): string {
  if (photo.status === 'failed') return t('rejections.failed')
  const reason = photo.rejection_reason ?? 'other'
  return t(`rejections.reason.${reason}`, { defaultValue: t('rejections.reason.other') })
}

const STATUS_ICONS: Record<OwnPhoto['status'], LucideIcon | null> = {
  processing: Loader2,
  pending_review: Clock,
  approved: null,
  rejected: CircleX,
  failed: ImageOff,
}

/** The label over a slot (08 section 5.5): status, or "Main photo" on the primary one. */
function StatusLabel({ photo }: { photo: OwnPhoto }) {
  const { t } = useTranslation('photos')
  if (photo.status === 'approved' && !photo.is_primary) return null
  const Icon = photo.status === 'approved' ? Star : STATUS_ICONS[photo.status]
  const text = photo.status === 'approved' ? t('status.main') : t(`status.${photo.status}`)
  const tone =
    photo.status === 'rejected' || photo.status === 'failed'
      ? 'bg-danger text-danger-foreground'
      : photo.status === 'approved'
        ? 'bg-primary text-primary-foreground'
        : 'bg-foreground/80 text-background'
  return (
    <span
      className={cn(
        'pointer-events-none absolute inset-x-1 bottom-1 inline-flex items-center justify-center gap-1 truncate rounded-full px-2 py-1 text-sm font-medium',
        tone,
      )}
    >
      {Icon ? (
        <Icon
          aria-hidden="true"
          className={cn('size-3.5 shrink-0', photo.status === 'processing' && 'animate-spin')}
        />
      ) : null}
      <span className="truncate">{text}</span>
    </span>
  )
}

function OwnPhotoImage({
  photo,
  position,
  variant = 'thumb',
}: {
  photo: OwnPhoto
  position: number
  variant?: 'thumb' | 'large'
}) {
  const { t } = useTranslation('photos')
  const url =
    variant === 'large'
      ? (photo.large_url ?? photo.medium_url ?? photo.thumb_url)
      : (photo.thumb_url ?? photo.medium_url)
  if (!url) {
    return (
      <span className="flex size-full items-center justify-center text-muted-foreground">
        {photo.status === 'processing' ? (
          <Loader2 aria-hidden="true" className="size-6 animate-spin" />
        ) : (
          <ImageOff aria-hidden="true" className="size-6" />
        )}
        <span className="sr-only">{t('grid.photo_alt', { position })}</span>
      </span>
    )
  }
  return (
    <img
      src={url}
      alt={t('grid.photo_alt', { position })}
      width={variant === 'large' ? 800 : 320}
      height={variant === 'large' ? 800 : 320}
      draggable={false}
      loading="lazy"
      decoding="async"
      className={cn(
        'select-none',
        variant === 'large' ? 'max-h-[70dvh] w-full object-contain' : 'size-full object-cover',
      )}
    />
  )
}

function UploadSlotView({
  slot,
  onCancel,
  onRetry,
  onDismiss,
}: {
  slot: UploadSlot
  onCancel: () => void
  onRetry: () => void
  onDismiss: () => void
}) {
  const { t } = useTranslation('photos')
  const label =
    slot.state === 'waiting'
      ? t('status.waiting')
      : slot.state === 'uploading'
        ? t('status.uploading')
        : slot.state === 'confirming'
          ? t('status.processing')
          : t('status.upload_failed')

  return (
    <>
      {slot.previewUrl ? (
        <img
          src={slot.previewUrl}
          alt={t('grid.upload_alt')}
          width={320}
          height={320}
          draggable={false}
          className={cn('size-full object-cover', slot.state !== 'failed' && 'opacity-60')}
        />
      ) : null}
      <div className="absolute inset-x-1 bottom-1 flex flex-col gap-1">
        <span
          role="status"
          className={cn(
            'inline-flex items-center justify-center gap-1 truncate rounded-full px-2 py-1 text-sm font-medium',
            slot.state === 'failed'
              ? 'bg-danger text-danger-foreground'
              : 'bg-foreground/80 text-background',
          )}
        >
          {slot.state === 'failed' ? null : (
            <Loader2 aria-hidden="true" className="size-3.5 shrink-0 animate-spin" />
          )}
          <span className="truncate">{label}</span>
        </span>
        {slot.state === 'uploading' ? (
          <Progress
            value={Math.round(slot.progress * 100)}
            aria-label={t('status.progress')}
            className="bg-surface/80"
          />
        ) : null}
      </div>
      {slot.state === 'failed' ? (
        <div className="absolute inset-0 flex items-center justify-center gap-1 bg-surface/60">
          <Button size="icon" variant="secondary" aria-label={t('actions.retry')} onClick={onRetry}>
            <RotateCcw aria-hidden="true" />
          </Button>
          <Button
            size="icon"
            variant="secondary"
            aria-label={t('actions.dismiss')}
            onClick={onDismiss}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      ) : slot.state !== 'confirming' ? (
        <Button
          variant="secondary"
          size="icon"
          className="absolute end-1 top-1 rounded-full bg-surface/90"
          aria-label={t('actions.cancel_upload')}
          onClick={onCancel}
        >
          <X aria-hidden="true" />
        </Button>
      ) : null}
    </>
  )
}

/** Tapping a filled slot: the own photo full size with its controls (08 section 5.5). */
function PhotoViewer({
  photo,
  position,
  count,
  reordering,
  onClose,
  onMakeMain,
  onMove,
  onRemove,
}: {
  photo: OwnPhoto | null
  position: number
  count: number
  reordering: boolean
  onClose: () => void
  onMakeMain: (photo: OwnPhoto) => void
  onMove: (photo: OwnPhoto, delta: -1 | 1) => void
  onRemove: (photo: OwnPhoto) => void
}) {
  const { t } = useTranslation('photos')
  return (
    <Dialog open={photo !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent closeLabel={t('actions.close')} className="max-w-2xl">
        {photo ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('viewer.title', { position })}</DialogTitle>
              <DialogDescription>{t('viewer.description')}</DialogDescription>
            </DialogHeader>
            <div className="relative overflow-hidden rounded-[var(--radius-input)] bg-muted">
              <OwnPhotoImage photo={photo} position={position} variant="large" />
              <StatusLabel photo={photo} />
            </div>
            <DialogFooter className="flex-wrap">
              {photo.status === 'approved' && !photo.is_primary ? (
                <Button onClick={() => onMakeMain(photo)}>{t('actions.make_main')}</Button>
              ) : null}
              <Button
                variant="secondary"
                disabled={position <= 1 || reordering}
                onClick={() => onMove(photo, -1)}
              >
                {t('actions.move_earlier')}
              </Button>
              <Button
                variant="secondary"
                disabled={position >= count || reordering}
                onClick={() => onMove(photo, 1)}
              >
                {t('actions.move_later')}
              </Button>
              <Button variant="destructive" onClick={() => onRemove(photo)}>
                {t('actions.remove')}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

/** The "Do" and "Do not" list of 13 section 4.1. */
export function PhotoRules({ id, context }: { id?: string; context: 'onboarding' | 'me' }) {
  const { t } = useTranslation('photos')
  const dos = t('rules.do', { returnObjects: true }) as string[]
  const donts = t('rules.dont', { returnObjects: true }) as string[]
  return (
    <section
      id={id}
      tabIndex={-1}
      aria-labelledby={id ? `${id}-title` : undefined}
      className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 outline-none"
    >
      <h2 id={id ? `${id}-title` : undefined} className="font-semibold">
        {t('rules.title')}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="mb-1 text-sm font-semibold text-success">{t('rules.do_title')}</h3>
          <ul className="list-disc ps-5">
            {dos.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-1 text-sm font-semibold text-danger">{t('rules.dont_title')}</h3>
          <ul className="list-disc ps-5">
            {donts.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </div>
      </div>
      {context === 'onboarding' ? (
        <p className="text-sm text-muted-foreground">{t('rules.reviewed')}</p>
      ) : null}
    </section>
  )
}

function GridSkeleton({ slots }: { slots: number }) {
  const { t } = useTranslation('shared')
  return (
    <div role="status" aria-busy="true" className="grid grid-cols-3 gap-3">
      <span className="sr-only">{t('list.loading')}</span>
      {Array.from({ length: slots }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity.
        <Skeleton key={index} className="aspect-square rounded-[var(--radius-input)]" />
      ))}
    </div>
  )
}
