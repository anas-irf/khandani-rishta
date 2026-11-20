import { useLocation } from '@tanstack/react-router'
import userEvent from '@testing-library/user-event'
import type { Me } from '~/lib/api-types'
import { qk } from '~/lib/query'
import { fromSlug } from '~/lib/utils'
import { db, type MockScenario, resetDb } from '~/mocks/db'
import { currentMe } from '~/mocks/handlers/account'
import { server } from '~/mocks/server'
import { renderWithProviders } from '~/test/render'
import { DoneScreen } from './DoneScreen'
import { StepScreen } from './StepScreen'

/**
 * Test helper: renders the onboarding screen of the current URL (the test router renders one
 * component for every path), so navigation between steps can be followed.
 */
function OnboardingAtUrl() {
  // Path and search from the same location, as the real route reads them from one match.
  const { pathname, search } = useLocation() as { pathname: string; search: { edit?: boolean } }
  const match = /^\/onboarding\/([^/]+)$/.exec(pathname)
  if (!match?.[1]) return <p>Now at {pathname}</p>
  if (match[1] === 'done') return <DoneScreen />
  return <StepScreen step={fromSlug(match[1])} edit={search.edit === true} />
}

export function renderOnboarding(
  path: string,
  options: { scenario?: MockScenario; prepare?: () => void } = {},
) {
  resetDb(options.scenario ?? 'onboarding_midway')
  options.prepare?.()
  const requests: { method: string; path: string; body: unknown }[] = []
  server.events.on('request:start', async ({ request }) => {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/v1/') || request.method === 'GET') return
    const body = await request.clone().text()
    requests.push({
      method: request.method,
      path: url.pathname,
      body: body ? JSON.parse(body) : null,
    })
  })
  const view = renderWithProviders(() => <OnboardingAtUrl />, {
    path,
    me: structuredClone(currentMe()),
  })
  return {
    ...view,
    user: userEvent.setup(),
    requests,
    /** Calls of one endpoint, for example `POST /v1/me/onboarding/continue`. */
    calls: (method: string, endpoint: string) =>
      requests.filter((entry) => entry.method === method && entry.path === endpoint),
    pathname: () => view.router.state.location.pathname,
    cachedMe: () => view.queryClient.getQueryData<Me>(qk.me()),
    db: () => db,
  }
}
