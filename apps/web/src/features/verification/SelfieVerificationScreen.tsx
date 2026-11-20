// ME-VERIFY-SELFIE (16 section 6.22, 12 sections 4 and 8.4)
import { Link, useNavigate } from '@tanstack/react-router'
import { CircleCheck, ImagePlus } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ErrorState } from '~/components/common/ErrorState'
import { PageHeader } from '~/components/common/PageHeader'
import { Button } from '~/components/ui/button'
import { Progress } from '~/components/ui/progress'
import { Skeleton } from '~/components/ui/skeleton'
import { isApiError } from '~/lib/api'
import type { SelfieGesture } from '~/lib/api-types'
import { isImageError, prepareImage, SELFIE_LONG_SIDE } from '~/lib/image'
import { useCurrentMe } from '~/lib/me'
import { type CaptureMode, detectCaptureMode } from './capture'
import { useCandidate } from './copy'
import { GestureIllustration } from './GestureIllustration'
import { useSelfieChallenge, useSubmitVerification, useUploadVerificationImage } from './queries'
import { CapturedReview, LiveCamera, OpenCameraButton } from './SelfieCapture'
import { ClosedNotice, imageErrorKey, isGestureMismatch, StepPanel } from './shared'

type Step = 'explain' | 'gesture' | 'camera' | 'review' | 'submit' | 'done'

/**
 * Submit a live selfie showing today's gesture so a moderator can confirm that the profile
 * photos show the candidate. Steps 1 to 6 of 16 section 6.22.
 */
export function SelfieVerificationScreen({ captureMode }: { captureMode?: CaptureMode }) {
  const { t } = useTranslation('verification')
  const me = useCurrentMe()
  const candidate = useCandidate()
  const navigate = useNavigate()
  const challenge = useSelfieChallenge()
  const upload = useUploadVerificationImage()
  const submit = useSubmitVerification()
  const [mode] = useState<CaptureMode>(() => captureMode ?? detectCaptureMode())
  const [step, setStep] = useState<Step>('explain')
  const [gesture, setGesture] = useState<SelfieGesture | null>(null)
  const [captured, setCaptured] = useState<Blob | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  // 12 section 4.1: a selfie needs an approved photo; only an approved photo is the main one.
  const [noPhoto, setNoPhoto] = useState(me.profile.photo === null)

  const header = <PageHeader title={t('selfie.title')} showBack />

  if (me.profile.status === 'closed') {
    return (
      <Layout header={header}>
        <ClosedNotice />
      </Layout>
    )
  }

  if (noPhoto) {
    return (
      <Layout header={header}>
        <StepPanel>
          <p className="text-lg font-semibold">{t('selfie.no_photo')}</p>
          <Button asChild>
            <Link to="/me/photos">
              <ImagePlus aria-hidden="true" />
              {t('selfie.add_photo')}
            </Link>
          </Button>
        </StepPanel>
      </Layout>
    )
  }

  const onCaptured = (blob: Blob) => {
    setCaptured(blob)
    setError(null)
    setStep('review')
  }

  const retake = () => {
    setCaptured(null)
    setError(null)
    setStep(mode === 'desktop' ? 'camera' : 'gesture')
  }

  const send = async () => {
    if (!captured || !gesture) return
    setError(null)
    setProgress(0)
    try {
      const prepared = await prepareImage(captured, { maxLongSide: SELFIE_LONG_SIDE, minSide: 0 })
      const key = await upload.mutateAsync({
        slot: 'selfie',
        blob: prepared.blob,
        onProgress: (fraction) => setProgress(Math.round(fraction * 90)),
      })
      setProgress(95)
      await submit.mutateAsync({ kind: 'selfie', selfie_key: key, gesture })
      setStep('done')
    } catch (caught) {
      handleError(caught)
    } finally {
      setProgress(null)
    }
  }

  const handleError = (caught: unknown) => {
    if (isImageError(caught)) {
      setError(t(imageErrorKey(caught)))
      return
    }
    if (isApiError(caught)) {
      if (caught.code === 'invalid_state') {
        setNoPhoto(true)
        return
      }
      if (caught.code === 'already_exists') {
        toast(t('selfie.already_exists'))
        void navigate({ to: '/me/verification' })
        return
      }
      if (isGestureMismatch(caught)) {
        // The challenge is older than yesterday's: fetch it again and restart at step 2.
        void challenge.refetch()
        setCaptured(null)
        setGesture(null)
        setNotice(t('gesture.changed'))
        setStep('gesture')
        return
      }
      if (caught.code === 'payload_too_large') {
        setError(t('errors.too_large'))
        return
      }
    }
    setError(t('errors.upload_failed'))
  }

  return (
    <Layout header={header}>
      {step === 'explain' ? (
        <StepPanel>
          <p>
            {candidate.self ? t('selfie.body_self') : t('selfie.body', { name: candidate.name })}
          </p>
          {candidate.self ? null : (
            <p className="font-medium">{t('selfie.managed', { name: candidate.name })}</p>
          )}
          <Button onClick={() => setStep('gesture')}>{t('selfie.continue')}</Button>
        </StepPanel>
      ) : null}

      {step === 'gesture' ? (
        <GestureStep
          challenge={challenge}
          notice={notice}
          action={(current) => (
            <OpenCameraButton
              mode={mode}
              onOpenLiveCamera={() => {
                setGesture(current)
                setStep('camera')
              }}
              onCaptured={(blob) => {
                setGesture(current)
                onCaptured(blob)
              }}
            />
          )}
        />
      ) : null}

      {step === 'camera' ? <LiveCamera onCaptured={onCaptured} /> : null}

      {step === 'review' && captured ? (
        <CapturedReview blob={captured} onUse={() => setStep('submit')} onRetake={retake} />
      ) : null}

      {step === 'submit' && captured && gesture ? (
        <StepPanel>
          <GestureIllustration gesture={gesture} className="h-24" />
          <CapturedReview
            blob={captured}
            useLabel={error ? t('camera.try_again') : t('selfie.submit')}
            busy={progress !== null}
            onUse={() => void send()}
            onRetake={retake}
            error={error}
          />
          {progress !== null ? (
            <Progress value={progress} aria-label={t('selfie.progress')} className="max-w-md" />
          ) : null}
        </StepPanel>
      ) : null}

      {step === 'done' ? (
        <StepPanel>
          <CircleCheck aria-hidden="true" className="size-12 text-success" />
          <p role="status" className="text-lg">
            {t('selfie.success')}
          </p>
          <Button asChild>
            <Link to="/me/verification">{t('selfie.done')}</Link>
          </Button>
        </StepPanel>
      ) : null}
    </Layout>
  )
}

