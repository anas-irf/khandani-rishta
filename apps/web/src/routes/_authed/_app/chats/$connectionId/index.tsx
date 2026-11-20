import { createFileRoute } from '@tanstack/react-router'
import { ChatScreen } from '~/features/chat/ChatScreen'

export const Route = createFileRoute('/_authed/_app/chats/$connectionId/')({
  component: ChatRoute,
})

function ChatRoute() {
  const { connectionId } = Route.useParams()
  return <ChatScreen connectionId={connectionId} />
}
