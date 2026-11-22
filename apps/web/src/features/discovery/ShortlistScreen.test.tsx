import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { db } from '~/mocks/db'
import { apiError, apiUrl, noContent } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderWithProviders } from '~/test/render'
import { ShortlistScreen } from './ShortlistScreen'
import { VisitorsScreen } from './VisitorsScreen'

const members = () => [...db.profiles.values()].filter((p) => p.relation.tier === 'member')

function seedShortlist() {
  const [first, second] = members()
  db.shortlist = [
    {
      profile_id: first?.card.id ?? '',
      profile: null,
      note: 'Ask about the family business',
      created_at: new Date(Date.now() - 3_600_000).toISOString(),
    },
    {
      profile_id: second?.card.id ?? '',
      profile: null,
      note: null,
      created_at: new Date().toISOString(),
    },
    { profile_id: 'gone', profile: null, note: null, created_at: new Date().toISOString() },
  ]
  return { first, second }
}

describe('APP-SHORTLIST', () => {
  it('shows the empty state with "See my matches"', async () => {
    renderWithProviders(() => <ShortlistScreen />, { me: db.me })
    expect(await screen.findByText('No saved profiles yet.')).toBeInTheDocument()
    expect(screen.getByText('Tap Shortlist on a profile to save it for later.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See my matches' })).toHaveAttribute('href', '/matches')
  })

  it('lists saved profiles with their note and time, and unavailable ones', async () => {
    const { first } = seedShortlist()
    renderWithProviders(() => <ShortlistScreen />, { me: db.me })
    expect(await screen.findByText('Only you can see this list.')).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: 'Saved profiles' })
    expect(within(list).getAllByRole('article')).toHaveLength(2)
    expect(within(list).getByText('Ask about the family business')).toHaveClass('italic')
    expect(within(list).getByText('Saved 1 hour ago')).toBeInTheDocument()
    expect(
      within(list).getByRole('link', { name: new RegExp(first?.card.display_name ?? '') }),
    ).toBeInTheDocument()
    expect(within(list).getByText('No longer available')).toBeInTheDocument()
  })

  it('removes an unavailable row by its profile_id', async () => {
    const user = userEvent.setup()
    seedShortlist()
    renderWithProviders(() => <ShortlistScreen />, { me: db.me })
    await user.click(
      await screen.findByRole('button', { name: 'Remove this profile from the shortlist' }),
    )
    await waitFor(() => expect(screen.queryByText('No longer available')).toBeNull())
    expect(db.shortlist.some((entry) => entry.profile_id === 'gone')).toBe(false)
  })

  it('removes a row at once with "Removed. Undo", and undo puts it back with its note', async () => {
    const user = userEvent.setup()
    const { first } = seedShortlist()
    const puts: unknown[] = []
    server.use(
      http.put(apiUrl('/v1/shortlist/:id'), async ({ request }) => {
        puts.push(await request.json())
        return noContent()
      }),
    )
    renderWithProviders(() => <ShortlistScreen />, { me: db.me })
    const list = await screen.findByRole('list', { name: 'Saved profiles' })
    const row = within(list).getAllByRole('article')[0] as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'Remove' }))
    expect(await screen.findByText('Removed.')).toBeInTheDocument()
    await waitFor(() =>
      expect(within(list).queryByText('Ask about the family business')).toBeNull(),
    )
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(puts).toEqual([{ note: 'Ask about the family business' }]))
    expect(first).toBeDefined()
  })

  it('restores a row when the remove fails', async () => {
    const user = userEvent.setup()
    seedShortlist()
    server.use(http.delete(apiUrl('/v1/shortlist/:id'), () => apiError(500, 'internal_error', 'x')))
    renderWithProviders(() => <ShortlistScreen />, { me: db.me })
    const list = await screen.findByRole('list', { name: 'Saved profiles' })
    const row = within(list).getAllByRole('article')[0] as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'Remove' }))
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument()
    expect(within(list).getByText('Ask about the family business')).toBeInTheDocument()
  })

  it('edits a note of at most 300 characters', async () => {
    const user = userEvent.setup()
    seedShortlist()
    const puts: unknown[] = []
    server.use(
      http.put(apiUrl('/v1/shortlist/:id'), async ({ request }) => {
        puts.push(await request.json())
        return noContent()
      }),
    )
    renderWithProviders(() => <ShortlistScreen />, { me: db.me })
    const list = await screen.findByRole('list', { name: 'Saved profiles' })
    const row = within(list).getAllByRole('article')[0] as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'Edit note' }))
    const dialog = await screen.findByRole('dialog')
    const field = within(dialog).getByRole('textbox', { name: 'Note' })
    expect(field).toHaveValue('Ask about the family business')
    expect(field).toHaveAttribute('maxlength', '300')
    await user.clear(field)
    await user.type(field, 'Call after Eid')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Note saved.')).toBeInTheDocument()
    expect(puts).toEqual([{ note: 'Call after Eid' }])
  })

  it('shows the screen error', async () => {
    server.use(http.get(apiUrl('/v1/shortlist'), () => apiError(500, 'internal_error', 'x')))
    renderWithProviders(() => <ShortlistScreen />, { me: db.me })
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
  })
})

describe('APP-VISITORS', () => {
  it('lists who viewed me with the time and the count', async () => {
    renderWithProviders(() => <VisitorsScreen />, { me: db.me })
    expect(
      await screen.findByRole('tab', { name: 'Viewed me', selected: true }),
    ).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: 'Viewed me' })
    expect(within(list).getAllByRole('article').length).toBeGreaterThan(0)
    expect(within(list).getAllByText(/^Viewed /).length).toBeGreaterThan(0)
    expect(within(list).getAllByText(/ · \d+ times$/).length).toBeGreaterThan(0)
  })

  it('shows the private browsing panel instead of the list', async () => {
    db.privacy.record_my_visits = false
    renderWithProviders(() => <VisitorsScreen />, { me: db.me })
    expect(await screen.findByText('You are browsing privately')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open privacy settings' })).toHaveAttribute(
      'href',
      '/settings/privacy',
    )
  })

  it('switches to "I viewed" and shows its empty text', async () => {
    const user = userEvent.setup()
    server.use(
      http.get(apiUrl('/v1/me/visited'), () => HttpResponse.json({ items: [], next_cursor: null })),
    )
    renderWithProviders(() => <VisitorsScreen />, { me: db.me })
    await user.click(await screen.findByRole('tab', { name: 'I viewed' }))
    expect(
      await screen.findByText('Profiles you open appear here for 30 days.'),
    ).toBeInTheDocument()
  })

  it('shows the empty text of "Viewed me" and the screen error', async () => {
    server.use(
      http.get(apiUrl('/v1/me/visitors'), () =>
        HttpResponse.json({ items: [], next_cursor: null, hidden_because_private: false }),
      ),
    )
    renderWithProviders(() => <VisitorsScreen />, { me: db.me })
    expect(
      await screen.findByText('No one has viewed the profile in the last 30 days.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Adding a photo and completing the profile helps.')).toBeInTheDocument()
  })

  it('shows the status panel for a paused profile', async () => {
    db.me.profile.status = 'paused'
    renderWithProviders(() => <VisitorsScreen />, { me: db.me })
    expect(await screen.findByText('The profile is paused')).toBeInTheDocument()
  })
})
