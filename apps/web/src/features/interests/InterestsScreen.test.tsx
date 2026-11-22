import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import type { Interest, Me } from '~/lib/api-types'
import { limitDialogStore } from '~/lib/dialogs'
import { db } from '~/mocks/db'
import { makeInterest, makeMe } from '~/mocks/factories'
import { interestsState } from '~/mocks/handlers/interests'
import { apiError, apiUrl } from '~/mocks/http'
import { server } from '~/mocks/server'
import { pinSeededClock } from '~/test/clock'
import { renderWithProviders } from '~/test/render'
import { InterestsScreen } from './InterestsScreen'

const RECEIVED_1 = '30000000-0000-4000-8000-000000000001'
const RECEIVED_2 = '30000000-0000-4000-8000-000000000002'
const SENT_1 = '30000000-0000-4000-8000-000000000003'

function render(path = '/interests', me: Me = structuredClone(db.me)) {
  return renderWithProviders(() => <InterestsScreen />, { path, me })
}

function nameOf(id: string): string {
  const interest = db.interests.find((item) => item.id === id)
  return interest?.profile?.display_name ?? ''
}

function rowOf(id: string): HTMLElement {
  const row = document.getElementById(`interest-${id}`)
  if (!row) throw new Error(`No row ${id}`)
  return row
}

pinSeededClock()

