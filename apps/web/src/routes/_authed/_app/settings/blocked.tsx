import { createFileRoute } from '@tanstack/react-router'
import { BlockedMembersScreen } from '~/features/settings/BlockedMembersScreen'

export const Route = createFileRoute('/_authed/_app/settings/blocked')({
  component: BlockedMembersScreen,
})
