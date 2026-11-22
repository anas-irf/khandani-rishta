import { Camera, CameraOff } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArchIcon } from '~/components/common/Arch'
import { Button } from '~/components/ui/button'
import { cn } from '~/lib/utils'
import { type CameraProblem, type CaptureMode, cameraProblemOf, captureFrame } from './capture'
import { FlowAlert } from './shared'

/**
 * "Open camera" (16 section 6.22 step 2). On a phone it opens the front camera through the
 * file input with `capture="user"` and hands back the photo; on a desktop it asks the screen to
 * show the live camera (`LiveCamera`). There is no gallery picker (12 section 4.3).
 */
export function OpenCameraButton({
  mode,
  onCaptured,
  onOpenLiveCamera,
  disabled,
}: {
  mode: CaptureMode
  onCaptured: (blob: Blob) => void
  onOpenLiveCamera: () => void
  disabled?: boolean
}) {
  const { t } = useTranslation('verification')
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <Button
        size="lg"
        disabled={disabled}
        onClick={() => (mode === 'phone' ? inputRef.current?.click() : onOpenLiveCamera())}
      >
        <Camera aria-hidden="true" />
        {t('camera.open')}
      </Button>
      {mode === 'phone' ? (
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="user"
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
          data-testid="selfie-camera-input"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) onCaptured(file)
          }}
        />
      ) : null}
    </>
  )
}

type CameraState = 'starting' | 'live' | CameraProblem

/**
 * The desktop capture of 12 section 4.3: a live preview of `getUserMedia({ video: {
 * facingMode: 'user' } })` and a capture button. Explains a refused or missing camera.
 */
export function LiveCamera({ onCaptured }: { onCaptured: (blob: Blob) => void }) {
  const { t } = useTranslation('verification')
  const videoRef = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<CameraState>('starting')
  const [attempt, setAttempt] = useState(0)
  const [capturing, setCapturing] = useState(false)

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` restarts the camera.
  useEffect(() => {
    const devices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
    if (!devices?.getUserMedia) {
      setState('unavailable')
      return
    }
    let stream: MediaStream | null = null
    let cancelled = false
    setState('starting')
    devices.getUserMedia({ video: { facingMode: 'user' }, audio: false }).then(
      (media) => {
        if (cancelled) {
          for (const track of media.getTracks()) track.stop()
          return
        }
        stream = media
        const video = videoRef.current
        if (video) {
          video.srcObject = media
          void video.play?.()?.catch(() => undefined)
        }
        setState('live')
      },
      (error: unknown) => {
        if (!cancelled) setState(cameraProblemOf(error))
      },
    )
    return () => {
      cancelled = true
      for (const track of stream?.getTracks() ?? []) track.stop()
    }
  }, [attempt])

  if (state === 'denied' || state === 'unavailable') {
    return (
      <CameraMessage
        title={state === 'denied' ? t('camera.denied') : t('camera.unavailable')}
        text={state === 'denied' ? t('camera.denied_help') : t('camera.unavailable_help')}
        action={
          state === 'denied' ? (
            <Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>
              {t('camera.try_again')}
            </Button>
          ) : null
        }
      />
    )
  }

  const capture = async () => {
    const video = videoRef.current
    if (!video) return
    setCapturing(true)
    try {
      const blob = await captureFrame(video)
      if (blob) onCaptured(blob)
    } finally {
      setCapturing(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="band-inverse relative w-full max-w-form overflow-hidden rounded-lg">
        {/* The preview is mirrored like a mirror; the captured photo is not. */}
        <video
          ref={videoRef}
          aria-label={t('camera.preview')}
          muted
          playsInline
          autoPlay
          className="aspect-[4/3] w-full -scale-x-100 object-cover"
        />
        {state === 'starting' ? (
          <p
            role="status"
            className="absolute inset-0 flex items-center justify-center px-4 text-center"
          >
            {t('camera.starting')}
          </p>
        ) : null}
      </div>
      <Button
        size="lg"
        onClick={() => void capture()}
        disabled={state !== 'live'}
        loading={capturing}
      >
        <Camera aria-hidden="true" />
        {t('camera.capture')}
      </Button>
    </div>
  )
}

function CameraMessage({
  title,
  text,
  action,
}: {
  title: string
  text: string
  action: ReactNode
}) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-4 py-6 text-center">
      <ArchIcon icon={CameraOff} size="lg" tone="warning" />
      <p className="text-title-md font-bold">{title}</p>
      <p className="max-w-measure text-foreground-secondary">{text}</p>
      {action}
    </div>
  )
}

/** The captured or picked image with "Use this photo" and "Retake" (16 section 6.22 step 4). */
export function CapturedReview({
  blob,
  onUse,
  onRetake,
  useLabel,
  busy = false,
  error,
  className,
}: {
  blob: Blob
  onUse: () => void
  onRetake: () => void
  /** Text of the confirm button (default "Use this photo"). */
  useLabel?: string
  busy?: boolean
  error?: ReactNode
  className?: string
}) {
  const { t } = useTranslation('verification')
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (typeof URL.createObjectURL !== 'function') return
    const next = URL.createObjectURL(blob)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [blob])

  return (
    <div className={cn('flex flex-col items-center gap-3', className)}>
      {url ? (
        <img
          src={url}
          alt={t('review.alt')}
          className="max-h-[50dvh] w-full max-w-form rounded-lg object-contain"
        />
      ) : null}
      {error ? <FlowAlert>{error}</FlowAlert> : null}
      <div className="flex w-full flex-wrap justify-center gap-3">
        <Button variant="secondary" size="lg" fill="row" onClick={onRetake} disabled={busy}>
          {t('review.retake')}
        </Button>
        <Button size="lg" fill="row" onClick={onUse} loading={busy}>
          {useLabel ?? t('review.use')}
        </Button>
      </div>
    </div>
  )
}
