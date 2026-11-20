import { auth } from '@clerk/tanstack-react-start/server'
import { createServerFn } from '@tanstack/react-start'
import { clerkEnabled } from '~/lib/env'

/**
 * Whether the visitor has a Clerk session, read on the Worker. Used only by the landing page,
 * so that a signed-in visitor goes to /home without a flash (17 section 4.4, 06 section 3.4).
 * This is the only server-side auth check; everything else is protected by the API.
 */
export const getIsSignedIn = createServerFn({ method: 'GET' }).handler(async () => {
  if (!clerkEnabled) return { signedIn: false }
  try {
    const { isAuthenticated } = await auth()
    return { signedIn: Boolean(isAuthenticated) }
  } catch {
    // Without Clerk keys (or if Clerk is unreachable) the landing page simply renders.
    return { signedIn: false }
  }
})
