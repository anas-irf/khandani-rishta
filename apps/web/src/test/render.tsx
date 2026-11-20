import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Toaster } from '~/components/ui/sonner'
import { type AuthSession, TestSessionProvider } from '~/features/auth/session'
import type { Me } from '~/lib/api-types'
import { createQueryClient, qk } from '~/lib/query'
import { referenceBootstrap } from '~/mocks/fixtures/reference'

/**
 * Renders `ui` inside a minimal in-memory router, for components that use router hooks or
 * `<Link>`. The router renders asynchronously, so query with `findBy*` first.
 */
export function renderWithRouter(ui: () => ReactNode, { path = '/' }: { path?: string } = {}) {
  const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({ component: ui })
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient: createTestQueryClient() },
  })
  return render(<RouterProvider router={router} />)
}

/** A QueryClient like the app's, without retries, so failures show at once. */
export function createTestQueryClient(): QueryClient {
  const client = createQueryClient()
  client.setDefaultOptions({
    queries: { ...client.getDefaultOptions().queries, retry: false },
    mutations: { retry: false },
  })
  return client
}

export type ProvidersOptions = {
  /** Initial URL. The component is rendered for every path. */
  path?: string
  queryClient?: QueryClient
  /** Seeds `['me']` (as AuthGate would have loaded it). Pass null to leave it empty. */
  me?: Me | null
  /** Seeds the reference bootstrap (default true). */
  withReference?: boolean
  session?: Partial<AuthSession>
}

/**
 * Renders a screen or component with everything the app provides: a router (every path
 * renders `ui`), TanStack Query, a signed-in test session, the reference data and toasts.
 * API calls go to the mock API (src/mocks), reset after each test.
 */
export function renderWithProviders(ui: () => ReactNode, options: ProvidersOptions = {}) {
  const queryClient = options.queryClient ?? createTestQueryClient()
  if (options.me) queryClient.setQueryData(qk.me(), options.me)
  if (options.withReference !== false) {
    queryClient.setQueryData(qk.referenceBootstrap(), referenceBootstrap)
  }

  const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
    component: () => (
      <TestSessionProvider session={options.session}>
        <Outlet />
        <Toaster />
      </TestSessionProvider>
    ),
  })
  const catchAll = createRoute({ getParentRoute: () => rootRoute, path: '$', component: ui })
  const index = createRoute({ getParentRoute: () => rootRoute, path: '/', component: ui })
  const router = createRouter({
    routeTree: rootRoute.addChildren([index, catchAll]),
    history: createMemoryHistory({ initialEntries: [options.path ?? '/'] }),
    context: { queryClient },
    defaultPendingMinMs: 0,
  })

  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { ...result, queryClient, router }
}
