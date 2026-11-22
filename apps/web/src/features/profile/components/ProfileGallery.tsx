import { Link } from '@tanstack/react-router'
import { Camera, ChevronLeft, ChevronRight } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MemberPhoto } from '~/components/common/MemberPhoto'
import { Button } from '~/components/ui/button'
import type { PhotoView, ProfileDetail } from '~/lib/api-types'
import { cn } from '~/lib/utils'
import { PhotoAccessOverlay } from './PhotoAccessOverlay'

/** The approved photos, primary first (16 section 6.7 block 1). */
export function orderedPhotos(photos: readonly PhotoView[]): PhotoView[] {
  return [...photos].sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
}

/**
 * The photo gallery of `APP-PROFILE` (16 section 6.7 block 1) as one large arch: a swipeable
 * strip (scroll snap) with `medium_url` images, a tap that opens `APP-PHOTOS` at that photo, and
 * the arrows and position under the arch, off the photo. Without photos the arch keeps its shape
 * and the caption says so, with no arrows (DESIGN.md 7). When `locked` contains `photos`, one
 * access overlay covers the strip; it grows the arch rather than being cut at larger text.
 */
export function ProfileGallery({
  detail,
  preview = false,
  className,
}: {
  detail: ProfileDetail
  preview?: boolean
  className?: string
}) {
  const { t } = useTranslation(['profile', 'shared'])
  const { card } = detail
  const photos = orderedPhotos(detail.photos)
  const strip = useRef<HTMLUListElement | null>(null)
  const [current, setCurrent] = useState(0)
  const locked = detail.locked.includes('photos') && detail.relation.photo_access !== 'visible'

  if (photos.length === 0) {
    return (
      <figure className={cn('flex min-w-0 flex-col items-center gap-3', className)}>
        <MemberPhoto
          photo={null}
          name={card.display_name}
          gender={card.gender}
          size="medium"
          variant="profile"
          width={400}
          height={500}
          decorative
          className="aspect-[4/5] w-full"
        />
        <figcaption className="flex items-center gap-2 text-center text-title-sm">
          <Camera aria-hidden="true" className="size-[18px]" />
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
    // Smooth through CSS, so reduced motion turns it off.
    slide?.scrollIntoView?.({ block: 'nearest', inline: 'start' })
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
      className={cn('flex min-w-0 flex-col items-center gap-3', className)}
    >
      <div className="relative grid w-full grid-cols-[minmax(0,1fr)]">
        {/* Holds the 4:5, and lets the overlay make the arch taller. */}
        <span aria-hidden="true" className="col-start-1 row-start-1 block aspect-[4/5]" />
        <ul
          ref={strip}
          onScroll={onScroll}
          className="absolute inset-0 flex snap-x snap-mandatory overflow-x-auto overflow-y-hidden rounded-arch-lg scroll-smooth [scrollbar-width:none]"
        >
          {photos.map((photo, index) => {
            const image = (
              <MemberPhoto
                photo={photo}
                name={card.display_name}
                gender={card.gender}
                size="medium"
                variant={locked ? 'bare' : 'profile'}
                width={400}
                height={500}
                priority={index === 0}
                className="size-full rounded-arch-lg"
              />
            )
            return (
              <li
                key={photo.id}
                aria-roledescription="slide"
                aria-label={t('gallery.position', { current: index + 1, total: photos.length })}
                className="relative h-full w-full shrink-0 snap-start"
              >
                {preview ? (
                  image
                ) : (
                  <Link
                    to="/profiles/$profileId/photos"
                    params={{ profileId: card.id }}
                    search={{ index }}
                    aria-label={t('gallery.open', { current: index + 1, total: photos.length })}
                    className="block size-full rounded-arch-lg -outline-offset-[6px]"
                  >
                    {image}
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
        {locked ? (
          <PhotoAccessOverlay
            profileId={card.id}
            name={card.display_name}
            state={detail.relation.photo_access}
            interactive={!preview}
            arch
            className="relative col-start-1 row-start-1 min-w-0"
          />
        ) : null}
      </div>
      {photos.length > 1 ? (
        <div className="flex max-w-full flex-wrap items-center justify-center gap-3">
          <Button
            variant="secondary"
            size="icon"
            aria-label={t('gallery.previous')}
            disabled={current === 0}
            onClick={() => scrollTo(current - 1)}
          >
            <ChevronLeft aria-hidden="true" className="size-5 rtl:-scale-x-100" />
          </Button>
          <p
            aria-live="polite"
            className="text-body-sm text-muted-foreground tabular-nums"
            data-gallery-position=""
          >
            {t('gallery.position', { current: current + 1, total: photos.length })}
          </p>
          <Button
            variant="secondary"
            size="icon"
            aria-label={t('gallery.next')}
            disabled={current === photos.length - 1}
            onClick={() => scrollTo(current + 1)}
          >
            <ChevronRight aria-hidden="true" className="size-5 rtl:-scale-x-100" />
          </Button>
        </div>
      ) : null}
      {locked && card.photo_count >= 2 ? (
        <p className="text-body-sm text-muted-foreground tabular-nums">
          {t('shared:card.photo_count', { count: card.photo_count })}
        </p>
      ) : null}
    </section>
  )
}
