import { Camera, Lock } from 'lucide-react'
import { type MouseEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Gender, PhotoView } from '~/lib/api-types'
import { cn } from '~/lib/utils'
import { ArchFrame, ArchInlay, Monogram } from './Arch'
import { Diamond } from './Ornament'

export type MemberPhotoSize = 'thumb' | 'medium' | 'large'

/**
 * How the states of DESIGN.md 6.8 are layered:
 *
 * - `card`: veil, inner arch line, diamond, monogram and the pill with words.
 * - `tile`: veil and monogram; the words are for screen readers.
 * - `compact`: rows and thumbs, where private is a small lock disc.
 * - `profile`: the gallery, with the double line and a larger monogram. Its caption has the words.
 * - `bare`: the image alone, for a place that draws its own treatment over it.
 */
export type MemberPhotoVariant = 'card' | 'tile' | 'compact' | 'profile' | 'bare'

export type MemberPhotoProps = {
  /** The photo as the API sent it for this viewer; null when the profile has none. */
  photo: PhotoView | null
  /**
   * The member's `display_name`, for the alt text and the monogram. Null when the member is
   * not known (a connection that is no longer available): the silhouette stands in.
   */
  name: string | null
  /** Chooses the silhouette when there is no name to make a monogram from. */
  gender: Gender
  /**
   * The file by place (16 rule G10): `thumb` in compact cards and rows, `medium` in full-size
   * cards, tiles and on the profile, `large` only in the photo viewer.
   */
  size: MemberPhotoSize
  /** Default: `compact` for `thumb`, otherwise `card`. */
  variant?: MemberPhotoVariant
  /** Intrinsic size of the image in CSS pixels (avoids layout shift). */
  width: number
  height: number
  /** Shows the "Photo is private" text next to the lock (default: on `card` and `profile`). */
  showPrivateLabel?: boolean
  /** Inside a card whose name already says the photo's state (DESIGN.md 8.3). */
  decorative?: boolean
  /** The "4 photos" chip, shown from 2. */
  count?: number
  /** The "New" chip. This is where the `new` badge shows (12 section 1.2). */
  isNew?: boolean
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

const CHIP = 'rounded-pill px-3 py-[5px] text-label-sm'

/**
 * Another member's photo, always an arch (DESIGN.md 6.8, 17 sections 10 and 11, 09 section 6).
 *
 * The image is shown exactly as received: a blurred photo is a separate file from the API and is
 * never blurred or unblurred here (16 rule G10). The private treatment is layers over that image.
 * Dragging and the context menu are disabled; there is no save or share control.
 */
export function MemberPhoto({
  photo,
  name,
  gender,
  size,
  variant = size === 'thumb' ? 'compact' : 'card',
  width,
  height,
  showPrivateLabel = variant === 'card' || variant === 'profile',
  decorative = false,
  count = 0,
  isNew = false,
  priority = false,
  className,
  imageClassName,
}: MemberPhotoProps) {
  const { t } = useTranslation('shared')
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const url = photo ? urlFor(photo, size) : null
  const showImage = url !== null && url !== failedUrl
  const compact = variant === 'compact'
  const large = variant === 'card' || variant === 'profile'
  const alt = t('photo.alt', { name: name ?? '' })
  const blurred = photo?.is_blurred === true && variant !== 'bare'
  const hasChips = isNew || (variant === 'card' && count >= 2)
  const hasMonogram = Boolean(name)

  // A placeholder is one picture with one name: no photo, or a photo that did not load.
  const asImage =
    !decorative && !showImage && hasMonogram
      ? { role: 'img', 'aria-label': photo ? alt : t('photo.none') }
      : {}

  const monogramSize =
    variant === 'profile'
      ? 'profile'
      : variant === 'card'
        ? 'card'
        : compact
          ? width < 56
            ? 'xs'
            : 'sm'
          : 'md'

  return (
    <ArchFrame
      large={variant === 'profile'}
      aria-hidden={decorative || undefined}
      data-photo-state={photo ? (photo.is_blurred ? 'blurred' : 'clear') : 'none'}
      className={cn('shrink-0', !showImage && 'lattice', className)}
      {...asImage}
    >
      {showImage ? (
        <img
          src={url}
          alt={decorative ? '' : alt}
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
      ) : hasMonogram ? null : (
        <Silhouette gender={gender} label={t('photo.none')} width={width} height={height} />
      )}

      {(hasMonogram && !showImage) || (blurred && !compact) ? (
        <span
          data-slot="photo-veil"
          className={cn(
            'pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-center',
            large && 'px-[24px] pt-[24px]',
            // Room at the bottom, so the chips never cover the pill at larger text.
            large && (hasChips ? 'pb-[calc(16px+2.2em)]' : 'pb-[24px]'),
            showImage && 'bg-muted/55',
          )}
        >
          {large ? (
            <>
              <ArchInlay double={variant === 'profile'} />
              <Diamond className="size-[9px]" />
            </>
          ) : null}
          <Monogram name={name} size={monogramSize} />
          {variant === 'card' && !photo ? <StatePill icon={Camera} text={t('photo.none')} /> : null}
          {blurred && large ? (
            <StatePill icon={Lock} text={t('photo.private')} textHidden={!showPrivateLabel} />
          ) : null}
        </span>
      ) : null}

      {blurred && compact ? (
        <span
          className={cn(
            'pointer-events-none absolute inset-0 flex justify-center',
            isNew ? 'items-center' : 'items-end pb-[5px]',
          )}
        >
          <span className="flex size-[24px] items-center justify-center rounded-pill bg-background">
            <Lock aria-hidden="true" strokeWidth={2.4} className="size-[13px]" />
          </span>
          <span className="sr-only">{t('photo.private')}</span>
        </span>
      ) : null}
      {blurred && variant === 'tile' ? <span className="sr-only">{t('photo.private')}</span> : null}

      {hasChips ? (
        <span
          className={cn(
            'pointer-events-none absolute flex flex-wrap items-end justify-between gap-2',
            compact
              ? 'inset-x-0 bottom-[4px] justify-center'
              : variant === 'tile'
                ? 'inset-x-[10px] bottom-[10px]'
                : 'inset-x-[16px] bottom-[16px]',
          )}
        >
          {isNew ? (
            <span
              data-badge="new"
              className={cn(
                CHIP,
                'bg-primary font-bold text-primary-foreground',
                compact && 'px-2 py-0',
                variant === 'tile' && 'px-2.5 py-[3px]',
              )}
            >
              {t('badge.new')}
            </span>
          ) : null}
          {variant === 'card' && count >= 2 ? (
            <span className={cn(CHIP, 'ms-auto bg-inverse/82 text-background tabular-nums')}>
              {t('card.photo_count', { count })}
            </span>
          ) : null}
        </span>
      ) : null}
    </ArchFrame>
  )
}

function StatePill({
  icon: Icon,
  text,
  textHidden = false,
}: {
  icon: typeof Lock
  text: string
  textHidden?: boolean
}) {
  return (
    <span className="relative inline-flex max-w-full items-center gap-2 rounded-lg bg-background px-[12px] py-[8px] text-label-sm font-bold text-foreground">
      <Icon aria-hidden="true" strokeWidth={2.2} className="size-[1em]" />
      <span className={cn(textHidden && 'sr-only')}>{text}</span>
    </span>
  )
}

/**
 * The neutral figure for a member we have no name for (16 rule G10): a silhouette that differs
 * for male and female profiles. Inline SVG, so it needs no request.
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
      className={cn('block h-full w-full text-input/60', className)}
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

/** The arch of a member who is no longer available, with their silhouette. */
export function UnavailablePhoto({
  gender,
  label,
  className,
}: {
  gender: Gender
  label: string
  className?: string
}) {
  return (
    <ArchFrame className={cn('lattice shrink-0', className)}>
      <Silhouette gender={gender} label={label} />
    </ArchFrame>
  )
}
