import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GlobalDialogs } from '~/components/common/GlobalDialogs'
import type { DataExport, Me } from '~/lib/api-types'
import { closeLimitDialog } from '~/lib/dialogs'
import { useMe } from '~/lib/me'
import { qk } from '~/lib/query'
import { db, type MockScenario, resetDb } from '~/mocks/db'
import { apiError, apiUrl, readJson } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderWithProviders } from '~/test/render'
import { AccountScreen } from './AccountScreen'

function KeepMeFresh() {
  useMe()
  return null
}

function renderAccount(scenario: MockScenario = 'active') {
  resetDb(scenario)
  return renderWithProviders(
    () => (
      <>
        <KeepMeFresh />
        <GlobalDialogs />
        <AccountScreen />
      </>
    ),
    { path: '/settings/account', me: structuredClone(db.me) },
  )
}

async function dataGroup() {
  return within(await screen.findByRole('region', { name: 'Your data' }))
}

function latestExport(value: DataExport | 'none') {
  server.use(
    http.get(apiUrl('/v1/me/exports/latest'), () =>
      value === 'none'
        ? apiError(404, 'not_found', 'No export')
        : new Response(JSON.stringify(value), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
    ),
  )
}

afterEach(() => {
  closeLimitDialog()
  vi.useRealTimers()
})

describe('SET-ACCOUNT: your data (16 section 6.27)', () => {
  it('offers to download when there is no export yet (404)', async () => {
    renderAccount()
    const card = await dataGroup()
    expect(
      await card.findByText('Get a copy of everything stored about you as a file.'),
    ).toBeInTheDocument()
    expect(card.getByRole('button', { name: 'Download my data' })).toBeInTheDocument()
  })

  it('requests an export and then shows that the file is being prepared', async () => {
    const user = userEvent.setup()
    renderAccount()
    const card = await dataGroup()

    await user.click(await card.findByRole('button', { name: 'Download my data' }))

    expect(
      await card.findByText(
        'Your file is being prepared. This can take a few minutes. We will email you when it is ready.',
      ),
    ).toBeInTheDocument()
    expect(card.queryByRole('button')).not.toBeInTheDocument()
    expect(db.extra.exportRequestedAt).toBeTypeOf('number')
  })

  it('refetches every 15 seconds while the file is queued', async () => {
    let calls = 0
    server.use(
      http.get(apiUrl('/v1/me/exports/latest'), () => {
        calls += 1
        return Response.json({ status: 'queued', download_url: null, expires_at: null })
      }),
    )
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    renderAccount()
    const card = await dataGroup()
    await card.findByText(/^Your file is being prepared/)
    const before = calls

    await vi.advanceTimersByTimeAsync(15_000)

    await waitFor(() => expect(calls).toBeGreaterThan(before))
  })

  it('shows when a ready file expires, with a download link and a way to ask for a new one', async () => {
    latestExport({
      status: 'ready',
      download_url: 'https://files.example.com/export.json',
      expires_at: '2026-11-27T10:00:00Z',
    })
    const user = userEvent.setup()
    renderAccount()
    const card = await dataGroup()

    expect(await card.findByText('Your file is ready until 27 Nov 2026.')).toBeInTheDocument()
    const download = card.getByRole('link', { name: 'Download' })
    expect(download).toHaveAttribute('href', 'https://files.example.com/export.json')
    expect(download).toHaveAttribute('target', '_blank')
    expect(download).toHaveAttribute('rel', 'noopener noreferrer')

    await user.click(card.getByRole('button', { name: 'Request a new file' }))
    expect(await card.findByText(/^Your file is being prepared/)).toBeInTheDocument()
  })

  it('offers "Try again" when the file could not be prepared', async () => {
    latestExport({ status: 'failed', download_url: null, expires_at: null })
    const user = userEvent.setup()
    renderAccount()
    const card = await dataGroup()

    expect(await card.findByText('The file could not be prepared.')).toBeInTheDocument()
    await user.click(card.getByRole('button', { name: 'Try again' }))
    expect(await card.findByText(/^Your file is being prepared/)).toBeInTheDocument()
  })

  it('says the previous file has expired and offers a new download', async () => {
    latestExport({ status: 'expired', download_url: null, expires_at: '2026-11-01T10:00:00Z' })
    renderAccount()
    const card = await dataGroup()

    expect(await card.findByText('The previous file has expired.')).toBeInTheDocument()
    expect(card.getByRole('button', { name: 'Download my data' })).toBeInTheDocument()
  })

  it('explains the 24 hour limit in a dialog when a second request is refused', async () => {
    const user = userEvent.setup()
    db.extra.exportRequestedAt = undefined
    latestExport('none')
    server.use(
      http.post(apiUrl('/v1/me/exports'), () =>
        apiError(429, 'limit_reached', 'One export per day', {
          details: { limit: 1, used: 1, resets_at: '2026-11-21T10:00:00Z' },
        }),
      ),
    )
    renderAccount()
    const card = await dataGroup()

    await user.click(await card.findByRole('button', { name: 'Download my data' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(
      within(dialog).getByText('You can request your data once every 24 hours.'),
    ).toBeInTheDocument()
  })

  it('shows the error state when the export status cannot be loaded, and retries', async () => {
    let failing = true
    server.use(
      http.get(apiUrl('/v1/me/exports/latest'), () => {
        if (failing) return apiError(500, 'internal_error', 'Boom')
        return undefined
      }),
    )
    const user = userEvent.setup()
    renderAccount()
    const card = await dataGroup()

    expect(await card.findByText('Something went wrong')).toBeInTheDocument()
    failing = false
    await user.click(card.getByRole('button', { name: 'Try again' }))
    expect(
      await card.findByText('Get a copy of everything stored about you as a file.'),
    ).toBeInTheDocument()
  })
})

describe('SET-ACCOUNT: delete my account (06 section 9)', () => {
  async function openConfirmation(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: 'Delete my account' }))
  }

  it('first offers the gentler options for a live profile', async () => {
    const user = userEvent.setup()
    renderAccount('active')
    await openConfirmation(user)

    const sheet = await screen.findByRole('alertdialog')
    expect(within(sheet).getByRole('button', { name: 'Pause my profile' })).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Close my profile' })).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Continue to delete' })).toBeInTheDocument()
  })

  it('leads from the gentler options to the pause confirmation', async () => {
    const user = userEvent.setup()
    renderAccount('active')
    await openConfirmation(user)

    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Pause my profile',
      }),
    )

    expect(await screen.findByText('Pause the profile?')).toBeInTheDocument()
    expect(screen.queryByText('Take a break instead?')).not.toBeInTheDocument()
  })

  it('offers only closing for a paused profile, and skips the options for a closed one', async () => {
    const user = userEvent.setup()
    const { unmount } = renderAccount('paused')
    await openConfirmation(user)
    const sheet = await screen.findByRole('alertdialog')
    expect(
      within(sheet).queryByRole('button', { name: 'Pause my profile' }),
    ).not.toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Close my profile' })).toBeInTheDocument()
    unmount()

    renderAccount('closed')
    await openConfirmation(user)
    expect(await screen.findByText('Delete your account?')).toBeInTheDocument()
    expect(screen.queryByText('Take a break instead?')).not.toBeInTheDocument()
  })

  it('shows the copy of 06 section 9.5 with the dates computed from the grace days', async () => {
    resetDb('closed')
    db.me.config.deletion_grace_days = 14
    const user = userEvent.setup()
    renderWithProviders(() => <AccountScreen />, {
      path: '/settings/account',
      me: structuredClone(db.me),
    })
    await openConfirmation(user)

    const dialog = await screen.findByRole('alertdialog')
    const list = within(dialog).getByRole('list', {
      name: 'What happens when you delete your account',
    })
    expect(within(list).getAllByRole('listitem')).toHaveLength(6)
    expect(
      within(list).getByText('Your profile is hidden from everyone as soon as you confirm.'),
    ).toBeInTheDocument()
    expect(
      within(list).getByText(
        'You have 14 days to change your mind. Sign in again and choose "Keep my account".',
      ),
    ).toBeInTheDocument()
    expect(
      within(list).getByText(
        /^On \d+ \w+ \d{4} we permanently delete your profile, photos, preferences, contact details, identity number and verification images\.$/,
      ),
    ).toBeInTheDocument()
    expect(within(list).queryByText(/30 days/)).not.toBeInTheDocument()
    expect(
      within(list).getByText(
        /^Messages you sent are removed\. People you chatted with will see "Member no longer available" and "Message removed"\.$/,
      ),
    ).toBeInTheDocument()
    expect(
      within(list).getByText(/^We keep a minimal record for up to 2 years/),
    ).toBeInTheDocument()
    expect(
      within(list).getByText(
        'Looking for a break instead? You can pause your profile and come back any time.',
      ),
    ).toBeInTheDocument()
  })

  it('enables "Delete my account" only when DELETE is typed exactly', async () => {
    const user = userEvent.setup()
    renderAccount('closed')
    await openConfirmation(user)

    const dialog = await screen.findByRole('alertdialog')
    const submit = within(dialog).getByRole('button', { name: 'Delete my account' })
    const field = within(dialog).getByLabelText('Type DELETE to confirm')
    expect(submit).toBeDisabled()
    await user.type(field, 'delete')
    expect(submit).toBeDisabled()
    await user.clear(field)
    await user.type(field, 'DELETE ')
    expect(submit).toBeDisabled()
    await user.clear(field)
    await user.type(field, 'DELETE')
    expect(submit).toBeEnabled()
  })

  it('sends the optional reason and the confirmation, then puts the new gate in the cache', async () => {
    const bodies: unknown[] = []
    server.use(
      http.post(apiUrl('/v1/me/deletion'), async ({ request }) => {
        bodies.push(await readJson(request.clone()))
        return undefined
      }),
    )
    const user = userEvent.setup()
    const { queryClient } = renderAccount('closed')
    await openConfirmation(user)

    const dialog = await screen.findByRole('alertdialog')
    await user.type(
      within(dialog).getByLabelText('Why are you leaving? (optional)'),
      ' Found a match ',
    )
    await user.type(within(dialog).getByLabelText('Type DELETE to confirm'), 'DELETE')
    await user.click(within(dialog).getByRole('button', { name: 'Delete my account' }))

    await waitFor(() => expect(bodies).toEqual([{ reason: 'Found a match', confirm: 'DELETE' }]))
    await waitFor(() =>
      expect(queryClient.getQueryData<Me>(qk.me())?.gate).toBe('deletion_scheduled'),
    )
    expect(queryClient.getQueryData<Me>(qk.me())?.user.purge_after).not.toBeNull()
  })

  it('omits the reason when it was left empty, and limits it to 300 characters', async () => {
    const bodies: unknown[] = []
    server.use(
      http.post(apiUrl('/v1/me/deletion'), async ({ request }) => {
        bodies.push(await readJson(request.clone()))
        return undefined
      }),
    )
    const user = userEvent.setup()
    renderAccount('closed')
    await openConfirmation(user)

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByLabelText('Why are you leaving? (optional)')).toHaveAttribute(
      'maxlength',
      '300',
    )
    await user.type(within(dialog).getByLabelText('Type DELETE to confirm'), 'DELETE')
    await user.click(within(dialog).getByRole('button', { name: 'Delete my account' }))

    await waitFor(() => expect(bodies).toEqual([{ confirm: 'DELETE' }]))
  })

  it('cancelling leaves the account alone and clears what was typed', async () => {
    const user = userEvent.setup()
    renderAccount('closed')
    await openConfirmation(user)

    let dialog = await screen.findByRole('alertdialog')
    await user.type(within(dialog).getByLabelText('Type DELETE to confirm'), 'DELETE')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(db.me.user.purge_after).toBeNull()

    await openConfirmation(user)
    dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByLabelText('Type DELETE to confirm')).toHaveValue('')
  })

  it('closes the dialog and refetches Me when the deletion is already scheduled (invalid_state)', async () => {
    server.use(
      http.post(apiUrl('/v1/me/deletion'), () =>
        apiError(409, 'invalid_state', 'Already scheduled'),
      ),
    )
    const user = userEvent.setup()
    renderAccount('closed')
    await openConfirmation(user)

    const dialog = await screen.findByRole('alertdialog')
    await user.type(within(dialog).getByLabelText('Type DELETE to confirm'), 'DELETE')
    await user.click(within(dialog).getByRole('button', { name: 'Delete my account' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(
      screen.queryByText('This can no longer be done. Please refresh and try again.'),
    ).not.toBeInTheDocument()
  })

  it('keeps the dialog open and shows a toast when the request fails', async () => {
    server.use(http.post(apiUrl('/v1/me/deletion'), () => apiError(500, 'internal_error', 'Boom')))
    const user = userEvent.setup()
    renderAccount('closed')
    await openConfirmation(user)

    const dialog = await screen.findByRole('alertdialog')
    await user.type(within(dialog).getByLabelText('Type DELETE to confirm'), 'DELETE')
    await user.click(within(dialog).getByRole('button', { name: 'Delete my account' }))

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('shows the server message under the reason field on validation_failed', async () => {
    server.use(
      http.post(apiUrl('/v1/me/deletion'), () =>
        apiError(400, 'validation_failed', 'Some fields need your attention.', {
          fields: [{ field: 'reason', code: 'too_long', message: 'At most 300 characters.' }],
        }),
      ),
    )
    const user = userEvent.setup()
    renderAccount('closed')
    await openConfirmation(user)

    const dialog = await screen.findByRole('alertdialog')
    await user.type(within(dialog).getByLabelText('Type DELETE to confirm'), 'DELETE')
    await user.click(within(dialog).getByRole('button', { name: 'Delete my account' }))

    expect(await within(dialog).findByText('This is too long.')).toBeInTheDocument()
  })
})
