import { createFileRoute } from '@tanstack/react-router'
import { OnboardingLayout } from '~/features/onboarding/OnboardingLayout'

/** The onboarding layout: progress header, no navigation (17 section 3.3). */
export const Route = createFileRoute('/_authed/onboarding')({
  component: OnboardingLayout,
})
