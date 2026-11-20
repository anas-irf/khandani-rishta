import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http } from 'msw'
import { describe, expect, it } from 'vitest'
import type { Me, NotificationItem } from '~/lib/api-types'
import { qk } from '~/lib/query'
import { db } from '~/mocks/db'
import { makeNotification, makePhotoView } from '~/mocks/factories'
import { apiError, apiUrl } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderWithProviders } from '~/test/render'
import { NotificationsScreen } from './NotificationsScreen'

function renderScreen() {
  return renderWithProviders(() => <NotificationsScreen />, {
    path: '/notifications',
    me: structuredClone(db.me),
  })
}

function seed(items: ReturnType<typeof makeNotification>[]) {
  db.notifications = items
  db.me.counters.unread_notifications = items.filter((item) => !item.is_read).length
}

function counter(queryClient: ReturnType<typeof renderScreen>['queryClient']) {
  return queryClient.getQueryData<Me>(qk.me())?.counters.unread_notifications
}

describe('NotificationsScreen (APP-NOTIFS)', () => {
  it('shows skeleton rows while the feed loads', async () => {
    server.use(
      http.get(apiUrl('/v1/notifications'), async () => {
        await delay(150)
      }),
    )
    const { container } = renderScreen()
    expect(await screen.findByText('Loading')).toBeInTheDocument()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    await screen.findByText('Your photo was approved.')
    expect(container.querySelector('[aria-busy="true"]')).toBeNull()
  })

  it('lists the feed newest first with the text of every type and a dot on unread rows', async () => {
    renderScreen()

    expect(await screen.findByRole('heading', { name: 'Notifications' })).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: 'Notifications' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('sent you an interest.')
    expect(rows[1]).toHaveTextContent('Your photo was approved.')
    expect(rows[2]).toHaveTextContent('6 people viewed your profile today.')
    for (const row of rows) expect(within(row).getByText('Unread')).toBeInTheDocument()
  })

  it('shows the empty state', async () => {
    seed([])
    renderScreen()
    expect(await screen.findByText('No notifications yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled()
  })

  it('shows the error state with a reference and retries', async () => {
    let failing = true
    server.use(
      http.get(apiUrl('/v1/notifications'), () => {
        if (failing) return apiError(500, 'internal_error', 'Boom')
        return undefined
      }),
    )
    const user = userEvent.setup()
    renderScreen()

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText(/Reference: mock-/)).toBeInTheDocument()

    failing = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Your photo was approved.')).toBeInTheDocument()
  })

  it('tapping a row marks it read at once, updates the badge and opens the target', async () => {
    const user = userEvent.setup()
    const { router, queryClient } = renderScreen()

    const link = await screen.findByRole('link', { name: /sent you an interest/ })
    expect(counter(queryClient)).toBe(3)
    const actorId = db.notifications[0]?.actor?.profile_id

    await user.click(link)

    await waitFor(() => expect(router.state.location.pathname).toBe(`/profiles/${actorId}`))
    await waitFor(() => expect(db.notifications[0]?.is_read).toBe(true))
    expect(db.notifications[1]?.is_read).toBe(false)
    await waitFor(() => expect(counter(queryClient)).toBe(2))
  })

  it('opens the connection of an accepted interest from its row', async () => {
    seed([
      makeNotification({
        id: 'n-accepted',
        type: 'interest_accepted',
        data: { interest_id: 'i-1', connection_id: 'c-77' },
        actor: { profile_id: 'p-8', display_name: 'Bilal K.', photo: makePhotoView() },
      }),
    ])
    const user = userEvent.setup()
    const { router } = renderScreen()

    await user.click(await screen.findByRole('link', { name: /Bilal K. accepted your interest/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/chats/c-77'))
  })

  it('passes query values of a target on, for a reminder', async () => {
    seed([
      makeNotification({
        id: 'n-reminder',
        type: 'interest_received',
        data: { interest_id: 'i-5', reminder: true, count: 3 },
        actor: null,
      }),
    ])
    const user = userEvent.setup()
    const { router } = renderScreen()

    await user.click(await screen.findByRole('link', { name: /3 interests expire in 3 days/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/interests'))
    expect(router.state.location.search).toMatchObject({ box: 'received', interest_id: 'i-5' })
  })

  it('"Mark all as read" clears every dot and the badge', async () => {
    const user = userEvent.setup()
    const { queryClient } = renderScreen()
    await screen.findByText('Your photo was approved.')
    expect(counter(queryClient)).toBe(3)

    await user.click(screen.getByRole('button', { name: 'Mark all as read' }))

    await waitFor(() => expect(screen.queryAllByText('Unread')).toHaveLength(0))
    expect(db.notifications.every((item) => item.is_read)).toBe(true)
    await waitFor(() => expect(counter(queryClient)).toBe(0))
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled()
  })

  it('shows an unknown type as "You have a new notification." with no link, and marks it read', async () => {
    // A type a newer API may send (15 section 1: clients ignore unknown enum values).
    const newerType: string = 'type_from_the_future'
    seed([
      makeNotification({
        id: 'n-new',
        type: newerType as NotificationItem['type'],
        data: { something: 'else' },
        actor: null,
      }),
    ])
    const user = userEvent.setup()
    renderScreen()

    const row = await screen.findByRole('button', { name: /You have a new notification\./ })
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    await user.click(row)
    await waitFor(() => expect(db.notifications[0]?.is_read).toBe(true))
  })

  it('shows the moderator note under a rejected text', async () => {
    seed([
      makeNotification({
        id: 'n-text',
        type: 'text_rejected',
        data: { field: 'about_me', note: 'Please remove the phone number.' },
        actor: null,
      }),
    ])
    renderScreen()
    expect(await screen.findByText('Please remove the phone number.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Part of your profile text/ })).toHaveAttribute(
      'href',
      '/me/edit/lifestyle',
    )
  })

  it('opens the full reason of an account warning in a dialog', async () => {
    seed([
      makeNotification({
        id: 'n-warning',
        type: 'account_warning',
        data: { sanction_id: 's-1', reason: 'Please keep messages respectful.' },
        actor: null,
      }),
    ])
    const user = userEvent.setup()
    renderScreen()

    await user.click(await screen.findByRole('button', { name: /A notice about your account/ }))

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Please keep messages respectful.')).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: 'Community Guidelines' })).toHaveAttribute(
      'href',
      '/community-guidelines',
    )
    await waitFor(() => expect(db.notifications[0]?.is_read).toBe(true))

    await user.click(within(dialog).getByRole('button', { name: 'I understand' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('opens an announcement url in a new tab without a referrer', async () => {
    seed([
      makeNotification({
        id: 'n-news',
        type: 'announcement',
        data: { text_en: 'Eid mubarak', text_ur: null, url: 'https://example.com/eid' },
        actor: null,
      }),
    ])
    renderScreen()

    const link = await screen.findByRole('link', { name: /Eid mubarak/ })
    expect(link).toHaveAttribute('href', 'https://example.com/eid')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('puts the dot back when marking a row read fails', async () => {
    server.use(
      http.post(apiUrl('/v1/notifications/read'), () => apiError(500, 'internal_error', 'Boom')),
    )
    const user = userEvent.setup()
    const { queryClient } = renderScreen()
    const row = await screen.findByRole('link', { name: /Your photo was approved/ })

    await user.click(row)

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByText('Unread')).toHaveLength(3))
    expect(counter(queryClient)).toBe(3)
  })

  it('loads the next page with "Load more" and stops when there is no cursor', async () => {
    const items = Array.from({ length: 25 }, (_, index) =>
      makeNotification({
        id: `n-${String(index).padStart(2, '0')}`,
        type: 'photo_approved',
        data: {},
        actor: null,
        is_read: true,
        created_at: new Date(Date.UTC(2026, 10, 19, 10, 0, 0) - index * 60_000).toISOString(),
      }),
    )
    seed(items)
    const user = userEvent.setup()
    renderScreen()

    const list = await screen.findByRole('list', { name: 'Notifications' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(20)

    await user.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(25))
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('leaves out rows of a member who was blocked', async () => {
    const blockedId = db.notifications[0]?.actor?.profile_id ?? ''
    db.blocks.push({
      profile_id: blockedId,
      display_name: 'Someone',
      public_code: 'KR1',
      created_at: '2026-11-19T10:00:00Z',
    })
    renderScreen()
    await screen.findByText('Your photo was approved.')
    expect(screen.queryByText(/sent you an interest/)).not.toBeInTheDocument()
  })
})
