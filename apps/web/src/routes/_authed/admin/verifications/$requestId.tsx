import { createFileRoute } from '@tanstack/react-router'
import { VerificationScreen } from '~/features/admin/VerificationScreen'

export const Route = createFileRoute('/_authed/admin/verifications/$requestId')({
  component: VerificationScreen,
})
