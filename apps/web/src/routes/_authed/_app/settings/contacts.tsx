import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { ContactsScreen } from '~/features/me/ContactsScreen'

export const Route = createFileRoute('/_authed/_app/settings/contacts')({
  validateSearch: z.object({
    focus: z.string().optional().catch(undefined),
    return_connection_id: z.string().optional().catch(undefined),
  }),
  component: ContactsScreen,
})
