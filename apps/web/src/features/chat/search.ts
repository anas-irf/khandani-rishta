import { z } from 'zod'

/** Search parameters of `/chats` (17 section 3.3). */
export const chatsSearchSchema = z.object({
  filter: z.enum(['active', 'archived', 'ended']).default('active').catch('active'),
})
