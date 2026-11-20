import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { apiError, apiUrl } from '~/mocks/http'
import { server } from '~/mocks/server'
import { AdminLayout } from './AdminLayout'
import { OverviewScreen } from './OverviewScreen'
import { ProfilesScreen } from './ProfilesScreen'
import { ReportsScreen } from './ReportsScreen'
import { renderAdmin } from './test-utils'
import { VerificationsScreen } from './VerificationsScreen'

const emptyPage = () => HttpResponse.json({ items: [], next_cursor: null })

describe('ADM-HOME', () => {
  it('shows the queues and flags a queue that waited longer than 24 hours', async () => {
    renderAdmin(() => <OverviewScreen />)

    const queues = await screen.findByRole('heading', { name: 'Queues' })
    expect(queues).toBeInTheDocument()
    const profiles = screen.getByRole('link', { name: /Profiles to review/ })
    expect(profiles).toHaveAttribute('href', '/admin/profiles')
    expect(within(profiles).getByText('8')).toBeInTheDocument()
    expect(within(profiles).getByText('Waiting longer than 24 hours')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Photos to review/ })).toHaveTextContent(
      '2 flagged by the automatic check',
    )
  })

  it('shows dead background jobs as an alert', async () => {
    server.use(
      http.get(apiUrl('/v1/admin/overview'), () =>
        HttpResponse.json({
          generated_at: new Date().toISOString(),
          queues: {
            profiles_pending: 0,
            photos_pending: 0,
            photos_flagged: 0,
            texts_pending: 0,
            verifications_pending: 0,
            reports_open: 0,
            reports_in_review: 0,
            caste_suggestions_pending: 0,
            oldest_waiting: { profiles: null, photos: null, verifications: null, reports: null },
          },
          metrics: {
            users_total: 10,
            signups_today: 1,
            signups_7d: 2,
            profiles_by_status: {
              draft: 0,
              pending_review: 0,
              changes_requested: 0,
              active: 1,
              paused: 0,
              closed: 0,
              suspended: 0,
            },
            active_male: 1,
            active_female: 0,
            active_id_verified: 0,
            active_photo_verified: 0,
            active_last_7d: 1,
            interests_sent_today: 0,
            interests_sent_7d: 0,
            interests_accepted_7d: 0,
            connections_active: 0,
            connections_created_7d: 0,
            stage_counts: { chatting: 0, families_talking: 0, engaged: 0, nikah_done: 0 },
            messages_7d: 0,
            reports_filed_7d: 0,
            users_suspended: 0,
            users_banned: 0,
            deletions_scheduled: 0,
            jobs_dead: 3,
          },
        }),
      ),
    )
    renderAdmin(() => <OverviewScreen />)

    expect(
      await screen.findByText('A background job failed permanently and needs a developer.'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('jobs-dead')).toHaveTextContent('3')
  })
})

describe('list screens', () => {
  it('ADM-PROFILES: a captioned table with column headers, oldest waiting first', async () => {
    renderAdmin(() => <ProfilesScreen />)

    const table = await screen.findByRole('table', { name: 'Profiles' })
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toContain('Waiting since')
    const links = within(table).getAllByRole('link')
    expect(links).toHaveLength(8)
    // The member who completed onboarding longest ago is first.
    expect(links[0]).toHaveTextContent('Ayesha Khan')
  })

  it('shows "Nothing waiting. Well done." for an empty queue', async () => {
    server.use(http.get(apiUrl('/v1/admin/verifications'), emptyPage))
    renderAdmin(() => <VerificationsScreen />)
    expect(await screen.findByText('Nothing waiting. Well done.')).toBeInTheDocument()
  })

  it('shows an error state with a retry that loads the list', async () => {
    let fail = true
    server.use(
      http.get(apiUrl('/v1/admin/reports'), ({ request }) =>
        fail
          ? apiError(500, 'internal_error', 'Boom')
          : HttpResponse.json({ items: [], next_cursor: null, ...{ url: request.url } }),
      ),
    )
    const user = userEvent.setup()
    renderAdmin(() => <ReportsScreen />)

    const retry = await screen.findByRole('button', { name: 'Try again' })
    fail = false
    await user.click(retry)

    expect(await screen.findByText('Nothing waiting. Well done.')).toBeInTheDocument()
  })

  it('ADM-REPORTS: priority first, then the oldest', async () => {
    renderAdmin(() => <ReportsScreen />)
    const table = await screen.findByRole('table', { name: 'Reports' })
    const firstRow = within(table).getAllByRole('row')[1]
    // The system report (priority 1) comes before the priority 2 and 3 reports.
    expect(firstRow).toHaveTextContent('Priority 1')
  })

  it('loads more rows with the cursor of the last page', async () => {
    const user = userEvent.setup()
    server.use(
      http.get(apiUrl('/v1/admin/profiles'), ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor')
        const item = (n: number) => ({
          profile_id: `p${n}`,
          user_id: `u${n}`,
          public_code: `KR00${n}`,
          status: 'pending_review',
          first_name: `Member${n}`,
          last_name: null,
          gender: 'male',
          age: 30,
          city_name: 'Lahore',
          managed_by: 'self',
          onboarding_completed_at: null,
          photo_thumb_url: null,
          open_system_reports: 0,
          created_at: '2026-11-01T00:00:00Z',
        })
        return cursor
          ? HttpResponse.json({ items: [item(2)], next_cursor: null })
          : HttpResponse.json({ items: [item(1)], next_cursor: 'next' })
      }),
    )
    renderAdmin(() => <ProfilesScreen />)
    await user.click(await screen.findByRole('button', { name: 'Load more' }))

    expect(await screen.findByRole('link', { name: /Member2/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Member1/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })
})

describe('keyboard shortcuts', () => {
  it('J and K move between the rows of a queue', async () => {
    const user = userEvent.setup()
    renderAdmin(() => <ProfilesScreen />)
    const table = await screen.findByRole('table', { name: 'Profiles' })
    const links = within(table).getAllByRole('link')

    await user.keyboard('j')
    expect(links[0]).toHaveFocus()
    await user.keyboard('j')
    expect(links[1]).toHaveFocus()
    await user.keyboard('k')
    expect(links[0]).toHaveFocus()
  })

  it('does not act while a text field has focus', async () => {
    const user = userEvent.setup()
    renderAdmin(() => <ProfilesScreen />)
    const table = await screen.findByRole('table', { name: 'Profiles' })

    await user.click(screen.getByRole('searchbox', { name: 'Search' }))
    await user.keyboard('jjj')

    for (const link of within(table).getAllByRole('link')) expect(link).not.toHaveFocus()
  })

  it('? opens the shortcut list', async () => {
    const user = userEvent.setup()
    renderAdmin(() => <AdminLayout />)
    await screen.findByRole('navigation', { name: 'Staff console sections' })

    await user.keyboard('?')

    const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })
    expect(within(dialog).getByText('Next item of a queue')).toBeInTheDocument()
    expect(within(dialog).getAllByRole('button', { name: 'Close' })).not.toHaveLength(0)
  })
})