describe('APP-INTERESTS', () => {
  it('shows a skeleton, then the received new interests with message, expiry and unseen dot', async () => {
    render()
    expect(await screen.findByRole('status', { busy: true })).toBeInTheDocument()
    expect(await screen.findByText(new RegExp(nameOf(RECEIVED_1)))).toBeInTheDocument()
    const row = rowOf(RECEIVED_1)
    expect(within(row).getByText(/Our families may get along well/)).toBeInTheDocument()
    expect(within(row).getByText(/^Expires in \d+ days?$|^Expires today$/)).toBeInTheDocument()
    expect(within(row).getByText(/^Received /)).toBeInTheDocument()
    expect(within(row).getByText('New')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Accept' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Decline' })).toBeInTheDocument()
  })

  it('marks the shown unseen interests as seen after a second', async () => {
    const bodies: unknown[] = []
    server.use(
      http.post(apiUrl('/v1/interests/seen'), async ({ request }) => {
        bodies.push(await request.json())
        return new HttpResponse(null, { status: 204 })
      }),
    )
    render()
    await screen.findByText(new RegExp(nameOf(RECEIVED_1)))
    await waitFor(() => expect(bodies).toHaveLength(1), { timeout: 3000 })
    expect(bodies[0]).toEqual({ interest_ids: expect.arrayContaining([RECEIVED_1, RECEIVED_2]) })
    await waitFor(() => expect(within(rowOf(RECEIVED_1)).queryByText('New')).toBeNull())
  })

  it('shows the empty state of each list', async () => {
    db.interests = []
    const { router } = render('/interests?box=received&status=pending')
    expect(await screen.findByText('No new interests.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Improve my profile' })).toHaveAttribute('href', '/me')
    await router.navigate({ to: '/interests', search: { box: 'sent', status: 'pending' } })
    expect(await screen.findByText('You have not sent any interests.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See my matches' })).toBeInTheDocument()
    await router.navigate({ to: '/interests', search: { box: 'sent', status: 'accepted' } })
    expect(
      await screen.findByText(
        'When someone accepts your interest, it appears here and you can chat.',
      ),
    ).toBeInTheDocument()
    await router.navigate({ to: '/interests', search: { box: 'received', status: 'closed' } })
    expect(await screen.findByText('Nothing here yet.')).toBeInTheDocument()
  })

  it('shows the error state when the list fails', async () => {
    server.use(http.get(apiUrl('/v1/interests'), () => apiError(500, 'internal_error', 'Boom')))
    render()
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('switches box and filter through the search params', async () => {
    const user = userEvent.setup()
    const { router } = render()
    await screen.findByText(new RegExp(nameOf(RECEIVED_1)))
    await user.click(screen.getByRole('tab', { name: 'Sent' }))
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ box: 'sent', status: 'pending' }),
    )
    expect(await screen.findByRole('tab', { name: 'Waiting' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(await screen.findByText(new RegExp(nameOf(SENT_1)))).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Closed' }))
    await waitFor(() => expect(router.state.location.search).toMatchObject({ status: 'closed' }))
  })

  it('accepts, toasts and opens the new chat', async () => {
    const user = userEvent.setup()
    const { router } = render()
    await screen.findByText(new RegExp(nameOf(RECEIVED_1)))
    await user.click(within(rowOf(RECEIVED_1)).getByRole('button', { name: 'Accept' }))
    expect(await screen.findByText('You are now connected.')).toBeInTheDocument()
    const connection = db.connections.find(
      (item) => item.other?.id === db.interests.find((i) => i.id === RECEIVED_1)?.profile?.id,
    )
    expect(connection).toBeDefined()
    await waitFor(() => expect(router.state.location.pathname).toBe(`/chats/${connection?.id}`))
    expect(db.interests.find((item) => item.id === RECEIVED_1)?.status).toBe('accepted')
    expect(db.me.counters.pending_interests).toBe(1)
    const messages = db.messages.get(connection?.id ?? '') ?? []
    expect(messages[0]).toMatchObject({ kind: 'system', system_event: 'connected' })
  })

  it.each([
    ['you', 'You have reached the maximum number of connections. End one to accept.'],
    ['them', 'This member cannot take new connections right now. Please try again later.'],
  ])('shows the limit text when the connection cap is full on side %s', async (side, text) => {
    limitDialogStore.set(null)
    server.use(
      http.post(apiUrl('/v1/interests/:id/accept'), () =>
        apiError(429, 'limit_reached', 'Limit', {
          details: { limit: 'limits.active_connections_max', used: 30, resets_at: null, side },
        }),
      ),
    )
    const user = userEvent.setup()
    render()
    await screen.findByText(new RegExp(nameOf(RECEIVED_1)))
    await user.click(within(rowOf(RECEIVED_1)).getByRole('button', { name: 'Accept' }))
    // The dialog itself is rendered by GlobalDialogs; the text key is chosen here.
    await waitFor(() =>
      expect(limitDialogStore.get()?.textKey).toBe(`interests:limit.accept_${side}`),
    )
    expect(text.length).toBeGreaterThan(0)
  })

  it('accept with the side them comes from the mock when the sender is at the cap', async () => {
    const senderId = db.interests.find((item) => item.id === RECEIVED_1)?.profile?.id ?? ''
    interestsState().atCapacity.add(senderId)
    const user = userEvent.setup()
    render()
    await screen.findByText(new RegExp(nameOf(RECEIVED_1)))
    await user.click(within(rowOf(RECEIVED_1)).getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(limitDialogStore.get()?.details.side).toBe('them'))
    expect(db.interests.find((item) => item.id === RECEIVED_1)?.status).toBe('pending')
  })

  it('refetches the list when the interest is no longer pending', async () => {
    let calls = 0
    server.use(
      http.get(apiUrl('/v1/interests'), () => {
        calls += 1
        return undefined
      }),
      http.post(apiUrl('/v1/interests/:id/accept'), () =>
        apiError(409, 'invalid_state', 'Not pending', { details: { status: 'withdrawn' } }),
      ),
    )
    const user = userEvent.setup()
    render()
    await screen.findByText(new RegExp(nameOf(RECEIVED_1)))
    const before = calls
    await user.click(within(rowOf(RECEIVED_1)).getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(calls).toBeGreaterThan(before))
  })

  it('declines after confirmation, optionally blocking, without telling the sender', async () => {
    const user = userEvent.setup()
    render()
    await screen.findByText(new RegExp(nameOf(RECEIVED_2)))
    const name = nameOf(RECEIVED_2)
    await user.click(within(rowOf(RECEIVED_2)).getByRole('button', { name: 'Decline' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Decline this interest?')).toBeInTheDocument()
    expect(within(dialog).getByText(`${name} will not be notified.`)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('checkbox', { name: `Also block ${name}` }))
    await user.click(within(dialog).getByRole('button', { name: 'Decline' }))
    expect(await screen.findByText('Interest declined.')).toBeInTheDocument()
    await waitFor(() => expect(document.getElementById(`interest-${RECEIVED_2}`)).toBeNull())
    expect(db.interests.find((item) => item.id === RECEIVED_2)?.status).toBe('declined')
    expect(db.blocks.some((entry) => entry.display_name === name)).toBe(true)
  })

  it('withdraws a sent interest after confirmation', async () => {
    const user = userEvent.setup()
    render('/interests?box=sent&status=pending')
    await screen.findByText(new RegExp(nameOf(SENT_1)))
    await user.click(within(rowOf(SENT_1)).getByRole('button', { name: 'Withdraw' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('You can send a new one after 7 days.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Withdraw' }))
    expect(await screen.findByText('Interest withdrawn.')).toBeInTheDocument()
    expect(db.interests.find((item) => item.id === SENT_1)?.status).toBe('withdrawn')
  })

  it('shows a hidden decline to the sender as "No response yet" with Withdraw', async () => {
    const sent = db.interests.find((item) => item.id === SENT_1)
    if (sent) {
      sent.status = 'declined'
      sent.responded_at = new Date().toISOString()
    }
    render('/interests?box=sent&status=pending')
    await screen.findByText(new RegExp(nameOf(SENT_1)))
    const row = rowOf(SENT_1)
    expect(within(row).getByText('No response yet')).toBeInTheDocument()
    expect(within(row).queryByText(/declined/i)).toBeNull()
    expect(within(row).getByRole('button', { name: 'Withdraw' })).toBeInTheDocument()
  })

  it('labels closed and accepted items by display status and links accepted ones to the chat', async () => {
    const card = [...db.profiles.values()][10]?.card ?? null
    const items: Interest[] = [
      makeInterest({
        id: 'i-acc',
        direction: 'received',
        status: 'accepted',
        connection_id: 'c-acc',
        profile: card,
        seen: true,
        created_at: '2026-11-19T09:00:00Z',
      }),
    ]
    db.interests = items
    render('/interests?box=received&status=accepted')
    const link = await screen.findByRole('link', { name: 'Open chat' })
    expect(link).toHaveAttribute('href', '/chats/c-acc')
    expect(within(rowOf('i-acc')).getByText('Accepted')).toBeInTheDocument()
  })

  it('shows "This member is no longer available" without actions when the profile is gone', async () => {
    server.use(
      http.get(apiUrl('/v1/interests'), () =>
        HttpResponse.json({
          items: [
            makeInterest({
              id: 'i-gone',
              profile: null,
              status: 'expired',
              display_status: 'closed',
            }),
          ],
          next_cursor: null,
        }),
      ),
    )
    render('/interests?box=received&status=closed')
    expect(await screen.findByText('This member is no longer available')).toBeInTheDocument()
    expect(within(rowOf('i-gone')).queryByRole('button')).toBeNull()
    expect(within(rowOf('i-gone')).getByText('Closed')).toBeInTheDocument()
  })

  it('scrolls to and highlights the interest named in the URL', async () => {
    render(`/interests?box=received&status=pending&interest_id=${RECEIVED_2}`)
    await screen.findByText(new RegExp(nameOf(RECEIVED_2)))
    expect(rowOf(RECEIVED_2)).toHaveAttribute('data-highlighted', 'true')
    expect(rowOf(RECEIVED_1)).not.toHaveAttribute('data-highlighted')
  })

  it('shows the closed-profile panel', async () => {
    render('/interests', makeMe({ profile: { status: 'closed' } }))
    expect(await screen.findByText('The profile is closed')).toBeInTheDocument()
  })
})
