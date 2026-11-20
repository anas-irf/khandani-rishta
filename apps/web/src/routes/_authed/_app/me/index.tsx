import { createFileRoute } from '@tanstack/react-router'
import { MeProfileScreen } from '~/features/me/MeProfileScreen'

export const Route = createFileRoute('/_authed/_app/me/')({
  component: MeProfileScreen,
})
