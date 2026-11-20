// APP-PHOTOS (16 section 6.8)
import { useNavigate } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, Flag, X } from 'lucide-react'
import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorState } from '~/components/common/ErrorState'
import { Silhouette } from '~/components/common/MemberPhoto'
import { NoLongerAvailable } from '~/components/common/NoLongerAvailable'
import { useGoBack } from '~/components/common/PageHeader'
import { ReportDialog } from '~/components/common/ReportDialog'
import { ScreenAccess } from '~/components/common/ScreenAccess'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { isApiError } from '~/lib/api'
import type { ProfileDetail } from '~/lib/api-types'
import { PhotoAccessOverlay } from './components/PhotoAccessOverlay'
import { orderedPhotos } from './components/ProfileGallery'
import { useProfile } from './queries'

/** The viewer reuses the profile loaded by `APP-PROFILE` unless it is older than 60 minutes. */
export const VIEWER_STALE_MS = 60 * 60_000

/** A horizontal move of at least this many pixels is a swipe. */
const SWIPE_PX = 50

export function PhotoViewer({ profileId, index = 0 }: { profileId: string; index?: number }) {
  const { t } = useTranslation('shared')
  const profile = useProfile(profileId, { staleTime: VIEWER_STALE_MS })
  const code = isApiError(profile.error) ? profile.error.code : null

  if (profile.data) {
    const tier = profile.data.relation.tier
    return (
      <ScreenAccess
        screen="APP-PHOTOS"
        allowed={
          tier === 'connection' || tier === 'interest_from_owner' || tier === 'interest_to_owner'
        }
      >
        <Viewer detail={profile.data} index={index} refetch={profile.refetch} />
      </ScreenAccess>
    )
  }
  if (code === 'not_found') {
    return (
      <div className="container-app">
        <NoLongerAvailable />
      </div>
    )
  }
  if (profile.isError) {
    return (
      <div className="container-app">
        <ScreenAccess screen="APP-PHOTOS">
          <ErrorState
            error={profile.error}
            onRetry={() => void profile.refetch()}
            retrying={profile.isFetching}
          />
        </ScreenAccess>
      </div>
    )
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
      <Spinner label={t('list.loading')} className="text-white" />
    </div>
  )
}

