// ONB-01 to ONB-11 (07 sections 2 to 14): one step of onboarding.
import { Navigate, useBlocker, useParams, useSearch } from '@tanstack/react-router'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { IdentityNumberForm } from '~/features/identity/IdentityNumberForm'
import { PreferencesForm } from '~/features/preferences/PreferencesForm'
import { SectionForm } from '~/features/profile-sections/SectionForm'
import { subjectOf, wordingContext } from '~/features/profile-sections/wording'
import { ApiError, isApiError } from '~/lib/api'
import { isOnboardingStep, type OnboardingStep, onboardingPath } from '~/lib/gate'
import { useCurrentMe } from '~/lib/me'
import { fromSlug } from '~/lib/utils'
import { takeCompletionErrors } from './completion-errors'
import { trackStepViewed } from './funnel'
import { PhotosStep } from './PhotosStep'
import { ReviewStep } from './ReviewStep'
import { StepFooter } from './StepFooter'
import { isSectionStep, isSkippable, SCREEN_IDS } from './steps'
import { StepFlowContext, useStepFlowState } from './useStepFlow'

/** `/onboarding/$step`: the step from the URL slug, in edit mode with `?edit=true`. */
export function OnboardingStepRoute() {
  const { step } = useParams({ from: '/_authed/onboarding/$step' })
  const { edit } = useSearch({ from: '/_authed/onboarding/$step' })
  return <StepScreen step={fromSlug(step)} edit={edit === true} />
}

/** The step screen for a step key; an unknown key opens the current step (07 section 2.5). */
export function StepScreen({ step, edit = false }: { step: string; edit?: boolean }) {
  const me = useCurrentMe()
  if (!isOnboardingStep(step)) {
    return <Navigate to={onboardingPath(me.profile.onboarding_step)} replace />
  }
  return <OnboardingStepScreen key={`${step}:${edit}`} step={step} edit={edit} />
}

function OnboardingStepScreen({ step, edit }: { step: OnboardingStep; edit: boolean }) {
  const { t } = useTranslation(['onboarding', 'profile_sections'])
  const me = useCurrentMe()
  const flow = useStepFlowState(step, edit)
  const dirty = useRef(false)
  const [initialErrors] = useState(() => takeCompletionErrors(step))
  const subject = subjectOf(me.profile.managed_by, me.profile.gender)
  const wording = { context: wordingContext(subject) }

  // Leaving a step with unsaved input by Back (or browser back) asks first (07 section 2.5).
  const shouldBlockFn = useCallback(
    ({ next }: { next: { pathname: string } }) =>
      dirty.current && !flow.leaving.current && next.pathname.startsWith('/onboarding'),
    [flow.leaving],
  )
  const blocker = useBlocker({ shouldBlockFn, withResolver: true, enableBeforeUnload: false })

  // biome-ignore lint/correctness/useExhaustiveDependencies: once per screen.
  useEffect(() => {
    trackStepViewed(step, flow.mode, me.profile.onboarding_step)
  }, [])

  const onDirtyChange = (value: boolean) => {
    dirty.current = value
  }
  const submitLabel = edit ? t('onboarding:actions.save') : t('onboarding:actions.continue')
  const skippable = isSkippable(step, me.config)

  let title: string
  let subtitle: string
  let body: ReactNode
  if (isSectionStep(step)) {
    title = t(`profile_sections:${step}.title`, wording)
    subtitle = t(`profile_sections:${step}.subtitle`, wording)
    body = (
      <SectionForm
        section={step}
        mode="onboarding"
        submitLabel={submitLabel}
        onSaved={() => flow.advance()}
        footer={<StepFooter skippable={skippable} />}
        initialErrors={initialErrors}
        onDirtyChange={onDirtyChange}
      />
    )
  } else {
    title = t(`onboarding:${step}.title`)
    subtitle = t(`onboarding:${step}.subtitle`)
    switch (step) {
      case 'photos':
        body = <PhotosStep onDirtyChange={onDirtyChange} />
        break
      case 'preferences':
        body = (
          <PreferencesForm
            mode="onboarding"
            submitLabel={submitLabel}
            onSaved={() => flow.advance()}
            footer={<StepFooter />}
            initialErrors={initialErrors}
            onDirtyChange={onDirtyChange}
          />
        )
        break
      case 'identity':
        body = (
          <div className="flex flex-col gap-6">
            <IdentityNumberForm
              mode="onboarding"
              submitLabel={submitLabel}
              onSaved={() => advanceAfterIdentity(flow.advance)}
              footer={
                <StepFooter
                  skippable={skippable}
                  skipNote={skippable ? t('onboarding:identity.skip_note') : undefined}
                />
              }
              initialErrors={initialErrors}
              onDirtyChange={onDirtyChange}
            />
            <p className="text-body-sm text-muted-foreground">
              {t('onboarding:identity.verification_note')}
            </p>
          </div>
        )
        break
      default:
        body = <ReviewStep />
        break
    }
  }

  return (
    <StepFlowContext.Provider value={flow}>
      <div className="flex flex-col gap-6" data-screen={SCREEN_IDS[step]}>
        <div className="flex flex-col gap-2">
          <h1 className="text-headline-md">{title}</h1>
          <p className="text-foreground-secondary">{subtitle}</p>
        </div>
        {body}
      </div>
      <AlertDialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('onboarding:discard.title')}</AlertDialogTitle>
            <AlertDialogDescription className="text-foreground">
              {t('onboarding:discard.body')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('onboarding:discard.keep')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => blocker.proceed?.()}>
              {t('onboarding:discard.discard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </StepFlowContext.Provider>
  )
}

/**
 * `continue` on ONB-10 without an identity answers `number` / `required`; its message there is
 * "Enter the identity number to continue." (07 section 13.6), not the save's "Enter the number."
 */
async function advanceAfterIdentity(advance: () => Promise<void>) {
  try {
    await advance()
  } catch (error) {
    if (!isApiError(error) || error.code !== 'validation_failed') throw error
    throw new ApiError({
      status: error.status,
      code: error.code,
      message: error.message,
      details: error.details,
      requestId: error.requestId,
      fields: error.fields.map((field) =>
        field.field === 'number' && field.code === 'required'
          ? { ...field, code: 'required_continue' }
          : field,
      ),
    })
  }
}
