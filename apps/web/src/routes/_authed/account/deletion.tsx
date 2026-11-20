import { createFileRoute } from '@tanstack/react-router'
import { DeletionScreen } from '~/features/gate-screens/DeletionScreen'

export const Route = createFileRoute('/_authed/account/deletion')({
  component: DeletionScreen,
})
