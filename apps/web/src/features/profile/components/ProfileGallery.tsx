import { Link } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MemberPhoto } from '~/components/common/MemberPhoto'
import { Button } from '~/components/ui/button'
import type { PhotoView, ProfileDetail } from '~/lib/api-types'
import { PhotoAccessOverlay } from './PhotoAccessOverlay'

/** The approved photos, primary first (16 section 6.7 block 1). */
export function orderedPhotos(photos: readonly PhotoView[]): PhotoView[] {
  return [...photos].sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
}

/**
 * The photo gallery of `APP-PROFILE` (16 section 6.7 block 1): a swipeable strip (scroll snap)
 * with a position indicator, `medium_url` images, and a tap that opens `APP-PHOTOS` at that
 * photo. Without photos: the placeholder and "No photo added yet". When `locked` contains
 * `photos`, the photo access overlay is drawn over the blurred image.
 */
export function ProfileGallery({
  detail,
  preview = false,
}: {
  detail: ProfileDetail
  preview?: boolean
}) {
  const { t } = useTranslation('profile')
  const { card } = detail
  const photos = orderedPhotos(detail.photos)
  const strip = useRef<HTMLUListElement | null>(null)
  const [current, setCurrent] = useState(0)
  const locked = detail.locked.includes('photos')

  if (photos.length === 0) {
    return (
      <figure className="flex flex-col gap-2">
        <MemberPhoto
          photo={null}
          name={card.display_name}
          gender={card.gender}
          size="medium"
          width={400}
          height={500}
          className="aspect-[4/5] w-full rounded-[var(--radius-card)]"
        />
        <figcaption className="text-center text-sm text-muted-foreground">
          {t('gallery.none')}
        </figcaption>
      </figure>
    )
  }

  const scrollTo = (index: number) => {
    const node = strip.current
    const next = Math.max(0, Math.min(photos.length - 1, index))
    setCurrent(next)
    const slide = node?.children[next] as HTMLElement | undefined
    slide?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest', inline: 'start' })
  }

  const onScroll = () => {
    const node = strip.current
    if (!node || node.clientWidth === 0) return
    const index = Math.round(Math.abs(node.scrollLeft) / node.clientWidth)
    if (index !== current) setCurrent(Math.max(0, Math.min(photos.length - 1, index)))
  }

  return (
    <section
      aria-roledescription="carousel"
      aria-label={t('gallery.label', { name: card.display_name })}
      className="relative"
    >
      <ul
        ref={strip}
        onScroll={onScroll}
        className="flex snap-x snap-mandatory overflow-x-auto rounded-[var(--radius-card)] [scrollbar-width:none]"
      >
        {photos.map((photo, index) => {
          const image = (
            <MemberPhoto
              photo={photo}
              name={card.display_name}
              gender={card.gender}
              size="medium"
              width={400}
              height={500}
              priority={index === 0}
              className="aspect-[4/5] w-full"
            />
          )
          const label = t('gallery.open', { current: index + 1, total: photos.length })
          return (
            <li
              key={photo.id}
              aria-roledescription="slide"
              aria-label={t('gallery.position', { current: index + 1, total: photos.length })}
              className="relative w-full shrink-0 snap-start"
            >
              {preview ? (
                image
              ) : (
                <Link
                  to="/profiles/$profileId/photos"
                  params={{ profileId: card.id }}
                  search={{ index }}
                  aria-label={label}
                  className="block"
                >
                  {image}
                </Link>
              )}
              {locked ? (
                <PhotoAccessOverlay
                  profileId={card.id}
                  name={card.display_name}
                  state={detail.relation.photo_access}
                  interactive={!preview}
                />
              ) : null}
            </li>
          )
        })}
      </ul>
      {photos.length > 1 ? (
        <>
          <p
            aria-live="polite"
            className="absolute top-2 end-2 rounded-full bg-foreground/75 px-2.5 py-0.5 text-sm text-background"
            data-gallery-position=""
          >
            {t('gallery.position', { current: current + 1, total: photos.length })}
          </p>
          <div className="pointer-events-none absolute inset-x-1 top-1/2 flex -translate-y-1/2 justify-between">
            <Button
              variant="secondary"
              size="icon"
              className="pointer-events-auto rounded-full bg-surface/90"
              aria-label={t('gallery.previous')}
              disabled={current === 0}
              onClick={() => scrollTo(current - 1)}
            >
              <ChevronLeft aria-hidden="true" className="size-5 rtl:-scale-x-100" />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              className="pointer-events-auto rounded-full bg-surface/90"
              aria-label={t('gallery.next')}
              disabled={current === photos.length - 1}
              onClick={() => scrollTo(current + 1)}
            >
              <ChevronRight aria-hidden="true" className="size-5 rtl:-scale-x-100" />
            </Button>
          </div>
        </>
      ) : null}
    </section>
  )
}
