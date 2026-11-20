import { createFileRoute, Outlet } from '@tanstack/react-router'
import { PublicShell } from '~/components/layout/PublicShell'

/**
 * Layout of the public pages (17 section 3.1): header, footer and skip link around the page.
 * Everything under it renders on the server.
 */
export const Route = createFileRoute('/_public')({
  component: PublicLayout,
})

function PublicLayout() {
  return (
    <PublicShell>
      <Outlet />
    </PublicShell>
  )
}
