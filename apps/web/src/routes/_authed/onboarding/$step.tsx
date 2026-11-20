import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { OnboardingStepRoute } from '~/features/onboarding/StepScreen'

/** ONB-01 to ONB-11. `edit` is set by the review step's "Edit" links (17 section 3.3). */
export const Route = createFileRoute('/_authed/onboarding/$step')({
  validateSearch: z.object({ edit: z.boolean().optional().catch(undefined) }),
  component: OnboardingStepRoute,
})
