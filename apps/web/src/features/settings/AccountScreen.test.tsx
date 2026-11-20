import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GlobalDialogs } from '~/components/common/GlobalDialogs'
import type { AuthSession } from '~/features/auth/session'
import type { Me } from '~/lib/api-types'
import { closeLimitDialog } from '~/lib/dialogs'
import { SUPPORTED_LANGUAGES, setLanguage } from '~/lib/i18n'
import { useMe } from '~/lib/me'
import { qk } from '~/lib/query'
import { db, type MockScenario, resetDb } from '~/mocks/db'
import { apiError, apiUrl, readJson } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderWithProviders } from '~/test/render'
import { AccountScreen } from './AccountScreen'

/** AuthGate keeps `['me']` observed in the app; the tests need the same to see it refetch. */
function KeepMeFresh() {
  useMe()
  return null
}

function renderAccount(scenario: MockScenario = 'active', session?: Partial<AuthSession>) {
  resetDb(scenario)
  return renderWithProviders(
    () => (
      <>
        <KeepMeFresh />
        <GlobalDialogs />
        <AccountScreen />
      </>
    ),
    { path: '/settings/account', me: structuredClone(db.me), session },
  )
}

function cachedMe(queryClient: ReturnType<typeof renderAccount>['queryClient']) {
  return queryClient.getQueryData<Me>(qk.me())
}

/** The groups of the screen are regions named by their heading. */
async function group(title: string) {
  return within(await screen.findByRole('region', { name: title }))
}

afterEach(() => closeLimitDialog())

