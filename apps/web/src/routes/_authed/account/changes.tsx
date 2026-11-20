import { createFileRoute } from '@tanstack/react-router'
import { ChangesScreen } from '~/features/gate-screens/ChangesScreen'

export const Route = createFileRoute('/_authed/account/changes')({
  component: ChangesScreen,
})