function Layout({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <div className="container-app flex max-w-2xl flex-col gap-4">
      {header}
      {children}
    </div>
  )
}

/** Step 2: today's gesture with its drawing and instruction (12 section 4.2). */
export function GestureStep({
  challenge,
  notice,
  intro,
  action,
}: {
  challenge: ReturnType<typeof useSelfieChallenge>
  notice?: string | null
  /** Text above the instruction (the step 3 body of `ME-VERIFY-ID`). */
  intro?: (instruction: string) => ReactNode
  action: (gesture: SelfieGesture) => ReactNode
}) {
  const { t } = useTranslation('verification')
  if (challenge.isPending) {
    return (
      <div role="status" aria-busy="true" className="flex flex-col items-center gap-3 py-6">
        <span className="sr-only">{t('gesture.loading')}</span>
        <Skeleton className="h-40 w-36" />
        <Skeleton className="h-5 w-64" />
      </div>
    )
  }
  if (challenge.isError) {
    return (
      <ErrorState
        error={challenge.error}
        onRetry={() => void challenge.refetch()}
        retrying={challenge.isFetching}
      />
    )
  }
  const gesture = challenge.data
  const instruction = t(`gesture.${gesture}`)
  return (
    <StepPanel>
      {notice ? (
        <p role="alert" className="font-medium text-warning">
          {notice}
        </p>
      ) : null}
      {intro ? <p>{intro(instruction)}</p> : null}
      <GestureIllustration gesture={gesture} />
      <p className="text-lg font-semibold" data-testid="gesture-instruction">
        {instruction}
      </p>
      {action(gesture)}
    </StepPanel>
  )
}