describe('SET-ACCOUNT: sign-in and security', () => {
  it('shows the email with a tick when verified, and the phone when set', async () => {
    resetDb('active')
    db.me.user.phone_e164 = '+923001234567'
    renderWithProviders(() => <AccountScreen />, {
      path: '/settings/account',
      me: structuredClone(db.me),
    })

    const card = await group('Sign-in and security')
    expect(await screen.findByText('Email: member@example.com')).toBeInTheDocument()
    expect(card.getByRole('img', { name: 'Email verified' })).toBeInTheDocument()
    expect(card.getByText('Phone: +92 300 1234567')).toBeInTheDocument()
  })

  it('omits the tick for an unverified email and the line for no phone', async () => {
    resetDb('active')
    db.me.user.email_verified = false
    renderWithProviders(() => <AccountScreen />, {
      path: '/settings/account',
      me: structuredClone(db.me),
    })

    const card = await group('Sign-in and security')
    expect(await screen.findByText('Email: member@example.com')).toBeInTheDocument()
    expect(card.queryByRole('img', { name: 'Email verified' })).not.toBeInTheDocument()
    expect(card.queryByText(/^Phone:/)).not.toBeInTheDocument()
  })

  it('opens the Clerk account window from the row', async () => {
    const openUserProfile = vi.fn()
    const user = userEvent.setup()
    renderAccount('active', { openUserProfile })

    await user.click(await screen.findByRole('button', { name: 'Manage sign-in and security' }))
    expect(openUserProfile).toHaveBeenCalledOnce()
  })

  it('shows a note instead when there is no Clerk (mock mode)', async () => {
    renderAccount('active')
    expect(
      await screen.findByText('Sign-in and security settings are not available in this preview.'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Manage sign-in and security' }),
    ).not.toBeInTheDocument()
  })
})

describe('SET-ACCOUNT: language', () => {
  it('offers English, and Urdu as disabled with "Coming soon"', async () => {
    renderAccount()

    const select = await screen.findByRole('combobox', { name: 'Language' })
    expect(select).toHaveValue('en')
    expect(within(select).getByRole('option', { name: 'English' })).toBeEnabled()
    expect(within(select).getByRole('option', { name: 'Urdu' })).toBeDisabled()
    expect(screen.getByText('Coming soon')).toBeInTheDocument()
  })

  it('changes the language with PATCH /v1/me and switches the strings', async () => {
    ;(SUPPORTED_LANGUAGES as string[]).push('ur')
    try {
      const bodies: unknown[] = []
      server.use(
        http.patch(apiUrl('/v1/me'), async ({ request }) => {
          bodies.push(await readJson(request.clone()))
          return undefined
        }),
      )
      const user = userEvent.setup()
      const { queryClient } = renderAccount()

      const select = await screen.findByRole('combobox', { name: 'Language' })
      expect(within(select).getByRole('option', { name: 'Urdu' })).toBeEnabled()
      expect(screen.queryByText('Coming soon')).not.toBeInTheDocument()
      await user.selectOptions(select, 'ur')

      await waitFor(() => expect(bodies).toEqual([{ locale: 'ur' }]))
      await waitFor(() => expect(cachedMe(queryClient)?.user.locale).toBe('ur'))
      expect(document.documentElement.lang).toBe('ur')
      expect(document.documentElement.dir).toBe('rtl')
    } finally {
      ;(SUPPORTED_LANGUAGES as string[]).splice(SUPPORTED_LANGUAGES.indexOf('ur'), 1)
      await setLanguage('en')
    }
  })

  it('shows "Could not save" and keeps the language when the change fails', async () => {
    ;(SUPPORTED_LANGUAGES as string[]).push('ur')
    try {
      server.use(http.patch(apiUrl('/v1/me'), () => apiError(500, 'internal_error', 'Boom')))
      const user = userEvent.setup()
      const { queryClient } = renderAccount()

      await user.selectOptions(await screen.findByRole('combobox', { name: 'Language' }), 'ur')

      expect(await screen.findByText('Could not save. Please try again.')).toBeInTheDocument()
      expect(cachedMe(queryClient)?.user.locale).toBe('en')
      expect(screen.getByRole('combobox', { name: 'Language' })).toHaveValue('en')
    } finally {
      ;(SUPPORTED_LANGUAGES as string[]).splice(SUPPORTED_LANGUAGES.indexOf('ur'), 1)
    }
  })
})

describe('SET-ACCOUNT: profile status (08 section 7)', () => {
  it('shows "The profile is live." with Pause and Close for an active profile', async () => {
    renderAccount('active')
    const card = await group('Profile status')
    expect(await card.findByText('The profile is live.')).toBeInTheDocument()
    expect(card.getByRole('button', { name: 'Pause the profile' })).toBeInTheDocument()
    expect(card.getByRole('button', { name: 'Close the profile' })).toBeInTheDocument()
    expect(card.queryByRole('button', { name: 'Resume the profile' })).not.toBeInTheDocument()
    expect(card.queryByRole('button', { name: 'Reopen the profile' })).not.toBeInTheDocument()
  })

  it.each([['pending_review' as const], ['changes_requested' as const]])(
    'offers no action while the profile is %s',
    async (scenario) => {
      renderAccount(scenario)
      const card = await group('Profile status')
      expect(await card.findByText('The profile is not live yet.')).toBeInTheDocument()
      expect(card.queryByRole('button')).not.toBeInTheDocument()
    },
  )

  it('asks before pausing, then pauses and says so', async () => {
    const user = userEvent.setup()
    const { queryClient } = renderAccount('active')

    await user.click(await screen.findByRole('button', { name: 'Pause the profile' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Pause the profile?')).toBeInTheDocument()
    expect(
      within(dialog).getByText(/^While it is paused: members cannot find the profile/),
    ).toBeInTheDocument()
    expect(db.me.profile.status).toBe('active')
    await user.click(within(dialog).getByRole('button', { name: 'Pause' }))

    await waitFor(() => expect(cachedMe(queryClient)?.profile.status).toBe('paused'))
    const card = await group('Profile status')
    expect(await card.findByText('The profile is paused.')).toBeInTheDocument()
    // The status line and the toast both say it.
    expect(screen.getAllByText('The profile is paused.')).toHaveLength(2)
    expect(card.getByRole('button', { name: 'Resume the profile' })).toBeInTheDocument()
  })

  it('does not pause when the confirmation is cancelled', async () => {
    const user = userEvent.setup()
    renderAccount('active')

    await user.click(await screen.findByRole('button', { name: 'Pause the profile' }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }),
    )

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(db.me.profile.status).toBe('active')
  })

  it('resumes at once, without a confirmation', async () => {
    const user = userEvent.setup()
    const { queryClient } = renderAccount('paused')

    await user.click(await screen.findByRole('button', { name: 'Resume the profile' }))

    await waitFor(() => expect(cachedMe(queryClient)?.profile.status).toBe('active'))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(await screen.findAllByText('The profile is live again.')).not.toHaveLength(0)
  })

  it('closes with the chosen reason', async () => {
    const bodies: unknown[] = []
    server.use(
      http.post(apiUrl('/v1/me/profile/close'), async ({ request }) => {
        bodies.push(await readJson(request.clone()))
        return undefined
      }),
    )
    const user = userEvent.setup()
    const { queryClient } = renderAccount('active')

    await user.click(await screen.findByRole('button', { name: 'Close the profile' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Close the profile?')).toBeInTheDocument()
    expect(within(dialog).getByText('Why are you closing it?')).toBeInTheDocument()
    expect(
      within(dialog).getByText(
        /^Closing hides the profile from everyone except your connections\./,
      ),
    ).toBeInTheDocument()
    const confirm = within(dialog).getByRole('button', { name: 'Close the profile' })
    expect(confirm).toBeDisabled()

    const reasons = within(dialog).getAllByRole('radio')
    expect(reasons.map((radio) => radio.closest('label')?.textContent)).toEqual([
      'I found a match on Khandani Rishta',
      'I found a match elsewhere',
      'I am taking a break',
      'Other',
    ])
    await user.click(within(dialog).getByRole('radio', { name: 'I am taking a break' }))
    expect(confirm).toBeEnabled()
    await user.click(confirm)

    await waitFor(() => expect(bodies).toEqual([{ reason: 'taking_a_break' }]))
    await waitFor(() => expect(cachedMe(queryClient)?.profile.status).toBe('closed'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText(/^Mubarak/)).not.toBeInTheDocument()
  })

  it('congratulates once after closing because the match was found here, and opens the connections', async () => {
    const user = userEvent.setup()
    const { router } = renderAccount('active')

    await user.click(await screen.findByRole('button', { name: 'Close the profile' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(
      within(dialog).getByRole('radio', { name: 'I found a match on Khandani Rishta' }),
    )
    await user.click(within(dialog).getByRole('button', { name: 'Close the profile' }))

    const note = await screen.findByRole('alertdialog')
    expect(
      within(note).getByText(
        'Mubarak! If the match is one of your connections, you can mark the engagement or nikah on that connection.',
      ),
    ).toBeInTheDocument()
    await user.click(within(note).getByRole('button', { name: 'Open my connections' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/chats'))
    expect(db.me.profile.status).toBe('closed')
  })

  it('reopens after a plain confirmation with { confirm: true }', async () => {
    const bodies: unknown[] = []
    server.use(
      http.post(apiUrl('/v1/me/profile/reopen'), async ({ request }) => {
        bodies.push(await readJson(request.clone()))
        return undefined
      }),
    )
    const user = userEvent.setup()
    const { queryClient } = renderAccount('closed')
    const card = await group('Profile status')

    expect(await card.findByText('The profile is closed.')).toBeInTheDocument()
    await waitFor(() =>
      expect(card.getByRole('button', { name: 'Reopen the profile' })).toBeEnabled(),
    )
    await user.click(card.getByRole('button', { name: 'Reopen the profile' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Reopen the profile?')).toBeInTheDocument()
    expect(
      within(dialog).getByText('The profile becomes visible to members again.'),
    ).toBeInTheDocument()
    expect(within(dialog).queryByLabelText(/Type REOPEN/)).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Reopen' }))

    await waitFor(() => expect(bodies).toEqual([{ confirm: true }]))
    await waitFor(() => expect(cachedMe(queryClient)?.profile.status).toBe('active'))
  })

  it('asks to type REOPEN when the profile was closed after a nikah', async () => {
    resetDb('closed')
    const connection = db.connections[0]
    if (!connection) throw new Error('no seeded connection')
    connection.stage = 'nikah_done'
    const otherName = connection.other?.display_name ?? ''
    const user = userEvent.setup()
    const { queryClient } = renderWithProviders(
      () => (
        <>
          <KeepMeFresh />
          <AccountScreen />
        </>
      ),
      { path: '/settings/account', me: structuredClone(db.me) },
    )

    const card = await group('Profile status')
    await waitFor(() =>
      expect(card.getByRole('button', { name: 'Reopen the profile' })).toBeEnabled(),
    )
    await user.click(card.getByRole('button', { name: 'Reopen the profile' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Reopen after a nikah?')).toBeInTheDocument()
    expect(
      within(dialog).getByText(
        `This profile was closed after a nikah was confirmed with ${otherName}. Reopening ends that connection. Type REOPEN to confirm.`,
      ),
    ).toBeInTheDocument()
    const confirm = within(dialog).getByRole('button', { name: 'Reopen' })
    expect(confirm).toBeDisabled()
    await user.type(within(dialog).getByLabelText('Type REOPEN to confirm'), 'reopen')
    expect(confirm).toBeDisabled()
    await user.clear(within(dialog).getByLabelText('Type REOPEN to confirm'))
    await user.type(within(dialog).getByLabelText('Type REOPEN to confirm'), 'REOPEN')
    expect(confirm).toBeEnabled()
    await user.click(confirm)

    await waitFor(() => expect(cachedMe(queryClient)?.profile.status).toBe('active'))
  })

  it('refetches Me without a toast when the status changed elsewhere (invalid_state)', async () => {
    server.use(
      http.post(apiUrl('/v1/me/profile/pause'), () =>
        apiError(409, 'invalid_state', 'Only an active profile can be paused', {
          details: { status: 'paused' },
        }),
      ),
    )
    const user = userEvent.setup()
    const { queryClient } = renderAccount('active')

    await user.click(await screen.findByRole('button', { name: 'Pause the profile' }))
    // Paused on another device meanwhile.
    db.me.profile.status = 'paused'
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Pause' }),
    )

    await waitFor(() => expect(cachedMe(queryClient)?.profile.status).toBe('paused'))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(
      screen.queryByText('This can no longer be done. Please refresh and try again.'),
    ).not.toBeInTheDocument()
    expect(
      await (await group('Profile status')).findByText('The profile is paused.'),
    ).toBeInTheDocument()
  })
})

describe('SET-ACCOUNT: sign out', () => {
  it('asks "Sign out of Khandani Rishta?" and then signs out', async () => {
    const signOut = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    const { router } = renderAccount('active', { signOut })

    await user.click(await (await group('Sign out')).findByRole('button', { name: 'Sign out' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Sign out of Khandani Rishta?')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Sign out' }))

    await waitFor(() => expect(signOut).toHaveBeenCalledOnce())
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })
})
