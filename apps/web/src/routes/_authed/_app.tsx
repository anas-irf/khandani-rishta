import { createFileRoute, Outlet } from '@tanstack/react-router'
import { AppShell } from '~/components/layout/AppShell'
import { NotFound } from '~/components/NotFound'

/** The application shell layout (17 section 3.3). */
export const Route = createFileRoute('/_authed/_app')({
  component: AppLayout,
  notFoundComponent: () => <NotFound />,
})

function AppLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}
