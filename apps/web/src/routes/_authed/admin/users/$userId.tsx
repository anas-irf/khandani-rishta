import { createFileRoute } from '@tanstack/react-router'
import { UserScreen } from '~/features/admin/UserScreen'

export const Route = createFileRoute('/_authed/admin/users/$userId')({
  component: UserScreen,
})
