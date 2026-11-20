import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { createContext, useContext, useRef } from 'react'
import { useOnboardingContinue } from '~/features/profile-sections/queries'
import { isApiError } from '~/lib/api'
import type { OnboardingStep } from '~/lib/gate'
import { meQueryOptions, useCurrentMe } from '~/lib/me'
import { toSlug } from '~/lib/utils'
import { trackStepCompleted, trackStepSkipped } from './funnel'
import { nextStep, previousStep } from './steps'

/**
 * The per-step sequence of 07 section 2.4 after a successful save, and the navigation rules of
 * 2.5:
 *
 * - `advance()`: in edit mode (from ONB-11) return to the review; for an earlier step go to
 *   the next screen; for the current step call `continue`, replace `Me` and open the step the
 *   server returns. `409 invalid_state` refetches `Me` and opens `details.onboarding_step`.
 *   `validation_failed` is thrown so the form shows it under its fields.
 * - `skip()`: "Skip for now" without saving (calls `continue` only).
 * - `back()`: the previous step's screen (the review in edit mode). Never calls the API.
 */
export function useStepFlowState(step: OnboardingStep, edit: boolean) {
  const me = useCurrentMe()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const continueStep = useOnboardingContinue()
  const viewedAt = useRef(Date.now())
  /** Set while the screen navigates on purpose, so the "Discard changes?" guard stays quiet. */
  const leaving = useRef(false)
  const meRef = useRef(me)
  meRef.current = me

  const goTo = async (target: string, search: { edit?: boolean } = {}) => {
    leaving.current = true
    try {
      await navigate({ to: '/onboarding/$step', params: { step: toSlug(target) }, search })
    } finally {
      leaving.current = false
    }
  }

  const runContinue = async (): Promise<boolean> => {
    try {
      const next = await continueStep.mutateAsync(step)
      trackStepCompleted(step, viewedAt.current, next.profile.managed_by)
      await goTo(next.profile.onboarding_step)
      return true
    } catch (error) {
      if (isApiError(error) && error.code === 'invalid_state') {
        // Another device moved on: follow it.
        const target = error.details.onboarding_step
        const fresh = await queryClient.fetchQuery({ ...meQueryOptions(), staleTime: 0 })
        await goTo(typeof target === 'string' ? target : fresh.profile.onboarding_step)
        return false
      }
      throw error
    }
  }

  const isCurrent = () => meRef.current.profile.onboarding_step === step

  return {
    step,
    edit,
    mode: edit ? ('edit' as const) : ('flow' as const),
    leaving,
    viewedAt,
    isCurrent,
    goTo,
    async advance() {
      if (edit) return void (await goTo('review'))
      if (!isCurrent()) return void (await goTo(nextStep(step)))
      await runContinue()
    },
    async skip() {
      if (edit) return void (await goTo('review'))
      if (!isCurrent()) return void (await goTo(nextStep(step)))
      if (await runContinue()) trackStepSkipped(step)
    },
    back() {
      const target = edit ? 'review' : previousStep(step)
      if (target) void navigate({ to: '/onboarding/$step', params: { step: toSlug(target) } })
    },
  }
}

export type StepFlow = ReturnType<typeof useStepFlowState>

export const StepFlowContext = createContext<StepFlow | null>(null)

export function useStepFlow(): StepFlow {
  const flow = useContext(StepFlowContext)
  if (!flow) throw new Error('useStepFlow() must be used inside a step screen')
  return flow
}
