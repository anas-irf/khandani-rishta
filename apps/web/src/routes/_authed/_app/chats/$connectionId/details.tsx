import { createFileRoute } from '@tanstack/react-router'
import { ConnectionScreen } from '~/features/chat/ConnectionScreen'

export const Route = createFileRoute('/_authed/_app/chats/$connectionId/details')({
  component: ConnectionRoute,
})

function ConnectionRoute() {
  const { connectionId } = Route.useParams()
  return <ConnectionScreen connectionId={connectionId} />
}
