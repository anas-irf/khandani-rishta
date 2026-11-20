import { createFileRoute } from '@tanstack/react-router'
import { ConsentScreen } from '~/features/gate-screens/ConsentScreen'

export const Route = createFileRoute('/_authed/account/consent')({
  component: ConsentScreen,
})
