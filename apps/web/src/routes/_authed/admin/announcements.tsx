import { createFileRoute } from '@tanstack/react-router'
import { AnnouncementsScreen } from '~/features/admin/AnnouncementsScreen'

export const Route = createFileRoute('/_authed/admin/announcements')({
  component: AnnouncementsScreen,
})
