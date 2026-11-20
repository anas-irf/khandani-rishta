import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http } from 'msw'
import { describe, expect, it } from 'vitest'
import type { Me, PhotoAccessEntry } from '~/lib/api-types'
import { useMe } from '~/lib/me'
import { qk } from '~/lib/query'
import { db, resetDb } from '~/mocks/db'
import { apiError, apiUrl } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderWithProviders } from '~/test/render'
import { PhotoRequestsScreen } from './PhotoRequestsScreen'

/** AuthGate keeps `['me']` observed in the app; the tests need the same to see counters refetch. */
function KeepMeFresh() {
  useMe()
  return null
}

function renderScreen(path = '/photo-requests?box=received') {
  return renderWithProviders(
    () => (
      <>
        <KeepMeFresh />
        <PhotoRequestsScreen />
      </>
    ),
    {
      path,
      me: structuredClone(db.me),
    },
  )
}

function pendingCounter(queryClient: ReturnType<typeof renderScreen>['queryClient']) {
  return queryClient.getQueryData<Me>(qk.me())?.counters.pending_photo_requests
}

function entry(overrides: Partial<PhotoAccessEntry> = {}): PhotoAccessEntry {
  const profile = [...db.profiles.values()][8]
  return {
    id: `req-${Math.random().toString(16).slice(2)}`,
    profile_id: profile?.card.id ?? 'p-x',
    status: 'pending',
    created_at: '2026-11-17T12:00:00Z',
    profile: profile?.card ?? null,
    ...overrides,
  }
}

