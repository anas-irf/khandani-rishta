import { createFileRoute, Outlet } from '@tanstack/react-router'
import { AuthGate } from '~/features/auth/AuthGate'
import { SessionBoundary } from '~/features/auth/SessionBoundary'

/**
 * Every signed-in route: rendered in the browser only (17 section 1), guarded by the gate
 * (17 section 4), never indexed (17 section 13).
 */
export const Route = createFileRoute('/_authed')({
  ssr: false,
  head: () => ({ meta: [{ name: 'robots', content: 'noindex, nofollow' }] }),
  component: AuthedLayout,
})

function AuthedLayout() {
  return (
    <SessionBoundary>
      <AuthGate>
        <Outlet />
      </AuthGate>
    </SessionBoundary>
  )
}
