import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Home } from '~/lib/api-types'
import { db } from '~/mocks/db'
import { discoveryState } from '~/mocks/handlers/discovery'
import { apiError, apiUrl, noContent } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderWithProviders } from '~/test/render'
import { HomeScreen } from './HomeScreen'
import { decodeSearchQuery } from './search-params'

function renderHome() {
  return renderWithProviders(() => <HomeScreen />, { me: db.me, path: '/home' })
}

function qOf(href: string | null): unknown {
  const q = new URL(href ?? '', 'http://x').searchParams.get('q')
  return decodeSearchQuery(q)
}

afterEach(() => {
  vi.useRealTimers()
})

describe('APP-HOME', () => {
  it('shows skeleton rows, then the greeting and the rows of matches', async () => {
    renderHome()
    expect(await screen.findByRole('status')).toHaveAttribute('aria-busy', 'true')
    expect(await screen.findByRole('heading', { name: 'Welcome back, Ayesha' })).toBeInTheDocument()

    const matches = await screen.findByRole('region', { name: 'Your matches' })
    expect(within(matches).getAllByRole('article').length).toBe(10)
    expect(within(matches).getByRole('link', { name: 'See all: Your matches' })).toHaveAttribute(
      'href',
      '/matches',
    )
    expect(screen.getByRole('region', { name: 'Near you' })).toBeInTheDocument()
  })

  it('links "See all" of new members to the search with its preset', async () => {
    renderHome()
    const row = await screen.findByRole('region', { name: 'New members' })
    const link = within(row).getByRole('link', { name: 'See all: New members' })
    expect(qOf(link.getAttribute('href'))).toEqual({
      filters: { joined_within_days: 7 },
      sort: 'newest',
    })
  })

  it('opens the search near the viewer with the own city', async () => {
    const user = userEvent.setup()
    const { router } = renderHome()
    const row = await screen.findByRole('region', { name: 'Near you' })
    await user.click(within(row).getByRole('button', { name: 'See all: Near you' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/search'))
    const q = (router.state.location.search as { q?: string }).q
    expect(decodeSearchQuery(q)).toEqual({
      filters: { city_ids: [db.ownProfile.location.city_id] },
      sort: 'best_match',
    })
  })

  it('greets a managed profile on behalf of the candidate', async () => {
    db.me.profile.managed_by = 'parent'
    renderHome()
    expect(
      await screen.findByRole('heading', { name: "Welcome back. Managing Ayesha's profile." }),
    ).toBeInTheDocument()
  })

  it('shows pending interests, nudges and the visitors block', async () => {
    renderHome()
    expect(await screen.findByText('2 members are interested in you')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute(
      'href',
      '/interests?box=received&status=pending',
    )

    const nudges = screen.getByRole('region', { name: 'Suggestions for your profile' })
    expect(within(nudges).getByRole('link', { name: /Verify your identity/ })).toHaveAttribute(
      'href',
      '/me/verification',
    )
    expect(within(nudges).getByRole('link', { name: /Write about yourself/ })).toHaveAttribute(
      'href',
      '/me/edit/lifestyle',
    )
    expect(within(nudges).getByRole('link', { name: /Add contact details/ })).toHaveAttribute(
      'href',
      '/settings/contacts',
    )

    const visitors = screen.getByRole('region', { name: 'Viewed your profile' })
    expect(within(visitors).getByText(/members viewed the profile this week$/)).toBeInTheDocument()
    expect(
      within(visitors).getByRole('link', { name: 'See all members who viewed your profile' }),
    ).toHaveAttribute('href', '/visitors')
    expect(screen.queryByText('Complete profiles receive more interest.')).toBeNull()
  })

  it('shows the completeness card under 70 percent', async () => {
    db.me.profile.completeness = 55
    renderHome()
    expect(await screen.findByText('Complete profiles receive more interest.')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Profile 55% complete' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Improve my profile' })).toHaveAttribute('href', '/me')
  })

  it('ends the row with the exhausted card and its hints', async () => {
    db.preferences = { ...(db.preferences ?? ({} as never)), age_importance: 'must' }
    const state = discoveryState()
    state.poolExhausted = true
    state.relaxationHints = [{ dimension: 'caste', extra_profiles: 12 }]
    renderHome()
    expect(
      await screen.findByText(
        'You have seen everyone who fits your must-haves. Loosen one to see more.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Changing your must-have for Caste would show 12 more profiles.'),
    ).toBeInTheDocument()
    expect(await screen.findByText('Widening your age range may also help.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review preferences' })).toHaveAttribute(
      'href',
      '/me/preferences',
    )
  })

  it('says when no member fits the must-haves at all', async () => {
    const state = discoveryState()
    state.poolExhausted = true
    for (const profile of db.profiles.values()) db.passes.add(profile.card.id)
    renderHome()
    expect(
      await screen.findByText('No more members fit all your must-haves right now.'),
    ).toBeInTheDocument()
    const notice = document.querySelector('[data-exhausted="empty"]') as HTMLElement
    expect(within(notice).getByRole('link', { name: 'Search' })).toHaveAttribute('href', '/search')
  })

  it('keeps "Finding your matches..." for 3 refetches 5 seconds apart, then says none yet', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let loads = 0
    server.use(
      http.get(apiUrl('/v1/home'), () => {
        loads += 1
        const empty: Home = {
          recommendations: [],
          new_members: [],
          nearby: [],
          recent_visitors: [],
          visitors_count_7d: 0,
          pending_interests: 0,
          completeness: 80,
          nudges: [],
          pool_exhausted: false,
          relaxation_hints: [],
        }
        return HttpResponse.json(empty)
      }),
    )
    renderHome()
    expect(await screen.findByText('Finding your matches...')).toBeInTheDocument()
    for (let round = 1; round <= 3; round += 1) {
      await act(() => vi.advanceTimersByTimeAsync(5000))
      await waitFor(() => expect(loads).toBe(round + 1))
    }
    expect(await screen.findByText('No matches yet.')).toBeInTheDocument()
    expect(screen.getByText('Try the search, or check back later.')).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(loads).toBe(4)
  })

  it('hides a card with "Not interested" and offers "Undo" for 5 seconds', async () => {
    const user = userEvent.setup()
    let undone = false
    server.use(
      http.delete(apiUrl('/v1/passes/:id'), () => {
        undone = true
        return noContent()
      }),
    )
    renderHome()
    const row = await screen.findByRole('region', { name: 'Your matches' })
    const first = within(row).getAllByRole('article')[0] as HTMLElement
    const name = within(first).getAllByRole('link')[0]?.textContent ?? ''
    await user.click(within(first).getByRole('button', { name: /More actions for/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Not interested' }))
    expect(await screen.findByText('Hidden.')).toBeInTheDocument()
    await waitFor(() => expect(within(row).queryByRole('link', { name })).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(undone).toBe(true))
  })

  it('dismisses the first-run tip on this device', async () => {
    const user = userEvent.setup()
    renderHome()
    await user.click(await screen.findByRole('button', { name: 'Hide this tip' }))
    expect(screen.queryByText(/^Tip: open a profile/)).toBeNull()
    expect(window.localStorage.getItem(`kr.home.first_run_tip.${db.me.profile.id}`)).toBe('1')
  })

  it('shows the announcement until it is closed', async () => {
    const user = userEvent.setup()
    db.me.config.announcement = { text_en: 'New: verified badges', text_ur: null, url: null }
    renderHome()
    expect(await screen.findByText('New: verified badges')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Hide this announcement' }))
    expect(screen.queryByText('New: verified badges')).toBeNull()
  })

  it('shows the screen error when GET /v1/home fails', async () => {
    server.use(http.get(apiUrl('/v1/home'), () => apiError(500, 'internal_error', 'Boom')))
    renderHome()
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('shows the status panel for a paused profile, with the bell still there', async () => {
    db.me.profile.status = 'paused'
    renderHome()
    expect(await screen.findByText('The profile is paused')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Notifications/ })).toBeInTheDocument()
  })
})
