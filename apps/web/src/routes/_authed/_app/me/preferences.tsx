import { createFileRoute } from '@tanstack/react-router'
import { MePreferencesScreen } from '~/features/me/MePreferencesScreen'

export const Route = createFileRoute('/_authed/_app/me/preferences')({
  component: MePreferencesScreen,
})
