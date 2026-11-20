import { createFileRoute } from '@tanstack/react-router'
import { VisitorsScreen } from '~/features/discovery/VisitorsScreen'

export const Route = createFileRoute('/_authed/_app/visitors')({
  component: VisitorsScreen,
})
