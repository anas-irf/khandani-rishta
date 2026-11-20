import { createFileRoute } from '@tanstack/react-router'
import { ReleasesScreen } from '~/features/admin/ReleasesScreen'

export const Route = createFileRoute('/_authed/admin/releases')({
  component: ReleasesScreen,
})
