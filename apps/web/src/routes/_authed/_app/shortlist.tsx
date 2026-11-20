import { createFileRoute } from '@tanstack/react-router'
import { ShortlistScreen } from '~/features/discovery/ShortlistScreen'

export const Route = createFileRoute('/_authed/_app/shortlist')({
  component: ShortlistScreen,
})
