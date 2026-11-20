import { createFileRoute } from '@tanstack/react-router'
import { AccountScreen } from '~/features/settings/AccountScreen'

export const Route = createFileRoute('/_authed/_app/settings/account')({
  component: AccountScreen,
})
