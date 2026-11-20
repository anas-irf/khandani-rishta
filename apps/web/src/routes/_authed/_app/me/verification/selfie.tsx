import { createFileRoute } from '@tanstack/react-router'
import { SelfieVerificationScreen } from '~/features/verification/SelfieVerificationScreen'

export const Route = createFileRoute('/_authed/_app/me/verification/selfie')({
  component: () => <SelfieVerificationScreen />,
})
