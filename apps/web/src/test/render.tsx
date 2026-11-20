import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'

/**
 * Renders `ui` inside a minimal in-memory router, for components that use router hooks or
 * `<Link>`. The router renders asynchronously, so query with `findBy*` first.
 */
export function renderWithRouter(ui: () => ReactNode, { path = '/' }: { path?: string } = {}) {
  const router = createRouter({
    routeTree: createRootRoute({ component: ui }),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  return render(<RouterProvider router={router} />)
}
