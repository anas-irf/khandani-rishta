import { createFileRoute } from '@tanstack/react-router'
import { SettingsScreen } from '~/features/admin/SettingsScreen'

export const Route = createFileRoute('/_authed/admin/settings')({
  component: SettingsScreen,
})
