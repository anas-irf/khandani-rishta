import { createFileRoute } from '@tanstack/react-router'
import { HomeScreen } from '~/features/discovery/HomeScreen'

export const Route = createFileRoute('/_authed/_app/home')({
  component: HomeScreen,
})
