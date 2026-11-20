import type { ReactNode } from 'react'
import type { UserRole } from '~/lib/api-types'
import { db } from '~/mocks/db'
import { makeMe } from '~/mocks/factories'
import { renderWithProviders } from '~/test/render'

/** Ids of the seeded records of the mock admin API (src/mocks/handlers/admin.ts). */
export const ids = {
  profile: (n: number) => `a1000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  user: (n: number) => `a2000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  photo: (n: number) => `a3000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  report: (n: number) => `a4000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  verification: (n: number) => `a5000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
}

/**
 * Renders an admin screen as a staff member of the given role. The mock API reads the role from
 * its own database, so both it and the cached `Me` are set.
 */
export function renderAdmin(ui: () => ReactNode, role: UserRole = 'moderator', path = '/admin') {
  db.me.user.role = role
  const me = makeMe({ user: { id: db.me.user.id, role } })
  return renderWithProviders(ui, { path, me })
}
