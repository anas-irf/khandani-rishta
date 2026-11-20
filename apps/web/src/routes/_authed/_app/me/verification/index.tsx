import { createFileRoute } from '@tanstack/react-router'
import { VerificationCentreScreen } from '~/features/verification/VerificationCentreScreen'

export const Route = createFileRoute('/_authed/_app/me/verification/')({
  component: VerificationCentreScreen,
})
