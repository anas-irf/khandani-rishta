import { useLocation } from '@tanstack/react-router'
import { screen } from '@testing-library/react'
import { HttpResponse, http as mswHttp } from 'msw'
import { describe, expect, it } from 'vitest'
import type { Gate } from '~/lib/api-types'
import { makeMe } from '~/mocks/factories'
import { apiError, apiUrl } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderWithProviders } from '~/test/render'
import { AuthGate } from './AuthGate'

function Probe() {
  const { pathname } = useLocation()
  return <p>content at {pathname}</p>
}

function Gated() {
  const { pathname } = useLocation()
  // In the app the sign-in page is outside the gate; here every path renders this component.
  if (pathname.startsWith('/sign-in')) return <p>sign-in page</p>
  return (
    <AuthGate>
      <Probe />
    </AuthGate>
  )
}

function serveMe(gate: Gate, onboardingStep = 'done') {
  server.use(
    mswHttp.get(apiUrl('/v1/me'), () =>
      HttpResponse.json(makeMe({ gate, profile: { onboarding_step: onboardingStep } })),
    ),
  )
}

describe('AuthGate (17 section 4.1)', () => {
  it('shows the splash while the session loads', async () => {
    renderWithProviders(() => <Gated />, { path: '/home', session: { isLoaded: false } })
    expect(await screen.findByText('Khandani Rishta')).toBeInTheDocument()
    expect(screen.queryByText(/content at/)).not.toBeInTheDocument()
  })

  it('sends a signed-out visitor to sign-in with the redirect URL', async () => {
    const { router } = renderWithProviders(() => <Gated />, {
      path: '/chats/abc?x=1',
      session: { isSignedIn: false },
    })
    expect(await screen.findByText('sign-in page')).toBeInTheDocument()
    expect(router.state.location.pathname).toMatch(/^\/sign-in\/?$/)
    expect(router.state.location.search).toEqual({ redirect_url: '/chats/abc?x=1' })
  })

  it('renders the route when the gate allows it', async () => {
    serveMe('ok')
    renderWithProviders(() => <Gated />, { path: '/home' })
    expect(await screen.findByText('content at /home')).toBeInTheDocument()
  })

  it.each([
    ['banned', '/home', '/account/blocked'],
    ['suspended', '/search', '/account/blocked'],
    ['deletion_scheduled', '/me', '/account/deletion'],
    ['consent_required', '/home', '/account/consent'],
    ['changes_requested', '/home', '/account/changes'],
    ['pending_review', '/chats', '/account/review'],
    ['ok', '/account/review', '/home'],
  ] as const)('gate %s on %s redirects to %s', async (gate, from, to) => {
    serveMe(gate)
    const { router } = renderWithProviders(() => <Gated />, { path: from })
    expect(await screen.findByText(`content at ${to}`)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(to)
  })

  it('sends onboarding members to their current step', async () => {
    serveMe('onboarding', 'community')
    renderWithProviders(() => <Gated />, { path: '/home' })
    expect(await screen.findByText('content at /onboarding/community')).toBeInTheDocument()
  })

  it('lets members under review open their own profile and settings', async () => {
    serveMe('pending_review')
    renderWithProviders(() => <Gated />, { path: '/me/photos' })
    expect(await screen.findByText('content at /me/photos')).toBeInTheDocument()
  })

  it('shows a full-screen error with retry and reference when Me fails', async () => {
    server.use(mswHttp.get(apiUrl('/v1/me'), () => apiError(503, 'service_unavailable', 'down')))
    renderWithProviders(() => <Gated />, { path: '/home', withReference: true })
    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.getByText(/^Reference: mock-/)).toBeInTheDocument()
  })

  it('waits for the reference data before rendering screens', async () => {
    serveMe('ok')
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      mswHttp.get(apiUrl('/v1/reference/bootstrap'), async () => {
        await gate
        return HttpResponse.json((await import('~/mocks/fixtures/reference')).referenceBootstrap)
      }),
    )
    renderWithProviders(() => <Gated />, { path: '/home', withReference: false })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByText('content at /home')).not.toBeInTheDocument()
    release()
    expect(await screen.findByText('content at /home')).toBeInTheDocument()
  })
})
