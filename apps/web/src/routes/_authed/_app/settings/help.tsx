import { createFileRoute } from '@tanstack/react-router'
import { HelpScreen } from '~/features/settings/HelpScreen'

export const Route = createFileRoute('/_authed/_app/settings/help')({
  component: HelpScreen,
})
