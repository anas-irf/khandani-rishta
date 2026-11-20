import type { ReactNode } from 'react'
import { NotFound } from '~/components/NotFound'
import type { UserRole } from '~/lib/api-types'
import { useCurrentMe } from '~/lib/me'

/** Whether a role may use the console at all (17 section 16). */
export function isStaffRole(role: UserRole | string | undefined): role is 'moderator' | 'admin' {
  return role === 'moderator' || role === 'admin'
}

/** The signed-in staff member's role. Only call inside the admin layout (after its guard). */
export function useStaffRole(): 'moderator' | 'admin' {
  const role = useCurrentMe().user.role
  return role === 'admin' ? 'admin' : 'moderator'
}

export function useIsAdmin(): boolean {
  return useStaffRole() === 'admin'
}

/**
 * Wraps a screen that only admins may use (settings, releases, announcements, audit log). A
 * moderator who types the URL sees "Not found", as for a member (the API answers 403 as well).
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const isAdmin = useIsAdmin()
  if (!isAdmin) return <NotFound />
  return <>{children}</>
}
