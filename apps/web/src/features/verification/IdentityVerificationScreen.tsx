// ME-VERIFY-ID (16 section 6.23, 12 sections 3, 5 and 8.2)
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { CircleCheck, Clock, ImagePlus } from 'lucide-react'
import { type ReactNode, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ErrorState } from '~/components/common/ErrorState'
import { FormSkeleton } from '~/components/common/FormSkeleton'
import { PageHeader } from '~/components/common/PageHeader'
import { Button } from '~/components/ui/button'
import { Progress } from '~/components/ui/progress'
import { IdentityNumberForm } from '~/features/identity/IdentityNumberForm'
import { isApiError } from '~/lib/api'
import type { IdentitySummary, SelfieGesture, Verifications } from '~/lib/api-types'
import { IMAGE_ACCEPT, isImageError, prepareImage, SELFIE_LONG_SIDE } from '~/lib/image'
import { useCurrentMe } from '~/lib/me'
import { useLabelOf } from '~/lib/reference'
import { type CaptureMode, detectCaptureMode } from './capture'
import { useCandidate } from './copy'
import {
  useRefreshVerificationState,
  useSelfieChallenge,
  useSubmitVerification,
  useUploadVerificationImage,
  useVerifications,
  type VerificationSlot,
} from './queries'
import { CapturedReview, LiveCamera, OpenCameraButton } from './SelfieCapture'
import { GestureStep } from './SelfieVerificationScreen'
import { ClosedNotice, failingField, imageErrorKey, isGestureMismatch, StepPanel } from './shared'
import { newestRequest } from './VerificationCentreScreen'

type Step = 'number' | 'front' | 'back' | 'gesture' | 'camera' | 'selfie_review' | 'submit' | 'done'

/**
 * Registers the identity number if it is missing, then submits photos of the document and a
 * live selfie (16 section 6.23). `?change=true` opens the number step for an existing number.
 */
export function IdentityVerificationScreen({ captureMode }: { captureMode?: CaptureMode }) {
  const { t } = useTranslation('verification')
  const me = useCurrentMe()
  const verifications = useVerifications()
  const header = <PageHeader title={t('identity.title')} showBack />

  let content: ReactNode
  if (me.profile.status === 'closed') content = <ClosedNotice />
  else if (verifications.isPending) content = <FormSkeleton fields={2} />
  else if (verifications.isError) {
    content = (
      <ErrorState
        error={verifications.error}
        onRetry={() => void verifications.refetch()}
        retrying={verifications.isFetching}
      />
    )
  } else content = <IdentityFlow data={verifications.data} captureMode={captureMode} />

  return (
    <div className="container-app flex max-w-2xl flex-col gap-4">
      {header}
      {content}
    </div>
  )
}

type Images = Partial<Record<VerificationSlot, Blob>>

