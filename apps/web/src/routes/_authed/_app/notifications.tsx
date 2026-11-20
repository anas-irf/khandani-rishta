import { createFileRoute } from '@tanstack/react-router'
import { NotificationsScreen } from '~/features/notifications/NotificationsScreen'

export const Route = createFileRoute('/_authed/_app/notifications')({
  component: NotificationsScreen,
})
