import { createFileRoute } from '@tanstack/react-router'
import { NotificationSettingsScreen } from '~/features/settings/NotificationSettingsScreen'

export const Route = createFileRoute('/_authed/_app/settings/notifications')({
  component: NotificationSettingsScreen,
})
