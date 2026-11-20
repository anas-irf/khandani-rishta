import { createFileRoute } from '@tanstack/react-router'
import { BlockedScreen } from '~/features/gate-screens/BlockedScreen'

export const Route = createFileRoute('/_authed/account/blocked')({
  component: BlockedScreen,
})
