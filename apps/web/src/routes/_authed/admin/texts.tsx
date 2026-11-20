import { createFileRoute } from '@tanstack/react-router'
import { TextsScreen } from '~/features/admin/TextsScreen'

export const Route = createFileRoute('/_authed/admin/texts')({
  component: TextsScreen,
})
