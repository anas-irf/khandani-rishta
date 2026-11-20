import { createFileRoute } from '@tanstack/react-router'
import { DoneScreen } from '~/features/onboarding/DoneScreen'

/** ONB-DONE (07 section 15). */
export const Route = createFileRoute('/_authed/onboarding/done')({
  component: DoneScreen,
})
