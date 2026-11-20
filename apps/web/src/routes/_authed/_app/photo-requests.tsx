import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { PhotoRequestsScreen } from '~/features/photo-requests/PhotoRequestsScreen'

export const Route = createFileRoute('/_authed/_app/photo-requests')({
  validateSearch: z.object({
    box: z.enum(['received', 'sent']).default('received').catch('received'),
  }),
  component: PhotoRequestsScreen,
})
