import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RecommendationsPage } from '~/lib/api-types'
import { db } from '~/mocks/db'
import { makeProfileCard } from '~/mocks/factories'
import { discoveryState } from '~/mocks/handlers/discovery'
import { apiError, apiUrl, noContent } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderWithProviders } from '~/test/render'
import { MatchesScreen } from './MatchesScreen'

function renderMatches() {
  return renderWithProviders(() => <MatchesScreen />, { me: db.me, path: '/matches' })
}

function page(overrides: Partial<RecommendationsPage> = {}): RecommendationsPage {
  return {
    items: [makeProfileCard({ id: 'one', display_name: 'Omar F.' })],
    next_cursor: null,
    refreshed_at: '2026-11-20T04:00:00Z',
    is_refreshing: false,
    pool_exhausted: false,
    relaxation_hints: [],
    ...overrides,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('APP-MATCHES', () => {
  it('shows skeleton cards, then the ranked list with the refresh time and links', async () => {
    renderMatches()
    expect(await screen.findByRole('status')).toHaveAttribute('aria-busy', 'true')
    const list = await screen.findByRole('list', { name: 'Your matches' })
    expect(within(list).getAllByRole('article')).toHaveLength(20)
    expect(screen.getByText(/^Updated /)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Preferences' })).toHaveAttribute(
      'href',
      '/me/preferences',
    )
  })

  it('loads further pages and then says that is everyone', async () => {
    const user = userEvent.setup()
    renderMatches()
    await screen.findByRole('list', { name: 'Your matches' })
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    expect(
      await screen.findByText('That is everyone for now. New members join every day.'),
    ).toBeInTheDocument()
  })

  it('ends an exhausted list with the exhausted card', async () => {
    server.use(
      http.get(apiUrl('/v1/recommendations'), () =>
        HttpResponse.json(
          page({
            pool_exhausted: true,
            relaxation_hints: [{ dimension: 'location', extra_profiles: 3 }],
          }),
        ),
      ),
    )
    renderMatches()
    expect(
      await screen.findByText(
        'You have seen everyone who fits your must-haves. Loosen one to see more.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Changing your must-have for Location would show 3 more profiles.'),
    ).toBeInTheDocument()
  })

  it('uses the empty texts of the home row', async () => {
    server.use(
      http.get(apiUrl('/v1/recommendations'), () =>
        HttpResponse.json(page({ items: [], pool_exhausted: true })),
      ),
    )
    renderMatches()
    expect(
      await screen.findByText('No more members fit all your must-haves right now.'),
    ).toBeInTheDocument()
  })

  it('"Refresh" shows the banner and refetches after 5 and 15 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    let loads = 0
    server.use(
      http.get(apiUrl('/v1/recommendations'), () => {
        loads += 1
        return HttpResponse.json(page({ is_refreshing: loads === 2 }))
      }),
    )
    renderMatches()
    await screen.findByRole('list', { name: 'Your matches' })
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText('Finding new matches...')).toBeInTheDocument()

    await act(() => vi.advanceTimersByTimeAsync(5000))
    await waitFor(() => expect(loads).toBe(2))
    expect(screen.getByText('Finding new matches...')).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    await waitFor(() => expect(loads).toBe(3))
    await waitFor(() => expect(screen.queryByText('Finding new matches...')).toBeNull())
  })

  it('answers a rate-limited refresh with its own toast', async () => {
    const user = userEvent.setup()
    discoveryState().lastRefreshAt = Date.now()
    renderMatches()
    await screen.findByRole('list', { name: 'Your matches' })
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText('Matches were refreshed a few minutes ago.')).toBeInTheDocument()
    expect(screen.queryByText('Finding new matches...')).toBeNull()
  })

  it('shows the banner when the list itself is being refreshed', async () => {
    server.use(
      http.get(apiUrl('/v1/recommendations'), () =>
        HttpResponse.json(page({ is_refreshing: true })),
      ),
    )
    renderMatches()
    expect(await screen.findByText('Finding new matches...')).toBeInTheDocument()
  })

  it('passes a card optimistically and restores it on failure', async () => {
    const user = userEvent.setup()
    server.use(http.put(apiUrl('/v1/passes/:id'), () => apiError(500, 'internal_error', 'Boom')))
    renderMatches()
    const list = await screen.findByRole('list', { name: 'Your matches' })
    const first = within(list).getAllByRole('article')[0] as HTMLElement
    const name = within(first).getAllByRole('link')[0]?.textContent ?? ''
    await user.click(within(first).getByRole('button', { name: /More actions for/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Not interested' }))
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument()
    expect(within(list).getByRole('link', { name })).toBeInTheDocument()
  })

  it('passes a card and removes it from the list', async () => {
    const user = userEvent.setup()
    server.use(http.put(apiUrl('/v1/passes/:id'), () => noContent()))
    renderMatches()
    const list = await screen.findByRole('list', { name: 'Your matches' })
    const first = within(list).getAllByRole('article')[0] as HTMLElement
    const name = within(first).getAllByRole('link')[0]?.textContent ?? ''
    await user.click(within(first).getByRole('button', { name: /More actions for/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Not interested' }))
    await waitFor(() => expect(within(list).queryByRole('link', { name })).toBeNull())
  })

  it('shows the screen error', async () => {
    server.use(
      http.get(apiUrl('/v1/recommendations'), () => apiError(503, 'service_unavailable', 'Down')),
    )
    renderMatches()
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
  })
})
