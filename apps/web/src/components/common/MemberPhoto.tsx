import { Lock } from 'lucide-react'
import { type MouseEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Gender, PhotoView } from '~/lib/api-types'
import { cn } from '~/lib/utils'

export type MemberPhotoSize = 'thumb' | 'medium' | 'large'

export type MemberPhotoProps = {
  /** The photo as the API sent it for this viewer; null when the profile has none. */
  photo: PhotoView | null
  /** The member's `display_name`, for the alt text. */
  name: string
  /** Chooses the placeholder silhouette when `photo` is null. */
  gender: Gender
  /**
   * Variant by place (16 rule G10): `thumb` in compact cards and rows, `medium` in full-size
   * cards and on the profile, `large` only in the photo viewer.
   */
  size: MemberPhotoSize
  /** Intrinsic size of the image in CSS pixels (avoids layout shift). */
  width: number
  height: number
  /** Shows the "Photo is private" text next to the lock (default: all sizes except `thumb`). */
  showPrivateLabel?: boolean
  /** Eager loading for the first, above-the-fold photo of a screen. */
  priority?: boolean
  className?: string
  imageClassName?: string
}

function urlFor(photo: PhotoView, size: MemberPhotoSize): string {
  if (size === 'thumb') return photo.thumb_url
  if (size === 'large') return photo.large_url ?? photo.medium_url
  return photo.medium_url
}

function preventDefault(event: MouseEvent) {
  event.preventDefault()
}

/**
 * Another member's photo (17 sections 10 and 11, 09 section 6). The image is shown exactly as
 * received: a blurred photo is a separate file from the API and is never blurred or unblurred
 * here. Dragging and the context menu are disabled; there is no save or share control.
 */
export function MemberPhoto({
  photo,
  name,
  gender,
  size,
  width,
  height,
  showPrivateLabel = size !== 'thumb',
  priority = false,
  className,
  imageClassName,
}: MemberPhotoProps) {
  const { t } = useTranslation('shared')
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const url = photo ? urlFor(photo, size) : null
  const showImage = photo !== null && url !== null && url !== failedUrl

  return (
    <div
      className={cn('relative overflow-hidden bg-muted', className)}
      data-photo-state={photo ? (photo.is_blurred ? 'blurred' : 'clear') : 'none'}
    >
      {showImage ? (
        <img
          src={url}
          alt={t('photo.alt', { name })}
          width={width}
          height={height}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onContextMenu={preventDefault}
          onDragStart={preventDefault}
          onError={() => setFailedUrl(url)}
          data-member-photo=""
          className={cn('block h-full w-full select-none object-cover', imageClassName)}
        />
      ) : (
        <Silhouette gender={gender} label={t('photo.none')} width={width} height={height} />
      )}
      {photo?.is_blurred ? (
        <span className="absolute bottom-2 start-2 inline-flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-full bg-foreground/75 px-2 py-1 text-sm text-background">
          <Lock aria-hidden="true" className="size-3.5 shrink-0" />
          <span className={cn('truncate', !showPrivateLabel && 'sr-only')}>
            {t('photo.private')}
          </span>
        </span>
      ) : null}
    </div>
  )
}

/**
 * The neutral placeholder for a profile without a photo (16 rule G10): a silhouette that
 * differs for male and female profiles. Inline SVG, so it needs no request.
 */
export function Silhouette({
  gender,
  label,
  width,
  height,
  className,
}: {
  gender: Gender
  label: string
  width?: number
  height?: number
  className?: string
}) {
  return (
    <svg
      role="img"
      aria-label={label}
      width={width}
      height={height}
      viewBox="0 0 100 125"
      preserveAspectRatio="xMidYMid slice"
      data-silhouette={gender}
      className={cn('block h-full w-full bg-muted text-muted-foreground/40', className)}
    >
      {gender === 'female' ? (
        <g fill="currentColor">
          {/* Head and a draped dupatta around it, falling to the shoulders. */}
          <path d="M50 22c-15 0-25 11-25 27 0 9 2 16 1 24 8-3 16-4 24-4s16 1 24 4c-1-8 1-15 1-24 0-16-10-27-25-27Z" />
          <ellipse cx="50" cy="50" rx="13" ry="16" className="fill-muted" />
          <ellipse cx="50" cy="50" rx="13" ry="16" opacity="0.55" />
          <path d="M14 125c0-22 14-38 36-38s36 16 36 38Z" />
        </g>
      ) : (
        <g fill="currentColor">
          {/* Head with short hair, then broad shoulders. */}
          <circle cx="50" cy="48" r="17" />
          <path d="M33 44c0-12 8-19 17-19s17 7 17 19c-4-6-10-8-17-8s-13 2-17 8Z" />
          <path d="M10 125c0-24 16-42 40-42s40 18 40 42Z" />
        </g>
      )}
    </svg>
  )
}
