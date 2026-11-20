import { createFileRoute } from '@tanstack/react-router'
import { SettingsHomeScreen } from '~/features/settings/SettingsHomeScreen'

export const Route = createFileRoute('/_authed/_app/settings/')({
  component: SettingsHomeScreen,
})
