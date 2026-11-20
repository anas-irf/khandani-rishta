import { createFileRoute } from '@tanstack/react-router'
import { PrivacyScreen } from '~/features/settings/PrivacyScreen'

export const Route = createFileRoute('/_authed/_app/settings/privacy')({
  component: PrivacyScreen,
})