describe('PhotoRequestsScreen (APP-PHOTO-REQUESTS)', () => {
  it('shows the requests waiting for an answer, with the badge on the Received tab', async () => {
    renderScreen()

    expect(await screen.findByRole('tab', { name: /Received/, selected: true })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Sent' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Received/ })).toHaveTextContent('1 new')

    const list = await screen.findByRole('list', { name: 'Received photo requests' })
    const item = within(list).getByRole('listitem')
    expect(within(item).getByRole('link', { name: /, \d+$/ })).toBeInTheDocument()
    expect(within(item).getByText(/^Asked /)).toBeInTheDocument()
    expect(within(item).getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(within(item).getByRole('button', { name: 'Not now' })).toBeInTheDocument()
  })

  it('shows a skeleton while loading', async () => {
    server.use(
      http.get(apiUrl('/v1/me/photo-access'), async () => {
        await delay(150)
      }),
    )
    const { container } = renderScreen()
    expect(await screen.findByText('Loading')).toBeInTheDocument()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    await screen.findByRole('button', { name: 'Approve' })
  })

  it('shows the empty copy of each list', async () => {
    db.photoAccess.received = []
    const user = userEvent.setup()
    renderScreen()

    expect(await screen.findByText('No one is waiting for an answer.')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Approved' }))
    expect(await screen.findByText('Members you approve appear here.')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Sent' }))
    expect(
      await screen.findByText("You have not asked to see anyone's photos."),
    ).toBeInTheDocument()
  })

  it('shows the error state and retries', async () => {
    let failing = true
    server.use(
      http.get(apiUrl('/v1/me/photo-access'), () => {
        if (failing) return apiError(500, 'internal_error', 'Boom')
        return undefined
      }),
    )
    const user = userEvent.setup()
    renderScreen()

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
    failing = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument()
  })

  it('approves a request: it moves to Approved and the member is told by a toast', async () => {
    const user = userEvent.setup()
    const { queryClient } = renderScreen()
    const requesterName = db.photoAccess.received[0]?.profile?.display_name ?? ''

    await user.click(await screen.findByRole('button', { name: 'Approve' }))

    expect(await screen.findByText(`${requesterName} can now see your photos.`)).toBeInTheDocument()
    await waitFor(() => expect(db.photoAccess.received[0]?.status).toBe('granted'))
    await waitFor(() =>
      expect(screen.getByText('No one is waiting for an answer.')).toBeInTheDocument(),
    )
    await waitFor(() => expect(pendingCounter(queryClient)).toBe(0))

    await user.click(screen.getByRole('radio', { name: 'Approved' }))
    const list = await screen.findByRole('list', { name: 'Received photo requests' })
    expect(within(list).getByRole('button', { name: 'Remove access' })).toBeInTheDocument()
  })

  it('answers "Not now" without telling anyone: the item leaves the list', async () => {
    const user = userEvent.setup()
    renderScreen()

    await user.click(await screen.findByRole('button', { name: 'Not now' }))

    await waitFor(() => expect(db.photoAccess.received[0]?.status).toBe('denied'))
    expect(await screen.findByText('No one is waiting for an answer.')).toBeInTheDocument()
    expect(db.notifications.some((item) => item.type === 'photo_request_granted')).toBe(false)
  })

  it('refetches without a toast when the request was already answered (invalid_state)', async () => {
    const user = userEvent.setup()
    renderScreen()
    const button = await screen.findByRole('button', { name: 'Approve' })
    // Answered on another device meanwhile.
    const stored = db.photoAccess.received[0]
    if (stored) stored.status = 'denied'

    await user.click(button)

    expect(await screen.findByText('No one is waiting for an answer.')).toBeInTheDocument()
    expect(screen.queryByText(/can now see your photos/)).not.toBeInTheDocument()
    expect(
      screen.queryByText('This can no longer be done. Please refresh and try again.'),
    ).not.toBeInTheDocument()
  })

  it('refetches without a toast when the request no longer exists (not_found)', async () => {
    const user = userEvent.setup()
    renderScreen()
    const button = await screen.findByRole('button', { name: 'Not now' })
    db.photoAccess.received = []

    await user.click(button)

    expect(await screen.findByText('No one is waiting for an answer.')).toBeInTheDocument()
    expect(screen.queryByText('This is no longer available.')).not.toBeInTheDocument()
  })

  it('removes access after a confirmation', async () => {
    db.photoAccess.received = [entry({ id: 'r-1', status: 'granted' })]
    const granted = db.photoAccess.received[0]
    const user = userEvent.setup()
    renderScreen()

    await user.click(await screen.findByRole('radio', { name: 'Approved' }))
    await user.click(await screen.findByRole('button', { name: 'Remove access' }))

    const dialog = await screen.findByRole('alertdialog')
    const name = granted?.profile?.display_name ?? ''
    expect(within(dialog).getByText(`Stop ${name} from seeing your photos?`)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Remove access' }))

    expect(await screen.findByText('Access removed.')).toBeInTheDocument()
    await waitFor(() => expect(granted?.status).toBe('revoked'))
    expect(await screen.findByText('Members you approve appear here.')).toBeInTheDocument()
  })

  it('keeps the access when the confirmation is cancelled', async () => {
    db.photoAccess.received = [entry({ id: 'r-1', status: 'granted' })]
    const user = userEvent.setup()
    renderScreen()

    await user.click(await screen.findByRole('radio', { name: 'Approved' }))
    await user.click(await screen.findByRole('button', { name: 'Remove access' }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }),
    )

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(db.photoAccess.received[0]?.status).toBe('granted')
  })

  it('can revoke the access of a member who is no longer available, by profile id', async () => {
    db.photoAccess.received = [
      entry({ id: 'r-gone', profile_id: 'gone-profile', status: 'granted', profile: null }),
    ]
    const user = userEvent.setup()
    renderScreen()

    await user.click(await screen.findByRole('radio', { name: 'Approved' }))
    expect(await screen.findByText('This member is no longer available')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove access' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(
      within(dialog).getByText('Stop This member from seeing your photos?'),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Remove access' }))

    await waitFor(() => expect(db.photoAccess.received[0]?.status).toBe('revoked'))
    expect(await screen.findByText('Access removed.')).toBeInTheDocument()
  })

  it('lists the sent requests with their status: waiting first, then approved', async () => {
    db.photoAccess.sent = [
      entry({ id: 's-1', status: 'granted', created_at: '2026-11-10T10:00:00Z' }),
      entry({
        id: 's-2',
        status: 'pending',
        profile_id: [...db.profiles.keys()][9] ?? 'x',
        profile: [...db.profiles.values()][9]?.card ?? null,
        created_at: '2026-11-18T10:00:00Z',
      }),
    ]
    const user = userEvent.setup()
    renderScreen('/photo-requests?box=sent')

    const list = await screen.findByRole('list', { name: 'Sent photo requests' })
    const items = Array.from(list.children)
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Waiting')
    expect(items[1]).toHaveTextContent('Approved')
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Sent', selected: true })).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /Received/ }))
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /Received/, selected: true })).toBeInTheDocument(),
    )
  })

  it('opens the profile when the card is tapped', async () => {
    renderScreen()
    const link = await screen.findByRole('link', { name: /,\s*\d+/ })
    expect(link.getAttribute('href')).toMatch(/^\/profiles\//)
  })

  it('writes the chosen tab to the URL', async () => {
    const user = userEvent.setup()
    const { router } = renderScreen()

    await user.click(await screen.findByRole('tab', { name: 'Sent' }))

    await waitFor(() => expect(router.state.location.search).toMatchObject({ box: 'sent' }))
  })

  it('shows the status panel instead of the list when the profile is closed', async () => {
    resetDb('closed')
    renderScreen()
    expect(await screen.findByText('The profile is closed')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Sent' })).not.toBeInTheDocument()
  })
})
