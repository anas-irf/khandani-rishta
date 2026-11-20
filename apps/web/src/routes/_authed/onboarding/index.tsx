import { createFileRoute } from '@tanstack/react-router'
import { OnboardingIndex } from '~/features/onboarding/OnboardingIndex'

/** `/onboarding` redirects to the current step (17 section 3.3). */
export const Route = createFileRoute('/_authed/onboarding/')({
  component: OnboardingIndex,
})
