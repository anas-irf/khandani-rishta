import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { SessionBoundary } from '~/features/auth/SessionBoundary'
import { SignInPage } from '~/features/auth/SignInPage'
import { safeRedirectPath } from '~/lib/utils'

const searchSchema = z.object({
  // Accepted only when it is a same-origin path (17 section 14).
  redirect_url: z
    .string()
    .optional()
    .transform((value) => safeRedirectPath(value))
    .catch(undefined),
})

export const Route = createFileRoute('/sign-in/$')({
  validateSearch: searchSchema,
  ssr: false,
  head: () => ({
    meta: [{ title: 'Sign in | Khandani Rishta' }, { name: 'robots', content: 'noindex' }],
  }),
  component: SignInRoute,
})

function SignInRoute() {
  const { redirect_url } = Route.useSearch()
  return (
    <SessionBoundary>
      <SignInPage redirectUrl={redirect_url} />
    </SessionBoundary>
  )
}
