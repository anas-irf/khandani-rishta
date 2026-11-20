import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { IdentityVerificationScreen } from '~/features/verification/IdentityVerificationScreen'

export const Route = createFileRoute('/_authed/_app/me/verification/identity')({
  // `change`: open the number step for an existing number ("Change the number", 16 6.21).
  validateSearch: z.object({ change: z.boolean().optional().catch(undefined) }),
  component: () => <IdentityVerificationScreen />,
})