function Viewer({
  detail,
  index,
  refetch,
}: {
  detail: ProfileDetail
  index: number
  refetch: () => Promise<unknown>
}) {
  const { t, i18n } = useTranslation('profile')
  const navigate = useNavigate()
  const goBack = useGoBack(`/profiles/${detail.card.id}`)
  const { card } = detail
  const photos = orderedPhotos(detail.photos)
  const total = photos.length
  const [current, setCurrent] = useState(() => Math.max(0, Math.min(total - 1, index)))
  const [failed, setFailed] = useState<string | null>(null)
  const [reporting, setReporting] = useState(false)
  const start = useRef<number | null>(null)
  const frame = useRef<HTMLDivElement | null>(null)
  const rtl = i18n.dir() === 'rtl'

  useEffect(() => {
    frame.current?.focus()
  }, [])

  // The open photo is kept in the URL (`index`), without adding history entries.
  useEffect(() => {
    if (current === index || total === 0) return
    void navigate({
      to: '/profiles/$profileId/photos',
      params: { profileId: card.id },
      search: { index: current },
      replace: true,
    })
  }, [current, index, total, navigate, card.id])

  const go = (step: number) => {
    setFailed(null)
    setCurrent((value) => Math.max(0, Math.min(total - 1, value + step)))
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      goBack()
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      go(rtl ? -1 : 1)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      go(rtl ? 1 : -1)
    }
  }

  const onPointerDown = (event: PointerEvent) => {
    start.current = event.clientX
  }
  const onPointerUp = (event: PointerEvent) => {
    if (start.current === null) return
    const dx = event.clientX - start.current
    start.current = null
    if (Math.abs(dx) < SWIPE_PX) return
    // A swipe towards the start shows the next photo (mirrored in right-to-left layouts).
    const towardsStart = rtl ? dx > 0 : dx < 0
    go(towardsStart ? 1 : -1)
  }

  const photo = photos[current]
  const url = photo ? (photo.large_url ?? photo.medium_url) : null
  const showFailure = url !== null && failed === url
  const locked = detail.locked.includes('photos') && photo?.is_blurred

  return (
    <div
      ref={frame}
      role="dialog"
      aria-modal="true"
      aria-label={t('photos.title', { name: card.display_name })}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-50 flex flex-col bg-black text-white outline-none"
    >
      <div className="flex items-center justify-between gap-2 p-2">
        <Button
          variant="ghost"
          size="icon"
          className="text-white hover:bg-white/10"
          aria-label={t('photos.close')}
          onClick={goBack}
        >
          <X aria-hidden="true" className="size-6" />
        </Button>
        {total > 0 ? (
          <p aria-live="polite" data-viewer-position="">
            {t('photos.position', { current: current + 1, total })}
          </p>
        ) : null}
        {photo ? (
          <Button
            variant="ghost"
            className="text-white hover:bg-white/10"
            onClick={() => setReporting(true)}
          >
            <Flag aria-hidden="true" />
            {t('photos.report')}
          </Button>
        ) : (
          <span className="size-11" />
        )}
      </div>

      {/* biome-ignore lint/a11y/noStaticElementInteractions: the swipe repeats the previous and next buttons and the arrow keys */}
      <div
        className="relative flex flex-1 touch-pan-y items-center justify-center overflow-hidden select-none"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onContextMenu={(event) => event.preventDefault()}
      >
        {!photo || showFailure ? (
          <div className="flex flex-col items-center gap-3 p-4 text-center">
            <div className="h-60 w-48 overflow-hidden rounded-[var(--radius-card)]">
              <Silhouette gender={card.gender} label={t('gallery.none')} />
            </div>
            {showFailure ? (
              <>
                <p role="alert">{t('photos.failed')}</p>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setFailed(null)
                    void refetch()
                  }}
                >
                  {t('photos.retry')}
                </Button>
              </>
            ) : (
              <p>{t('gallery.none')}</p>
            )}
          </div>
        ) : (
          <img
            key={photo.id}
            src={url ?? undefined}
            alt={t('gallery.position', { current: current + 1, total })}
            draggable={false}
            onDragStart={(event) => event.preventDefault()}
            onContextMenu={(event) => event.preventDefault()}
            onError={() => setFailed(url)}
            data-viewer-photo={photo.is_blurred ? 'blurred' : 'clear'}
            className="max-h-full max-w-full object-contain"
          />
        )}
        {photo && locked && !showFailure ? (
          <PhotoAccessOverlay
            profileId={card.id}
            name={card.display_name}
            state={detail.relation.photo_access}
            className="bg-black/40"
          />
        ) : null}
        {total > 1 ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="absolute start-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 text-white hover:bg-black/60"
              aria-label={t('photos.previous')}
              disabled={current === 0}
              onClick={() => go(-1)}
            >
              <ChevronLeft aria-hidden="true" className="size-6 rtl:-scale-x-100" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="absolute end-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 text-white hover:bg-black/60"
              aria-label={t('photos.next')}
              disabled={current === total - 1}
              onClick={() => go(1)}
            >
              <ChevronRight aria-hidden="true" className="size-6 rtl:-scale-x-100" />
            </Button>
          </>
        ) : null}
      </div>

      {photo ? (
        <ReportDialog
          open={reporting}
          onOpenChange={setReporting}
          profileId={card.id}
          name={card.display_name}
          subject={{ type: 'photo', photoId: photo.id }}
          onBlocked={() => void navigate({ to: '/home' })}
        />
      ) : null}
    </div>
  )
}
