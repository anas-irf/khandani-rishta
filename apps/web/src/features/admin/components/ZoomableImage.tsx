import { RotateCcw, RotateCw, ZoomIn, ZoomOut } from 'lucide-react'
import { type MouseEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/button'

const MIN_ZOOM = 1
const MAX_ZOOM = 4
const ZOOM_STEP = 0.5

function preventDefault(event: MouseEvent) {
  event.preventDefault()
}

/**
 * An identity image or large photo that can be zoomed and rotated in the browser (18 section
 * 4.4). It is never offered for download: no drag, no context menu, no save control, and the
 * image link is not sent as a referrer.
 */
export function ZoomableImage({
  src,
  alt,
  label,
  onReload,
}: {
  /** null when the image was not provided or is purged. */
  src: string | null
  alt: string
  /** The image's title above the controls ("Front of the card"). */
  label: string
  /** Called when the image cannot be loaded (expired link) and the staff member asks again. */
  onReload?: () => void
}) {
  const { t } = useTranslation('admin')
  const [zoom, setZoom] = useState(MIN_ZOOM)
  const [rotation, setRotation] = useState(0)
  const [failed, setFailed] = useState<string | null>(null)

  const showImage = src !== null && failed !== src

  return (
    <figure className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-3">
      <figcaption className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{label}</span>
        {showImage ? (
          <span
            className="flex items-center gap-1"
            role="toolbar"
            aria-label={t('image.controls', { label })}
          >
            <Button
              size="icon"
              variant="ghost"
              aria-label={t('image.zoom_out')}
              disabled={zoom <= MIN_ZOOM}
              onClick={() => setZoom((value) => Math.max(MIN_ZOOM, value - ZOOM_STEP))}
            >
              <ZoomOut />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t('image.zoom_in')}
              disabled={zoom >= MAX_ZOOM}
              onClick={() => setZoom((value) => Math.min(MAX_ZOOM, value + ZOOM_STEP))}
            >
              <ZoomIn />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t('image.rotate_left')}
              onClick={() => setRotation((value) => (value + 270) % 360)}
            >
              <RotateCcw />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t('image.rotate_right')}
              onClick={() => setRotation((value) => (value + 90) % 360)}
            >
              <RotateCw />
            </Button>
          </span>
        ) : null}
      </figcaption>
      <div className="flex h-80 items-center justify-center overflow-auto rounded-md bg-muted">
        {showImage ? (
          <img
            src={src}
            alt={alt}
            draggable={false}
            referrerPolicy="no-referrer"
            onContextMenu={preventDefault}
            onDragStart={preventDefault}
            onError={() => setFailed(src)}
            data-member-photo=""
            style={{
              width: `${zoom * 100}%`,
              maxWidth: zoom === MIN_ZOOM ? '100%' : 'none',
              transform: `rotate(${rotation}deg)`,
            }}
            className="max-h-full select-none object-contain"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 p-4 text-center text-muted-foreground">
            <p>{src === null ? t('image.missing') : t('image.failed')}</p>
            {src !== null && onReload ? (
              <Button variant="secondary" onClick={onReload}>
                {t('image.reload')}
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </figure>
  )
}
