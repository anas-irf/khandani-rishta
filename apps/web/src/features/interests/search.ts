import { z } from 'zod'

/** Search parameters of `/interests` (17 section 3.3). */
export const interestsSearchSchema = z.object({
  box: z.enum(['received', 'sent']).default('received').catch('received'),
  status: z.enum(['pending', 'accepted', 'closed']).default('pending').catch('pending'),
  interest_id: z.string().optional().catch(undefined),
})
