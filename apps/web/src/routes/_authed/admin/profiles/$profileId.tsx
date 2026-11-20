import { createFileRoute } from '@tanstack/react-router'
import { ProfileScreen } from '~/features/admin/ProfileScreen'

export const Route = createFileRoute('/_authed/admin/profiles/$profileId')({
  component: ProfileScreen,
})
