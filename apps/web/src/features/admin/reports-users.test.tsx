import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'
import { apiUrl, noContent } from '~/mocks/http'
import { server } from '~/mocks/server'
import { ReportScreen } from './ReportScreen'
import { ids, renderAdmin } from './test-utils'
import { UserScreen } from './UserScreen'
import { UsersScreen } from './UsersScreen'

function capture(path: string) {
  const calls: { params: Record<string, unknown>; body: Record<string, unknown> }[] = []
  server.use(
    http.post(apiUrl(path), async ({ request, params }) => {
      calls.push({
        params,
        body: (await request.json().catch(() => ({}))) as Record<string, unknown>,
      })
      return noContent()
    }),
  )
  return calls
}

describe('ADM-REPORT', () => {
  const path = `/admin/reports/${ids.report(1)}`

  it('shows the message report as a transcript with the reported message marked', async () => {
    renderAdmin(() => <ReportScreen />, 'moderator', path)

    const transcript = await screen.findByRole('list', { name: 'Messages around the reported one' })
    expect(within(transcript).getAllByText('Reporter').length).toBeGreaterThan(0)
    expect(within(transcript).getAllByText('Reported member').length).toBeGreaterThan(0)
    expect(within(transcript).getByText('Reported message')).toBeInTheDocument()
    expect(within(transcript).getByText('Deleted message')).toBeInTheDocument()
  })

  it('is claimed, then resolved with an outcome and a note', async () => {
    const resolve = capture('/v1/admin/reports/:reportId/resolve')
    const user = userEvent.setup()
    renderAdmin(() => <ReportScreen />, 'moderator', path)

    const claim = await screen.findByRole('button', { name: /^Claim/ })
    expect(screen.getByRole('button', { name: /^Sanction/ })).toBeDisabled()
    await user.click(claim)
    await waitFor(() => expect(screen.getByRole('button', { name: /^Sanction/ })).toBeEnabled())

    await user.click(screen.getByRole('button', { name: /^Resolve/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('radio', { name: /Dismissed/ }))
    await user.type(within(dialog).getByLabelText('Resolution note (staff only)'), 'Short')
    await user.click(within(dialog).getByRole('button', { name: 'Resolve' }))
    expect(await within(dialog).findByText('Write at least 10 characters.')).toBeInTheDocument()

    await user.type(
      within(dialog).getByLabelText('Resolution note (staff only)'),
      ' - no violation found in the messages',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Resolve' }))

    await waitFor(() => expect(resolve).toHaveLength(1))
    expect(resolve[0]?.body).toEqual({
      outcome: 'dismissed',
      note: 'Short - no violation found in the messages',
    })
  })

  it('asks for confirmation before resolving as actioned with no recorded action', async () => {
    const resolve = capture('/v1/admin/reports/:reportId/resolve')
    const user = userEvent.setup()
    renderAdmin(() => <ReportScreen />, 'moderator', path)
    await user.click(await screen.findByRole('button', { name: /^Claim/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: /^Resolve/ })).toBeEnabled())
    await waitFor(() => expect(screen.getByRole('button', { name: /^Sanction/ })).toBeEnabled())

    await user.keyboard('x')
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('radio', { name: /Actioned/ }))
    await user.type(
      within(dialog).getByLabelText('Resolution note (staff only)'),
      'Confirmed by reading the chat',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Resolve' }))

    expect(
      await within(dialog).findByText(
        'No action is recorded for this report. Resolve as actioned anyway?',
      ),
    ).toBeInTheDocument()
    expect(resolve).toHaveLength(0)
    await user.click(within(dialog).getByRole('button', { name: 'Resolve as actioned' }))

    await waitFor(() => expect(resolve).toHaveLength(1))
    expect(resolve[0]?.body.outcome).toBe('actioned')
  })
})

describe('ADM-USER', () => {
  const path = `/admin/users/${ids.user(3)}`

  it('suspends for a number of days with a reason the member will see', async () => {
    const suspend = capture('/v1/admin/users/:userId/suspend')
    const user = userEvent.setup()
    renderAdmin(() => <UserScreen />, 'moderator', path)

    await user.click(await screen.findByRole('button', { name: 'Suspend' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: '7 days' }))
    expect(within(dialog).getByLabelText('Days of suspension')).toHaveValue(7)
    await user.click(within(dialog).getByRole('button', { name: 'Suspend' }))
    expect(await within(dialog).findByText('This field is required.')).toBeInTheDocument()

    await user.type(
      within(dialog).getByLabelText('Reason (the member will see this)'),
      'You continued to contact a member after they asked you to stop.',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Suspend' }))

    await waitFor(() => expect(suspend).toHaveLength(1))
    expect(suspend[0]?.params.userId).toBe(ids.user(3))
    expect(suspend[0]?.body).toEqual({
      reason: 'You continued to contact a member after they asked you to stop.',
      days: 7,
    })
  })

  it('hides ban and role change from a moderator and shows them to an admin', async () => {
    const view = renderAdmin(() => <UserScreen />, 'moderator', path)
    await screen.findByRole('button', { name: 'Suspend' })
    expect(screen.queryByRole('button', { name: 'Ban' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Change role' })).not.toBeInTheDocument()
    // Moderators never see a phone number.
    expect(screen.getByText('Not shown to moderators')).toBeInTheDocument()
    view.unmount()

    renderAdmin(() => <UserScreen />, 'admin', path)
    expect(await screen.findByRole('button', { name: 'Ban' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change role' })).toBeInTheDocument()
  })

  it('requires the profile code to be typed before a ban', async () => {
    const ban = capture('/v1/admin/users/:userId/ban')
    const user = userEvent.setup()
    renderAdmin(() => <UserScreen />, 'admin', path)

    await user.click(await screen.findByRole('button', { name: 'Ban' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(
      within(dialog).getByLabelText('Reason (the member will see this)'),
      'Fraud attempt',
    )
    const submit = within(dialog).getByRole('button', { name: 'Ban' })
    expect(submit).toBeDisabled()

    // The mock gives the third member the code KR + (2000 + 2 * 13) in base 36.
    const code = `KR${(2026).toString(36).toUpperCase()}`
    await user.type(within(dialog).getByLabelText(/Type the profile code/), code)
    expect(submit).toBeEnabled()
    await user.click(submit)

    await waitFor(() => expect(ban).toHaveLength(1))
    expect(ban[0]?.body).toEqual({ reason: 'Fraud attempt' })
  })
})

/** A page of the users list with `total` accounts, as the API sends it. */
function usersPage(page: number, total: number, pageSize = 25) {
  const from = (page - 1) * pageSize
  const items = Array.from({ length: Math.max(0, Math.min(pageSize, total - from)) }, (_, i) => {
    const n = from + i + 1
    return {
      user_id: `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`,
      profile_id: `00000000-0000-7000-9000-${String(n).padStart(12, '0')}`,
      public_code: `KR-${String(n).padStart(5, '0')}`,
      email: `member${n}@example.com`,
      role: 'member',
      status: 'active',
      profile_status: 'active',
      first_name: `Member${n}`,
      last_name: 'Test',
      gender: 'female',
      created_at: '2026-11-01T10:00:00Z',
      last_seen_at: null,
    }
  })
  return { items, total, page, page_size: pageSize }
}

describe('ADM-USERS', () => {
  it('lists every account without a search, on one page when they fit', async () => {
    renderAdmin(() => <UsersScreen />)

    const table = await screen.findByRole('table', { name: 'Accounts' })
    expect(within(table).getAllByRole('row').length).toBeGreaterThan(5)
    expect(screen.getByText(/^Showing 1 to \d+ of \d+ accounts$/)).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Pages' })).not.toBeInTheDocument()
  })

  it('pages through a long list with numbered page links', async () => {
    const pages: string[] = []
    server.use(
      http.get(apiUrl('/v1/admin/users'), ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page') ?? '1')
        pages.push(String(page))
        return Response.json(usersPage(page, 60))
      }),
    )
    const user = userEvent.setup()
    renderAdmin(() => <UsersScreen />)

    expect(await screen.findByText('Showing 1 to 25 of 60 accounts')).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Pages' })
    expect(within(nav).getByRole('button', { name: 'Page 1' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(nav).getByRole('button', { name: 'Previous' })).toBeDisabled()

    await user.click(within(nav).getByRole('button', { name: 'Page 2' }))
    expect(await screen.findByText('Showing 26 to 50 of 60 accounts')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'member26@example.com' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Showing 51 to 60 of 60 accounts')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(pages).toEqual(['1', '2', '3'])
  })

  it('refuses a search of fewer than 3 characters', async () => {
    const user = userEvent.setup()
    renderAdmin(() => <UsersScreen />)

    await user.type(await screen.findByLabelText('Search'), 'ay')
    await user.click(screen.getByRole('button', { name: 'Search' }))

    expect(await screen.findByText('Enter at least 3 characters.')).toBeInTheDocument()
  })

  it('lists the accounts that match the search in the address', async () => {
    renderAdmin(() => <UsersScreen />, 'moderator', '/admin/users?q=ayesha')

    const table = await screen.findByRole('table', { name: 'Accounts' })
    expect(within(table).getByRole('link', { name: 'ayesha.khan@example.com' })).toBeInTheDocument()
    expect(within(table).getAllByRole('columnheader').length).toBeGreaterThan(3)
  })
})
