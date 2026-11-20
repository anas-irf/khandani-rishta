import { createFileRoute } from '@tanstack/react-router'
import { ReviewScreen } from '~/features/gate-screens/ReviewScreen'

export const Route = createFileRoute('/_authed/account/review')({
  component: ReviewScreen,
})
