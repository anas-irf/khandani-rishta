import { Navigate } from '@tanstack/react-router'
import { onboardingPath } from '~/lib/gate'
import { useCurrentMe } from '~/lib/me'

/** `/onboarding`: opens the screen of the current step (07 section 2.5). */
export function OnboardingIndex() {
  const me = useCurrentMe()
  return <Navigate to={onboardingPath(me.profile.onboarding_step)} replace />
}
