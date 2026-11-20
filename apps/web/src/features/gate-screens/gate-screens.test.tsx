import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { rememberReturnPath } from '~/features/auth/return-path'
import type { Me } from '~/lib/api-types'
import { qk } from '~/lib/query'
import { db, type MockScenario, resetDb } from '~/mocks/db'
import { apiError, apiUrl } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderWithProviders } from '~/test/render'
import { BlockedScreen } from './BlockedScreen'
import { ChangesScreen } from './ChangesScreen'
import { ConsentScreen } from './ConsentScreen'
import { DeletionScreen } from './DeletionScreen'
import { ReviewScreen } from './ReviewScreen'

/** Renders a gate screen as `AuthGate` would show it: `Me` loaded for the scenario's gate. */
function renderGate(
  ui: ReactNode,
  scenario: MockScenario,
  options: { path?: string; signOut?: () => Promise<void> } = {},
) {
  resetDb(scenario)
  return renderWithProviders(() => ui, {
    path: options.path ?? '/account',
    me: structuredClone(db.me),
    session: options.signOut ? { signOut: options.signOut } : undefined,
  })
}

function cachedMe(queryClient: ReturnType<typeof renderGate>['queryClient']) {
  return queryClient.getQueryData<Me>(qk.me())
}

describe('GATE-BLOCKED', () => {
  it('tells a suspended member the reason and the end date, in the member time zone', async () => {
    renderGate(<BlockedScreen />, 'suspended')

    expect(
      await screen.findByRole('heading', { name: 'Your account is suspended' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Reason: harassment. Your account will be available again on 4 December 2026.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Profile code: KR7Q2M')).toBeInTheDocument()
  })

  it('tells a banned member the account is closed', async () => {
    renderGate(<BlockedScreen />, 'banned')

    expect(
      await screen.findByRole('heading', { name: 'Your account has been closed' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Reason: fake_profile. If you believe this is a mistake, email us.'),
    ).toBeInTheDocument()
  })

  it('links to the guidelines and terms in new tabs, and offers support, sign out and deletion', async () => {
    renderGate(<BlockedScreen />, 'suspended')

    const guidelines = await screen.findByRole('link', { name: /Community Guidelines/ })
    expect(guidelines).toHaveAttribute('href', '/community-guidelines')
    expect(guidelines).toHaveAttribute('target', '_blank')
    expect(guidelines).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(screen.getByRole('link', { name: /Terms of Use/ })).toHaveAttribute('href', '/terms')

    expect(screen.getByRole('link', { name: 'Contact support' })).toHaveAttribute(
      'href',
      'mailto:support@example.com?subject=Account%20review%20KR7Q2M',
    )
    expect(screen.getByRole('button', { name: 'Delete my data' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Help and safety' })).toHaveAttribute(
      'href',
      '/settings/help',
    )
  })

  it('shows no primary navigation', async () => {
    renderGate(<BlockedScreen />, 'banned')
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('asks before signing out, then runs the sign-out steps', async () => {
    const signOut = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    const { router } = renderGate(<BlockedScreen />, 'banned', { signOut })

    await user.click(await screen.findByRole('button', { name: 'Sign out' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Sign out of Khandani Rishta?')).toBeInTheDocument()
    expect(signOut).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Sign out' }))

    await waitFor(() => expect(signOut).toHaveBeenCalledOnce())
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('"Delete my data" asks for DELETE and keeps the gate, then shows the purge date', async () => {
    const user = userEvent.setup()
    const { queryClient } = renderGate(<BlockedScreen />, 'banned')

    await user.click(await screen.findByRole('button', { name: 'Delete my data' }))
    const dialog = await screen.findByRole('alertdialog')
    const submit = within(dialog).getByRole('button', { name: 'Delete my account' })
    expect(submit).toBeDisabled()
    await user.type(within(dialog).getByLabelText('Type DELETE to confirm'), 'DELETE')
    expect(submit).toBeEnabled()
    await user.click(submit)

    await waitFor(() => expect(db.me.user.purge_after).not.toBeNull())
    // The sanction stays: the gate is still `banned` (15 section 6).
    expect(cachedMe(queryClient)?.gate).toBe('banned')
    expect(
      await screen.findByText(/^Your data will be deleted on \d+ \w+ \d{4}\.$/),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete my data' })).not.toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('refetches `GET /v1/me` when opened, so an ended suspension routes on', async () => {
    resetDb('suspended')
    const stale = structuredClone(db.me)
    resetDb('active')
    const { queryClient } = renderWithProviders(() => <BlockedScreen />, {
      path: '/account/blocked',
      me: stale,
    })

    await waitFor(() => expect(cachedMe(queryClient)?.gate).toBe('ok'))
  })
})

describe('GATE-DELETION', () => {
  it('shows the purge date and that the profile is hidden', async () => {
    renderGate(<DeletionScreen />, 'deletion_scheduled')

    expect(
      await screen.findByRole('heading', { name: 'Your account is scheduled for deletion' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Your account will be deleted on 20 December 2026. Until then you can change your mind.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Your profile is hidden from everyone in the meantime.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('"Keep my account" cancels the deletion, sets Me and welcomes the member back', async () => {
    const user = userEvent.setup()
    const { queryClient } = renderGate(<DeletionScreen />, 'deletion_scheduled')

    await user.click(await screen.findByRole('button', { name: 'Keep my account' }))

    expect(
      await screen.findByText('Welcome back. Your account is active again.'),
    ).toBeInTheDocument()
    await waitFor(() => expect(cachedMe(queryClient)?.gate).toBe('ok'))
    expect(db.me.user.purge_after).toBeNull()
  })

  it('refetches Me and says nothing when there is nothing to cancel (invalid_state)', async () => {
    server.use(
      http.delete(apiUrl('/v1/me/deletion'), () =>
        apiError(409, 'invalid_state', 'Nothing scheduled'),
      ),
    )
    const user = userEvent.setup()
    renderGate(<DeletionScreen />, 'deletion_scheduled')

    await user.click(await screen.findByRole('button', { name: 'Keep my account' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Keep my account' })).toBeEnabled(),
    )
    expect(
      screen.queryByText('Welcome back. Your account is active again.'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('This can no longer be done. Please refresh and try again.'),
    ).not.toBeInTheDocument()
  })

  it('shows a toast for an unexpected failure and keeps the screen', async () => {
    server.use(
      http.delete(apiUrl('/v1/me/deletion'), () => apiError(500, 'internal_error', 'Boom')),
    )
    const user = userEvent.setup()
    renderGate(<DeletionScreen />, 'deletion_scheduled')

    await user.click(await screen.findByRole('button', { name: 'Keep my account' }))

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep my account' })).toBeInTheDocument()
  })
})

describe('GATE-CONSENT', () => {
  it('lists each required document with a link to its public page', async () => {
    renderGate(<ConsentScreen />, 'consent_required')

    expect(
      await screen.findByRole('heading', { name: 'We have updated our terms' }),
    ).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'Updated documents' })
    const terms = within(list).getByRole('link', { name: /Terms of Use/ })
    expect(terms).toHaveAttribute('href', '/terms')
    expect(terms).toHaveAttribute('target', '_blank')
    expect(within(list).getByRole('link', { name: /Privacy Policy/ })).toHaveAttribute(
      'href',
      '/privacy',
    )
    expect(within(list).queryByText('Community Guidelines')).not.toBeInTheDocument()
  })

  it('offers sign out but no link to the help screen (not open under this gate)', async () => {
    renderGate(<ConsentScreen />, 'consent_required')
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Help and safety' })).not.toBeInTheDocument()
  })

  it('enables "Accept and continue" only after the box is ticked, then accepts the required documents', async () => {
    const user = userEvent.setup()
    const { queryClient } = renderGate(<ConsentScreen />, 'consent_required')

    const accept = await screen.findByRole('button', { name: 'Accept and continue' })
    expect(accept).toBeDisabled()
    await user.click(
      screen.getByRole('checkbox', { name: 'I have read and agree to the updated documents.' }),
    )
    expect(accept).toBeEnabled()
    await user.click(accept)

    await waitFor(() => expect(cachedMe(queryClient)?.gate).toBe('ok'))
    expect(db.me.consents_required).toEqual([])
    expect(cachedMe(queryClient)?.consents_required).toEqual([])
  })

  it('returns to the remembered screen after accepting', async () => {
    rememberReturnPath('/matches')
    const user = userEvent.setup()
    const { router } = renderGate(<ConsentScreen />, 'consent_required', {
      path: '/account/consent',
    })

    await user.click(await screen.findByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Accept and continue' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/matches'))
  })

  it('stays on the gate screen path when nothing was remembered (AuthGate routes to the gate home)', async () => {
    const user = userEvent.setup()
    const { router } = renderGate(<ConsentScreen />, 'consent_required', {
      path: '/account/consent',
    })

    await user.click(await screen.findByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Accept and continue' }))

    await waitFor(() => expect(db.me.consents_required).toEqual([]))
    expect(router.state.location.pathname).toBe('/account/consent')
  })

  it('explains what happens when the member does not agree, and lets them go back', async () => {
    const user = userEvent.setup()
    renderGate(<ConsentScreen />, 'consent_required')

    await user.click(await screen.findByRole('button', { name: 'I do not agree' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(
      within(dialog).getByText(
        'You need to accept the updated documents to keep using Khandani Rishta. You can delete your account instead.',
      ),
    ).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Go back' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(db.me.consents_required).toEqual(['terms', 'privacy'])
  })

  it('"Delete my account" from the dialog opens the deletion confirmation and schedules it', async () => {
    const user = userEvent.setup()
    const { queryClient } = renderGate(<ConsentScreen />, 'consent_required')

    await user.click(await screen.findByRole('button', { name: 'I do not agree' }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Delete my account',
      }),
    )

    const confirm = await screen.findByRole('alertdialog')
    expect(within(confirm).getByText('Delete your account?')).toBeInTheDocument()
    await user.type(within(confirm).getByLabelText('Type DELETE to confirm'), 'DELETE')
    await user.click(within(confirm).getByRole('button', { name: 'Delete my account' }))

    await waitFor(() => expect(cachedMe(queryClient)?.gate).toBe('deletion_scheduled'))
  })
})

describe('GATE-REVIEW', () => {
  it('says the profile is being reviewed and links to the own profile', async () => {
    renderGate(<ReviewScreen />, 'pending_review')

    expect(
      await screen.findByRole('heading', { name: 'The profile is being reviewed' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Our team checks new profiles to keep everyone safe. This usually takes less than a day. We will notify you as soon as it is live.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View my profile' })).toHaveAttribute('href', '/me')
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('shows the cards that still apply: photo, identity and privacy', async () => {
    resetDb('pending_review')
    db.ownPhotos = []
    renderWithProviders(() => <ReviewScreen />, {
      path: '/account/review',
      me: structuredClone(db.me),
    })

    expect(await screen.findByRole('link', { name: /Add a photo/ })).toHaveAttribute(
      'href',
      '/me/photos',
    )
    expect(screen.getByRole('link', { name: /Verify your identity/ })).toHaveAttribute(
      'href',
      '/me/verification',
    )
    expect(screen.getByRole('link', { name: /Review your privacy/ })).toHaveAttribute(
      'href',
      '/settings/privacy',
    )
  })

  it('leaves out the photo card when there is a photo that is not rejected or failed', async () => {
    renderGate(<ReviewScreen />, 'pending_review')
    // The default own profile has an approved photo.
    await screen.findByRole('link', { name: /Verify your identity/ })
    expect(screen.queryByRole('link', { name: /Add a photo/ })).not.toBeInTheDocument()
  })

  it('leaves out the identity card once the identity is verified or a request is pending', async () => {
    resetDb('pending_review')
    db.ownProfile = {
      ...db.ownProfile,
      verification: {
        ...db.ownProfile.verification,
        pending: { id_document: true, selfie: false },
      },
    }
    renderWithProviders(() => <ReviewScreen />, {
      path: '/account/review',
      me: structuredClone(db.me),
    })

    await screen.findByRole('link', { name: /Review your privacy/ })
    expect(screen.queryByRole('link', { name: /Verify your identity/ })).not.toBeInTheDocument()
  })

  it('still shows the privacy card when the profile cannot be loaded', async () => {
    server.use(http.get(apiUrl('/v1/me/profile'), () => apiError(500, 'internal_error', 'Boom')))
    renderGate(<ReviewScreen />, 'pending_review')
    expect(await screen.findByRole('link', { name: /Review your privacy/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Add a photo/ })).not.toBeInTheDocument()
  })

  it('refetches `GET /v1/me` when opened, so an approval routes on', async () => {
    resetDb('pending_review')
    const stale = structuredClone(db.me)
    resetDb('active')
    const { queryClient } = renderWithProviders(() => <ReviewScreen />, {
      path: '/account/review',
      me: stale,
    })
    await waitFor(() => expect(cachedMe(queryClient)?.gate).toBe('ok'))
  })
})

describe('GATE-CHANGES', () => {
  it('shows the moderator reason in a highlighted box', async () => {
    renderGate(<ChangesScreen />, 'changes_requested')

    expect(
      await screen.findByRole('heading', { name: 'A few changes are needed' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Our team could not approve the profile yet. Please fix the following and send it for review again.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Please add a clearer description in About me.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Edit my profile' })).toHaveAttribute('href', '/me')
  })

  it('resubmits and puts the returned gate in the cache (GATE-REVIEW follows)', async () => {
    const user = userEvent.setup()
    const { queryClient } = renderGate(<ChangesScreen />, 'changes_requested')

    await user.click(await screen.findByRole('button', { name: 'Resubmit for review' }))

    await waitFor(() => expect(cachedMe(queryClient)?.gate).toBe('pending_review'))
    expect(db.me.profile.status).toBe('pending_review')
  })

  it('shows the messages of validation_failed with a link to each section to fix', async () => {
    server.use(
      http.post(apiUrl('/v1/me/profile/resubmit'), () =>
        apiError(400, 'validation_failed', 'Some fields need your attention.', {
          fields: [
            { field: 'date_of_birth', code: 'required', message: 'Add the date of birth.' },
            {
              field: 'education_level_code',
              code: 'required',
              message: 'Choose an education level.',
            },
            { field: 'photos', code: 'required', message: 'Add at least one photo.' },
          ],
        }),
      ),
    )
    const user = userEvent.setup()
    renderGate(<ChangesScreen />, 'changes_requested')

    await user.click(await screen.findByRole('button', { name: 'Resubmit for review' }))

    expect(await screen.findByText('Some details are still missing')).toBeInTheDocument()
    expect(screen.getByText('Basics: This field is required.')).toBeInTheDocument()
    expect(screen.getByText('Photos: This field is required.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Basics' })).toHaveAttribute(
      'href',
      '/me/edit/basics',
    )
    expect(screen.getByRole('link', { name: 'Go to Education and career' })).toHaveAttribute(
      'href',
      '/me/edit/education-career',
    )
    expect(screen.getByRole('link', { name: 'Go to Photos' })).toHaveAttribute('href', '/me/photos')
  })

  it('refetches Me and shows no toast when the profile is no longer waiting for changes (invalid_state)', async () => {
    server.use(
      http.post(apiUrl('/v1/me/profile/resubmit'), () => apiError(409, 'invalid_state', 'No')),
    )
    const user = userEvent.setup()
    const { queryClient } = renderGate(<ChangesScreen />, 'changes_requested')
    // The moderator approved it meanwhile.
    db.me.profile.status = 'active'
    db.me.profile.status_reason = null

    await user.click(await screen.findByRole('button', { name: 'Resubmit for review' }))

    await waitFor(() => expect(cachedMe(queryClient)?.gate).toBe('ok'))
    expect(
      screen.queryByText('This can no longer be done. Please refresh and try again.'),
    ).not.toBeInTheDocument()
  })

  it('offers help and sign out', async () => {
    renderGate(<ChangesScreen />, 'changes_requested')
    expect(await screen.findByRole('link', { name: 'Help and safety' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })
})
