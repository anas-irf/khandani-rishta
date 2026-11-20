import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { apiError, apiUrl, noContent } from '~/mocks/http'
import { server } from '~/mocks/server'
import { AnnouncementsScreen } from './AnnouncementsScreen'
import { AuditLogScreen } from './AuditLogScreen'
import { CastesScreen } from './CastesScreen'
import { ReleasesScreen } from './ReleasesScreen'
import { SettingsScreen } from './SettingsScreen'
import { renderAdmin } from './test-utils'

type Call = { params: Record<string, unknown>; body: Record<string, unknown> }

function capture(method: 'post' | 'put' | 'patch', path: string, status = 204) {
  const calls: Call[] = []
  server.use(
    http[method](apiUrl(path), async ({ request, params }) => {
      calls.push({
        params,
        body: (await request.json().catch(() => ({}))) as Record<string, unknown>,
      })
      return status === 204 ? noContent() : new HttpResponse(null, { status })
    }),
  )
  return calls
}

describe('ADM-SETTINGS', () => {
  it('saves a number with its range checked', async () => {
    const save = capture('put', '/v1/admin/settings/:key')
    const user = userEvent.setup()
    renderAdmin(() => <SettingsScreen />, 'admin')

    const input = await screen.findByLabelText('limits.messages_per_minute')
    expect(screen.getByRole('button', { name: 'Save limits.messages_per_minute' })).toBeDisabled()

    await user.clear(input)
    await user.type(input, '500')
    await user.click(screen.getByRole('button', { name: 'Save limits.messages_per_minute' }))
    expect(await screen.findByText('Enter a whole number from 5 to 120.')).toBeInTheDocument()
    expect(save).toHaveLength(0)

    await user.clear(input)
    await user.type(input, '30')
    await user.click(screen.getByRole('button', { name: 'Save limits.messages_per_minute' }))

    await waitFor(() => expect(save).toHaveLength(1))
    expect(save[0]?.params.key).toBe('limits.messages_per_minute')
    expect(save[0]?.body).toEqual({ value: 30 })
  })

  it('warns before a legal document version is saved', async () => {
    const save = capture('put', '/v1/admin/settings/:key')
    const user = userEvent.setup()
    renderAdmin(() => <SettingsScreen />, 'admin')

    const input = await screen.findByLabelText('legal.terms_version')
    await user.clear(input)
    await user.type(input, '2026-12-01')
    await user.click(screen.getByRole('button', { name: 'Save legal.terms_version' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(
      within(dialog).getByText(/Every member will be asked to accept the new document/),
    ).toBeInTheDocument()
    expect(save).toHaveLength(0)
    await user.click(within(dialog).getByRole('button', { name: 'Save anyway' }))

    await waitFor(() => expect(save).toHaveLength(1))
    expect(save[0]?.body).toEqual({ value: '2026-12-01' })
  })

  it('writes the default value on "Reset to default"', async () => {
    const save = capture('put', '/v1/admin/settings/:key')
    const user = userEvent.setup()
    renderAdmin(() => <SettingsScreen />, 'admin')
    await screen.findByLabelText('limits.messages_per_day')

    // The seeded value 500 is the default; change it first so the reset is offered.
    const input = screen.getByLabelText('limits.messages_per_day')
    await user.clear(input)
    await user.type(input, '800')
    await user.click(
      screen.getByRole('button', { name: 'Reset limits.messages_per_day to its default' }),
    )

    await waitFor(() => expect(save).toHaveLength(1))
    expect(save[0]?.body).toEqual({ value: 500 })
  })

  it('is not found for a moderator', async () => {
    renderAdmin(() => <SettingsScreen />, 'moderator')
    expect(
      await screen.findByText('The page you are looking for does not exist.'),
    ).toBeInTheDocument()
  })
})

describe('ADM-CASTES', () => {
  it('lets an admin promote a suggestion with a code, and a moderator only reject it', async () => {
    const promote = capture('post', '/v1/admin/caste-suggestions/:id/promote')
    const user = userEvent.setup()
    const view = renderAdmin(() => <CastesScreen />, 'moderator')

    expect(
      await screen.findByRole('table', { name: 'Caste suggestions, most used first' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Promote/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Reject Kharal/ })).toBeInTheDocument()
    view.unmount()

    renderAdmin(() => <CastesScreen />, 'admin')
    await user.click(await screen.findByRole('button', { name: /^Promote Kharal/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Code')).toHaveValue('kharal')
    await user.click(within(dialog).getByRole('button', { name: 'Promote' }))

    await waitFor(() => expect(promote).toHaveLength(1))
    expect(promote[0]?.body).toEqual({ code: 'kharal', name: 'Kharal' })
  })

  it('refuses a code that is not lowercase letters, digits and underscores', async () => {
    const user = userEvent.setup()
    renderAdmin(() => <CastesScreen />, 'admin')
    await user.click(await screen.findByRole('button', { name: /^Promote Kharal/ }))
    const dialog = await screen.findByRole('dialog')

    await user.clear(within(dialog).getByLabelText('Code'))
    await user.type(within(dialog).getByLabelText('Code'), 'Kharal Rajput')
    await user.click(within(dialog).getByRole('button', { name: 'Promote' }))

    expect(
      await within(dialog).findByText(
        'Use lowercase letters, digits and underscores, starting with a letter.',
      ),
    ).toBeInTheDocument()
  })
})

describe('ADM-RELEASES', () => {
  it('names how many version codes a higher minimum locks out before publishing', async () => {
    const create = capture('post', '/v1/admin/releases', 201)
    const user = userEvent.setup()
    renderAdmin(() => <ReleasesScreen />, 'admin')

    await screen.findByRole('table', { name: 'Android releases, newest first' })
    expect(screen.getByLabelText('Version code')).toHaveValue(13)

    await user.type(screen.getByLabelText('Version name'), '1.4.0')
    const min = screen.getByLabelText('Minimum supported version code')
    await user.clear(min)
    await user.type(min, '11')
    const url = screen.getByLabelText('Download address')
    await user.clear(url)
    await user.type(url, 'https://download.example.com/khandani-rishta-1.4.0.apk')
    await user.click(screen.getByRole('button', { name: 'Publish' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(
      within(dialog).getByText(/2 version codes will be locked out \(9 to 10\)/),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Publish' }))

    await waitFor(() => expect(create).toHaveLength(1))
    expect(create[0]?.body).toEqual({
      platform: 'android',
      version_code: 13,
      version_name: '1.4.0',
      min_supported_version_code: 11,
      download_url: 'https://download.example.com/khandani-rishta-1.4.0.apk',
    })
  })

  it('refuses a download address that does not start with https://download.', async () => {
    const user = userEvent.setup()
    renderAdmin(() => <ReleasesScreen />, 'admin')
    await screen.findByRole('table', { name: 'Android releases, newest first' })

    await user.type(screen.getByLabelText('Version name'), '1.4.0')
    const url = screen.getByLabelText('Download address')
    await user.clear(url)
    await user.type(url, 'https://example.com/app.apk')
    await user.click(screen.getByRole('button', { name: 'Publish' }))

    expect(
      await screen.findByText('The address must start with https://download.'),
    ).toBeInTheDocument()
  })
})

describe('ADM-ANNOUNCE', () => {
  it('sends only after SEND is typed, then reports the recipients', async () => {
    const user = userEvent.setup()
    renderAdmin(() => <AnnouncementsScreen />, 'admin')

    await user.type(await screen.findByLabelText('Text (English)'), 'Eid Mubarak to every family.')
    await user.click(screen.getByRole('button', { name: 'Send announcement' }))

    const dialog = await screen.findByRole('alertdialog')
    const confirm = within(dialog).getByRole('button', { name: 'Send announcement' })
    expect(confirm).toBeDisabled()
    await user.type(within(dialog).getByLabelText('Type SEND to confirm'), 'SEND')
    expect(confirm).toBeEnabled()
    await user.click(confirm)

    expect(
      await screen.findByText('Announcement queued for about 640 members.'),
    ).toBeInTheDocument()
  })

  it('explains the 24 hour limit', async () => {
    const user = userEvent.setup()
    server.use(
      http.post(apiUrl('/v1/admin/announcements'), () =>
        apiError(429, 'limit_reached', 'Too many', {
          details: { limit: 1, used: 1, resets_at: '' },
        }),
      ),
    )
    renderAdmin(() => <AnnouncementsScreen />, 'admin')

    await user.type(await screen.findByLabelText('Text (English)'), 'A second one')
    await user.click(screen.getByRole('button', { name: 'Send announcement' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.type(within(dialog).getByLabelText('Type SEND to confirm'), 'SEND')
    await user.click(within(dialog).getByRole('button', { name: 'Send announcement' }))

    expect(await screen.findByText(/already sent in the last 24 hours/)).toBeInTheDocument()
  })
})

describe('ADM-AUDIT', () => {
  it('lists entries newest first and filters by action', async () => {
    const user = userEvent.setup()
    renderAdmin(() => <AuditLogScreen />, 'admin')

    const table = await screen.findByRole('table', { name: 'Audit log entries' })
    expect(within(table).getByText('profile.approve')).toBeInTheDocument()
    expect(within(table).getByText('setting.update')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Action'), 'setting.update')

    // A new filter is a new query: the table is rebuilt once its answer arrives.
    await waitFor(() => {
      const filtered = screen.getByRole('table', { name: 'Audit log entries' })
      expect(within(filtered).queryByText('profile.approve')).not.toBeInTheDocument()
      expect(within(filtered).getByText('setting.update')).toBeInTheDocument()
    })
  })
})
