import { createFileRoute } from '@tanstack/react-router'
import { ChatsLayout } from '~/features/chat/ChatsScreen'
import { chatsSearchSchema } from '~/features/chat/search'

/** `/chats`: the chat list beside the open conversation on wide screens (17 section 9.1). */
export const Route = createFileRoute('/_authed/_app/chats')({
  validateSearch: chatsSearchSchema,
  component: ChatsLayout,
})
