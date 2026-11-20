import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'
import type { Connection } from '~/lib/api-types'
import { db } from '~/mocks/db'
import { makeConnection } from '~/mocks/factories'
import { chatState } from '~/mocks/handlers/connections'
import { apiError, apiUrl } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderWithProviders } from '~/test/render'
import { ChatsScreen } from './ChatsScreen'

const FIRST = '40000000-0000-4000-8000-000000000001'
const SECOND = '40000000-0000-4000-8000-000000000002'

function render(path = '/chats') {
  return renderWithProviders(() => <ChatsScreen />, { path, me: structuredClone(db.me) })
}

function seeded(id: string): Connection {
  const found = db.connections.find((item) => item.id === id)
  if (!found) throw new Error('No seeded connection')
  return found
}

function row(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-connection-row="${id}"]`)
  if (!element) throw new Error(`No row ${id}`)
  return element
}

describe('APP-CHATS', () => {
  it('shows a skeleton, then the conversations newest first with preview, time and unread count', async () => {
    render()
    expect(await screen.findByRole('status', { busy: true })).toBeInTheDocument()
    const first = seeded(FIRST)
    expect(await screen.findByRole('link', { name: first.other?.display_name })).toHaveAttribute(
      'href',
      `/chats/${FIRST}?filter=active`,
    )
    const rows = document.querySelectorAll('[data-connection-row]')
    expect([...rows].map((element) => element.getAttribute('data-connection-row'))).toEqual([
      FIRST,
      SECOND,
    ])
    expect(
      within(row(FIRST)).getByText('Could you tell me a little about your family?'),
    ).toBeInTheDocument()
    expect(within(row(FIRST)).getByText('1 unread message')).toBeInTheDocument()
    expect(within(row(SECOND)).queryByText(/unread/)).toBeNull()
    expect(row(FIRST).querySelector('time')).not.toBeNull()
  })

  it('shows the muted icon, the stage, the proposal marker and the quiet hint', async () => {
    const first = seeded(FIRST)
    first.is_muted = true
    first.stage = 'families_talking'
    first.pending_stage_proposal = {
      id: 'p1',
      stage: 'engaged',
      proposed_by: 'them',
      created_at: '2026-11-19T10:00:00Z',
    }
    const second = seeded(SECOND)
    second.last_message_at = '2026-10-01T10:00:00Z'
    render()
    await screen.findByRole('link', { name: first.other?.display_name })
    expect(within(row(FIRST)).getByLabelText('Muted')).toBeInTheDocument()
    expect(within(row(FIRST)).getByText('Our families are in touch')).toBeInTheDocument()
    expect(within(row(FIRST)).getByText('Waiting for your answer')).toBeInTheDocument()
    expect(
      within(row(SECOND)).getByText(
        'No messages for a week. Say salaam, or end the conversation respectfully.',
      ),
    ).toBeInTheDocument()
  })

  it('shows the fixed preview lines and "Member no longer available"', async () => {
    const fresh = makeConnection({
      id: 'c-new',
      created_at: '2026-11-20T08:00:00Z',
      last_message_at: '2026-11-20T08:00:00Z',
      last_message_preview: null,
      other: [...db.profiles.values()][20]?.card ?? null,
    })
    const update = makeConnection({
      id: 'c-update',
      created_at: '2026-11-10T08:00:00Z',
      last_message_at: '2026-11-19T08:00:00Z',
      last_message_preview: null,
      other: [...db.profiles.values()][21]?.card ?? null,
    })
    db.connections.push(fresh, update)
    chatState().unavailable.add(update.other?.id ?? '')
    render()
    expect(await screen.findByText('You are now connected. Say salaam.')).toBeInTheDocument()
    expect(within(row('c-update')).getByText('Open to see the latest update')).toBeInTheDocument()
    expect(
      within(row('c-update')).getByRole('link', { name: 'Member no longer available' }),
    ).toBeInTheDocument()
  })

  it.each([
    ['active', 'No conversations yet.', 'When an interest is accepted you can chat here.'],
    ['archived', 'Archived chats appear here.', 'A new message brings a chat back.'],
    ['ended', 'Connections that have ended appear here.', null],
  ])('shows the empty state of the %s filter', async (filter, title, text) => {
    db.connections = []
    render(`/chats?filter=${filter}`)
    expect(await screen.findByText(title)).toBeInTheDocument()
    if (text) expect(screen.getByText(text)).toBeInTheDocument()
    if (filter === 'active') {
      expect(screen.getByRole('link', { name: 'See my matches' })).toHaveAttribute(
        'href',
        '/matches',
      )
    }
  })

  it('shows the error state', async () => {
    server.use(http.get(apiUrl('/v1/connections'), () => apiError(500, 'internal_error', 'Boom')))
    render()
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
  })

  it('switches filters through the URL and labels ended connections', async () => {
    const user = userEvent.setup()
    const second = seeded(SECOND)
    second.status = 'ended'
    second.ended_at = '2026-11-19T10:00:00Z'
    const { router } = render()
    await screen.findByRole('link', { name: seeded(FIRST).other?.display_name })
    await user.click(screen.getByRole('tab', { name: 'Ended' }))
    await waitFor(() => expect(router.state.location.search).toMatchObject({ filter: 'ended' }))
    await waitFor(() => expect(document.querySelectorAll('[data-connection-row]')).toHaveLength(1))
    expect(within(row(SECOND)).getByText('Ended')).toBeInTheDocument()
    expect(within(row(SECOND)).queryByRole('button', { name: /Options/ })).toBeNull()
  })

  it('mutes from the item menu at once (optimistic)', async () => {
    const user = userEvent.setup()
    render()
    const name = seeded(FIRST).other?.display_name ?? ''
    await screen.findByRole('link', { name })
    await user.click(screen.getByRole('button', { name: `Options for the chat with ${name}` }))
    await user.click(await screen.findByRole('menuitem', { name: 'Mute' }))
    expect(await within(row(FIRST)).findByLabelText('Muted')).toBeInTheDocument()
    await waitFor(() => expect(seeded(FIRST).is_muted).toBe(true))
  })

  it('reverts the mute when the request fails', async () => {
    server.use(
      http.patch(apiUrl('/v1/connections/:id'), () => apiError(500, 'internal_error', 'Boom')),
    )
    const user = userEvent.setup()
    render()
    const name = seeded(FIRST).other?.display_name ?? ''
    await screen.findByRole('link', { name })
    await user.click(screen.getByRole('button', { name: `Options for the chat with ${name}` }))
    await user.click(await screen.findByRole('menuitem', { name: 'Mute' }))
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument()
    await waitFor(() => expect(within(row(FIRST)).queryByLabelText('Muted')).toBeNull())
  })

  it('archives: the row leaves the Chats filter and appears under Archived', async () => {
    const user = userEvent.setup()
    const { router } = render()
    const name = seeded(FIRST).other?.display_name ?? ''
    await screen.findByRole('link', { name })
    await user.click(screen.getByRole('button', { name: `Options for the chat with ${name}` }))
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }))
    await waitFor(() =>
      expect(document.querySelector(`[data-connection-row="${FIRST}"]`)).toBeNull(),
    )
    expect(seeded(FIRST).is_archived).toBe(true)
    await router.navigate({ to: '/chats', search: { filter: 'archived' } })
    expect(await screen.findByRole('link', { name })).toBeInTheDocument()
  })
})
