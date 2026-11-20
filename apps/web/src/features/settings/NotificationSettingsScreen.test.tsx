import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http } from 'msw'
import { describe, expect, it } from 'vitest'
import type { NotificationPreferences } from '~/lib/api-types'
import { db } from '~/mocks/db'
import { apiError, apiUrl, readJson } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderWithProviders } from '~/test/render'
import { NotificationSettingsScreen } from './NotificationSettingsScreen'

function renderScreen() {
  return renderWithProviders(() => <NotificationSettingsScreen />, {
    path: '/settings/notifications',
    me: structuredClone(db.me),
  })
}

/** Records the bodies of `PUT /v1/me/notification-preferences`; the mock API still answers. */
function recordPuts() {
  const bodies: NotificationPreferences[] = []
  server.use(
    http.put(apiUrl('/v1/me/notification-preferences'), async ({ request }) => {
      bodies.push(await readJson<NotificationPreferences>(request.clone()))
      return undefined
    }),
  )
  return bodies
}

const SAVED = { timeout: 4000 }

describe('NotificationSettingsScreen (SET-NOTIFS)', () => {
  it('shows skeleton rows while loading', async () => {
    server.use(
      http.get(apiUrl('/v1/me/notification-preferences'), async () => {
        await delay(150)
      }),
    )
    const { container } = renderScreen()
    expect(await screen.findByText('Loading')).toBeInTheDocument()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    await screen.findByText('Push notifications')
  })

  it('shows the error state and retries', async () => {
    let failing = true
    server.use(
      http.get(apiUrl('/v1/me/notification-preferences'), () => {
        if (failing) return apiError(500, 'internal_error', 'Boom')
        return undefined
      }),
    )
    const user = userEvent.setup()
    renderScreen()

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
    failing = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Push notifications')).toBeInTheDocument()
  })

  it('shows every preference of 14 section 6.1 with its saved value', async () => {
    renderScreen()
    await screen.findByRole('heading', { name: 'Push notifications' })

    expect(
      screen.getByText(
        'These switches only control push notifications and emails. Everything still appears in the app.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Push notifications are available in the Android app.'),
    ).toBeInTheDocument()

    const push = screen.getByRole('heading', { name: 'Push notifications' }).closest('section')
    if (!push) throw new Error('push group missing')
    expect(within(push).getByRole('switch', { name: 'Interests' })).toBeChecked()
    expect(
      within(push).getByRole('switch', { name: 'Messages and connection updates' }),
    ).toBeChecked()
    expect(within(push).getByRole('switch', { name: 'Photo requests' })).toBeChecked()
    expect(within(push).getByRole('switch', { name: 'New matches' })).toBeChecked()
    expect(within(push).getByRole('switch', { name: 'Profile views' })).not.toBeChecked()

    const email = screen.getByRole('heading', { name: 'Email' }).closest('section')
    if (!email) throw new Error('email group missing')
    expect(within(email).getByRole('switch', { name: 'Interests' })).toBeChecked()
    expect(within(email).getByRole('switch', { name: 'Unread messages' })).not.toBeChecked()
    expect(within(email).getByLabelText('Match digest')).toHaveValue('weekly')
    expect(within(email).getByRole('switch', { name: 'News and announcements' })).toBeChecked()
    expect(
      within(email).getByText('Messages about your account and safety are always sent.'),
    ).toBeInTheDocument()

    const options = within(within(email).getByLabelText('Match digest')).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual(['Off', 'Daily', 'Weekly'])

    expect(screen.getByRole('switch', { name: 'Quiet hours' })).not.toBeChecked()
    expect(screen.queryByLabelText('From')).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'No push notifications are sent between these times. They arrive when the quiet hours end, and they are always in the app.',
      ),
    ).toBeInTheDocument()
  })

  it('shows a change at once and sends the complete object once, after 500 ms without further changes', async () => {
    const bodies = recordPuts()
    const user = userEvent.setup()
    renderScreen()
    const push = (await screen.findByRole('heading', { name: 'Push notifications' })).closest(
      'section',
    )
    if (!push) throw new Error('push group missing')

    await user.click(within(push).getByRole('switch', { name: 'Profile views' }))
    await user.click(within(push).getByRole('switch', { name: 'Interests' }))

    // Shown before anything is sent.
    expect(within(push).getByRole('switch', { name: 'Profile views' })).toBeChecked()
    expect(within(push).getByRole('switch', { name: 'Interests' })).not.toBeChecked()
    expect(bodies).toEqual([])

    await waitFor(() => expect(bodies).toHaveLength(1), SAVED)
    expect(bodies[0]).toEqual({
      ...db.notificationPreferences,
      push_profile_views: true,
      push_interests: false,
    })
    expect(Object.keys(bodies[0] ?? {})).toEqual(
      expect.arrayContaining([
        'push_interests',
        'push_messages',
        'push_photo_requests',
        'push_profile_views',
        'push_matches',
        'email_interests',
        'email_messages',
        'email_match_digest',
        'email_announcements',
        'quiet_hours_start',
        'quiet_hours_end',
      ]),
    )
    await waitFor(() => expect(db.notificationPreferences.push_profile_views).toBe(true), SAVED)
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('saves the email match digest choice', async () => {
    const bodies = recordPuts()
    const user = userEvent.setup()
    renderScreen()

    await user.selectOptions(await screen.findByLabelText('Match digest'), 'daily')

    await waitFor(() => expect(bodies).toHaveLength(1), SAVED)
    expect(bodies[0]?.email_match_digest).toBe('daily')
    expect(screen.getByLabelText('Match digest')).toHaveValue('daily')
  })

  it('turns quiet hours on with 22:00 and 07:00, and off with both empty', async () => {
    const bodies = recordPuts()
    const user = userEvent.setup()
    renderScreen()

    await user.click(await screen.findByRole('switch', { name: 'Quiet hours' }))

    expect(screen.getByLabelText('From')).toHaveValue('22:00')
    expect(screen.getByLabelText('To')).toHaveValue('07:00')
    await waitFor(() => expect(bodies).toHaveLength(1), SAVED)
    expect(bodies[0]).toMatchObject({ quiet_hours_start: '22:00', quiet_hours_end: '07:00' })

    await user.click(screen.getByRole('switch', { name: 'Quiet hours' }))
    expect(screen.queryByLabelText('From')).not.toBeInTheDocument()
    await waitFor(() => expect(bodies).toHaveLength(2), SAVED)
    expect(bodies[1]).toMatchObject({ quiet_hours_start: null, quiet_hours_end: null })
  })

  it('changes one quiet hours time and keeps the pair complete', async () => {
    db.notificationPreferences = {
      ...db.notificationPreferences,
      quiet_hours_start: '23:00:00',
      quiet_hours_end: '07:00:00',
    }
    const bodies = recordPuts()
    renderScreen()

    const from = await screen.findByLabelText('From')
    expect(from).toHaveValue('23:00')
    expect(screen.getByLabelText('To')).toHaveValue('07:00')
    fireEvent.change(from, { target: { value: '' } })
    // Cleared: nothing changes, so the pair never ends up half set.
    expect(from).toHaveValue('23:00')

    fireEvent.change(screen.getByLabelText('To'), { target: { value: '06:30' } })

    await waitFor(() => expect(bodies).toHaveLength(1), SAVED)
    // The untouched time goes back exactly as the server sent it.
    expect(bodies[0]).toMatchObject({ quiet_hours_start: '23:00:00', quiet_hours_end: '06:30' })
  })

  it('goes back to the saved values and shows a toast when saving fails', async () => {
    server.use(
      http.put(apiUrl('/v1/me/notification-preferences'), () =>
        apiError(500, 'internal_error', 'Boom'),
      ),
    )
    const user = userEvent.setup()
    renderScreen()
    const toggle = await screen.findByRole('switch', { name: 'News and announcements' })

    await user.click(toggle)
    expect(toggle).not.toBeChecked()

    expect(
      await screen.findByText('Could not save. Please try again.', {}, SAVED),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'News and announcements' })).toBeChecked(),
    )
    expect(db.notificationPreferences.email_announcements).toBe(true)
  })
})
