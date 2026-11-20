import { createFileRoute } from '@tanstack/react-router'
import { ChatsIndex } from '~/features/chat/ChatsScreen'
import { chatsSearchSchema } from '~/features/chat/search'

export const Route = createFileRoute('/_authed/_app/chats/')({
  validateSearch: chatsSearchSchema,
  component: ChatsIndex,
})