function IdentityFlow({ data, captureMode }: { data: Verifications; captureMode?: CaptureMode }) {
  const { t } = useTranslation('verification')
  const navigate = useNavigate()
  const candidate = useCandidate()
  const search = useSearch({ strict: false }) as { change?: unknown }
  const challenge = useSelfieChallenge()
  const upload = useUploadVerificationImage()
  const submit = useSubmitVerification()
  const refresh = useRefreshVerificationState()
  const [mode] = useState<CaptureMode>(() => captureMode ?? detectCaptureMode())
  const changing = search.change === true || search.change === 'true'
  const [step, setStep] = useState<Step>(() =>
    data.identity === null || changing ? 'number' : 'front',
  )
  const [images, setImages] = useState<Images>({})
  const keys = useRef<Partial<Record<VerificationSlot, string>>>({})
  const [gesture, setGesture] = useState<SelfieGesture | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [stepError, setStepError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{
    slot: VerificationSlot | 'submit'
    value: number
  } | null>(null)

  // Decided once on entry: after this flow submits, the refetched state is `pending` too.
  const [blocked] = useState<'verified' | 'pending' | null>(() => {
    if (data.id_verified) return 'verified'
    const newest = newestRequest(data.requests, 'id_document')
    return data.identity?.status === 'pending' || newest?.status === 'pending' ? 'pending' : null
  })
  const identity = data.identity
  if (blocked === 'verified') {
    return (
      <StateNotice
        icon={<CircleCheck className="size-10 text-success" />}
        text={t('identity.verified')}
      />
    )
  }
  if (blocked === 'pending') {
    return (
      <StateNotice icon={<Clock className="size-10 text-warning" />} text={t('identity.pending')} />
    )
  }

  const passport = identity?.document_type === 'passport'
  const slots: VerificationSlot[] = passport ? ['front', 'selfie'] : ['front', 'back', 'selfie']

  const setImage = (slot: VerificationSlot, blob: Blob | undefined) => {
    delete keys.current[slot]
    setImages((current) => ({ ...current, [slot]: blob }))
  }

  const goTo = (next: Step) => {
    setStepError(null)
    setStep(next)
  }

  const send = async () => {
    if (!gesture) return
    setSubmitError(null)
    let current: VerificationSlot | 'submit' = 'submit'
    try {
      for (const slot of slots) {
        if (keys.current[slot]) continue
        const blob = images[slot]
        if (!blob) {
          goTo(slot === 'selfie' ? 'gesture' : slot)
          return
        }
        current = slot
        setProgress({ slot, value: 0 })
        keys.current[slot] = await upload.mutateAsync({
          slot,
          blob,
          onProgress: (fraction) => setProgress({ slot, value: fraction }),
        })
      }
      current = 'submit'
      setProgress({ slot: 'submit', value: 1 })
      await submit.mutateAsync({
        kind: 'id_document',
        front_key: keys.current.front ?? '',
        back_key: passport ? null : (keys.current.back ?? null),
        selfie_key: keys.current.selfie ?? '',
        gesture,
      })
      goTo('done')
    } catch (error) {
      handleSubmitError(error, current)
    } finally {
      setProgress(null)
    }
  }

  const handleSubmitError = (error: unknown, slot?: VerificationSlot | 'submit') => {
    if (isApiError(error)) {
      if (error.code === 'invalid_state') {
        refresh()
        void navigate({ to: '/me/verification' })
        return
      }
      if (error.code === 'already_exists') {
        toast(t('identity.already_exists'))
        void navigate({ to: '/me/verification' })
        return
      }
      if (isGestureMismatch(error)) {
        void challenge.refetch()
        setImage('selfie', undefined)
        setGesture(null)
        setNotice(t('gesture.changed'))
        goTo('gesture')
        return
      }
      if (error.code === 'validation_failed') {
        const field = failingField(error, ['front_key', 'back_key', 'selfie_key'])
        const failing = field?.replace('_key', '') as VerificationSlot | undefined
        if (field === 'back_key' && error.fields.some((entry) => entry.code === 'required')) {
          setImage('back', undefined)
          goTo('back')
          return
        }
        // An upload the API cannot find: upload that round again.
        if (failing) delete keys.current[failing]
      }
      if (error.code === 'payload_too_large' && slot && slot !== 'submit') {
        setImage(slot, undefined)
        goTo(slot === 'selfie' ? 'gesture' : slot)
        setStepError(t('errors.too_large'))
        return
      }
    }
    setSubmitError(t('errors.upload_failed'))
  }

  const acceptSelfie = async (blob: Blob) => {
    try {
      const prepared = await prepareImage(blob, { maxLongSide: SELFIE_LONG_SIDE, minSide: 0 })
      setImage('selfie', prepared.blob)
      goTo('submit')
    } catch (error) {
      setStepError(isImageError(error) ? t(imageErrorKey(error)) : t('errors.unreadable'))
    }
  }

  return (
    <>
      {step === 'number' ? (
        <section className="flex flex-col gap-4" aria-labelledby="identity-step-1">
          <h2 id="identity-step-1" className="text-lg font-semibold">
            {t('identity.step1')}
          </h2>
          {candidate.self ? null : (
            <p className="font-medium">{t('identity.managed_note', { name: candidate.name })}</p>
          )}
          <IdentityNumberForm
            mode="me"
            submitLabel={t('selfie.continue')}
            onSaved={() => goTo('front')}
          />
        </section>
      ) : null}

      {step === 'front' || step === 'back' ? (
        <section className="flex flex-col gap-4" aria-labelledby="identity-step-2">
          <h2 id="identity-step-2" className="text-lg font-semibold">
            {t('identity.step2')}
          </h2>
          {identity ? <NumberOnFile identity={identity} /> : null}
          <p>{t('identity.tips')}</p>
          <CardPhotoStep
            key={step}
            title={
              step === 'back'
                ? t('identity.back')
                : passport
                  ? t('identity.front_passport')
                  : t('identity.front')
            }
            chooseLabel={
              step === 'back'
                ? t('identity.choose_back')
                : passport
                  ? t('identity.choose_passport')
                  : t('identity.choose_front')
            }
            error={stepError}
            onAccept={(blob) => {
              const slot = step
              setImage(slot, blob)
              goTo(slot === 'front' && !passport ? 'back' : 'gesture')
            }}
          />
        </section>
      ) : null}

      {step === 'gesture' || step === 'camera' || step === 'selfie_review' ? (
        <section className="flex flex-col gap-4" aria-labelledby="identity-step-3">
          <h2 id="identity-step-3" className="text-lg font-semibold">
            {t('identity.step3')}
          </h2>
          {step === 'gesture' ? (
            <GestureStep
              challenge={challenge}
              notice={notice ?? stepError}
              intro={(instruction) =>
                candidate.self
                  ? t('identity.selfie_body_self', { gesture: instruction })
                  : t('identity.selfie_body', { name: candidate.name, gesture: instruction })
              }
              action={(current) => (
                <OpenCameraButton
                  mode={mode}
                  onOpenLiveCamera={() => {
                    setGesture(current)
                    goTo('camera')
                  }}
                  onCaptured={(blob) => {
                    setGesture(current)
                    setImages((existing) => ({ ...existing, selfie: blob }))
                    goTo('selfie_review')
                  }}
                />
              )}
            />
          ) : null}
          {step === 'camera' ? (
            <LiveCamera
              onCaptured={(blob) => {
                setImages((existing) => ({ ...existing, selfie: blob }))
                goTo('selfie_review')
              }}
            />
          ) : null}
          {step === 'selfie_review' && images.selfie ? (
            <CapturedReview
              blob={images.selfie}
              error={stepError}
              onUse={() => {
                if (images.selfie) void acceptSelfie(images.selfie)
              }}
              onRetake={() => {
                setImage('selfie', undefined)
                goTo(mode === 'desktop' ? 'camera' : 'gesture')
              }}
            />
          ) : null}
        </section>
      ) : null}

      {step === 'submit' ? (
        <StepPanel>
          {submitError ? (
            <p role="alert" className="text-danger">
              {submitError}
            </p>
          ) : null}
          {progress ? (
            <div className="flex w-full max-w-md flex-col gap-2">
              <p role="status">{t(`identity.slot.${progress.slot}`)}</p>
              <Progress
                aria-label={t('identity.progress_label')}
                value={Math.round(
                  ((slots.indexOf(progress.slot as VerificationSlot) === -1
                    ? slots.length
                    : slots.indexOf(progress.slot as VerificationSlot)) +
                    progress.value) *
                    (100 / (slots.length + 1)),
                )}
              />
            </div>
          ) : null}
          <Button onClick={() => void send()} loading={progress !== null}>
            {submitError ? t('camera.try_again') : t('identity.submit')}
          </Button>
        </StepPanel>
      ) : null}

      {step === 'done' ? (
        <StepPanel>
          <CircleCheck aria-hidden="true" className="size-12 text-success" />
          <p role="status" className="text-lg">
            {t('identity.success')}
          </p>
          <Button asChild>
            <Link to="/me/verification">{t('identity.done')}</Link>
          </Button>
        </StepPanel>
      ) : null}
    </>
  )
}

function StateNotice({ icon, text }: { icon: ReactNode; text: string }) {
  const { t } = useTranslation('verification')
  return (
    <StepPanel>
      <span aria-hidden="true">{icon}</span>
      <p className="text-lg">{text}</p>
      <Button asChild variant="secondary">
        <Link to="/me/verification">{t('identity.back_to_centre')}</Link>
      </Button>
    </StepPanel>
  )
}

function NumberOnFile({ identity }: { identity: IdentitySummary }) {
  const { t } = useTranslation('verification')
  const label = useLabelOf()
  return (
    <p className="text-muted-foreground">
      {t('identity.number_on_file', {
        type: label('document_type', identity.document_type),
        number: identity.number_masked,
      })}
    </p>
  )
}

/**
 * One photo of the card (16 section 6.23 step 2): the back camera or the gallery through a file
 * picker, prepared like a profile photo (2,048 pixels), then "Use this photo" or "Retake".
 */
function CardPhotoStep({
  title,
  chooseLabel,
  error,
  onAccept,
}: {
  title: string
  chooseLabel: string
  error: string | null
  onAccept: (blob: Blob) => void
}) {
  const { t } = useTranslation('verification')
  const inputRef = useRef<HTMLInputElement>(null)
  const [candidate, setCandidate] = useState<Blob | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [message, setMessage] = useState<string | null>(error)

  const onPicked = async (file: File | undefined) => {
    if (!file) return
    setMessage(null)
    setPreparing(true)
    try {
      const prepared = await prepareImage(file)
      setCandidate(prepared.blob)
    } catch (caught) {
      setMessage(isImageError(caught) ? t(imageErrorKey(caught)) : t('errors.unreadable'))
    } finally {
      setPreparing(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-semibold">{title}</h3>
      {candidate ? (
        <CapturedReview
          blob={candidate}
          onUse={() => onAccept(candidate)}
          onRetake={() => setCandidate(null)}
        />
      ) : (
        <>
          {message ? (
            <p role="alert" className="text-danger">
              {message}
            </p>
          ) : null}
          <Button
            variant="secondary"
            className="self-start"
            loading={preparing}
            onClick={() => inputRef.current?.click()}
          >
            <ImagePlus aria-hidden="true" />
            {chooseLabel}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept={IMAGE_ACCEPT}
            tabIndex={-1}
            aria-hidden="true"
            className="sr-only"
            data-testid="card-photo-input"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              void onPicked(file)
            }}
          />
        </>
      )}
    </div>
  )
}
