import { createFileRoute } from '@tanstack/react-router'
import { OverviewScreen } from '~/features/admin/OverviewScreen'

export const Route = createFileRoute('/_authed/admin/')({
  component: OverviewScreen,
})
