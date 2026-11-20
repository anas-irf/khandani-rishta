import { createFileRoute } from '@tanstack/react-router'
import { MatchesScreen } from '~/features/discovery/MatchesScreen'

export const Route = createFileRoute('/_authed/_app/matches')({
  component: MatchesScreen,
})
