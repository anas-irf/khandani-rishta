import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http } from 'msw'
import { describe, expect, it } from 'vitest'
import type { Me, VerificationRequest } from '~/lib/api-types'
import { db } from '~/mocks/db'
import { makeMe, makeOwnPhoto } from '~/mocks/factories'
import { apiError, apiUrl } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderWithProviders } from '~/test/render'
import {
  identityRowState,
  photoRowState,
  VerificationCentreScreen,
} from './VerificationCentreScreen'

function request(overrides: Partial<VerificationRequest>): VerificationRequest {
  return {
    id: 'req-1',
    kind: 'id_document',
    status: 'pending',
    rejection_reason: null,
    created_at: '2026-11-18T10:00:00Z',
    reviewed_at: null,
    ...overrides,
  }
}

function meWith(overrides: Parameters<typeof makeMe>[0] = {}): Me {
  return makeMe({ ...overrides, profile: { photo: makeOwnPhoto(), ...overrides.profile } })
}

function renderCentre(me: Me = meWith()) {
  return renderWithProviders(() => <VerificationCentreScreen />, { me })
}

describe('row states', () => {
  const base = {
    phone_verified: false,
    photo_verified: false,
    id_verified: false,
    identity: null,
    requests: [],
  }

  it('evaluates the identity row top to bottom', () => {
    expect(identityRowState({ ...base, id_verified: true })).toBe('verified')
    expect(identityRowState({ ...base, requests: [request({})] })).toBe('pending')
    expect(identityRowState({ ...base, requests: [request({ status: 'rejected' })] })).toBe(
      'rejected',
    )
    expect(identityRowState(base)).toBe('not_started')
    expect(
      identityRowState({
        ...base,
        identity: {
          document_type: 'cnic',
          number_masked: '1',
          status: 'unverified',
          verified_at: null,
        },
        requests: [request({ status: 'cancelled' })],
      }),
    ).toBe('number_added')
  })

  it('uses only the newest request of the kind', () => {
    const requests = [
      request({ id: 'new', kind: 'selfie', status: 'rejected' }),
      request({ id: 'old', kind: 'selfie', status: 'pending' }),
    ]
    expect(photoRowState({ ...base, requests }, true)).toBe('rejected')
    expect(photoRowState(base, false)).toBe('no_photo')
    expect(photoRowState({ ...base, photo_verified: true }, false)).toBe('verified')
    expect(photoRowState(base, true)).toBe('not_started')
  })
})

describe('VerificationCentreScreen', () => {
  it('shows skeleton rows, then both checks with their controls', async () => {
    server.use(
      http.get(apiUrl('/v1/me/verifications'), async () => {
        await delay(100)
        return undefined
      }),
    )
    renderCentre()
    expect(await screen.findByText('Loading the verification state')).toBeInTheDocument()
    expect(await screen.findByText('Upload the card to get the badge.')).toBeInTheDocument()
    expect(screen.getByText('CNIC: *********1234')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Upload the card' })).toHaveAttribute(
      'href',
      '/me/verification/identity',
    )
    expect(screen.getByRole('link', { name: 'Change the number' })).toHaveAttribute(
      'href',
      '/me/verification/identity?change=true',
    )
    expect(
      screen.getByText('Take a quick selfie so members know your photos are really you.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Take a selfie' })).toHaveAttribute(
      'href',
      '/me/verification/selfie',
    )
    expect(
      screen.getByText(
        'Your documents are seen only by our review team and are deleted 30 days after the decision.',
      ),
    ).toBeInTheDocument()
  })

  it('asks for the number first when none was added', async () => {
    db.identity = null
    renderCentre()
    expect(
      await screen.findByText('Add your CNIC number, then upload the card.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Start' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Change the number' })).not.toBeInTheDocument()
  })

  it('asks for a photo before the photo check', async () => {
    renderCentre(makeMe({ profile: { photo: null } }))
    expect(await screen.findByText('Add a photo first.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add a photo' })).toHaveAttribute('href', '/me/photos')
  })

  it('shows the verified states with the date', async () => {
    db.ownProfile.verification = {
      ...db.ownProfile.verification,
      id_verified: true,
      photo_verified: true,
    }
    db.identity = {
      document_type: 'cnic',
      number_masked: '*********1234',
      status: 'verified',
      verified_at: '2026-11-10T09:00:00Z',
    }
    renderCentre()
    expect(await screen.findByText('Verified on 10 November 2026.')).toBeInTheDocument()
    expect(screen.getByText('Verified.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Start|Upload the card|Take a selfie/ })).toBeNull()
  })

  it('cancels a pending request after the confirmation', async () => {
    const user = userEvent.setup()
    db.verificationRequests = [request({ id: 'req-pending' })]
    db.identity = {
      document_type: 'cnic',
      number_masked: '*********1234',
      status: 'pending',
      verified_at: null,
    }
    renderCentre()
    expect(
      await screen.findByText('Under review. We usually finish within 24 hours.'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel request' }))
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Cancel this verification request?',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel request' }))
    expect(await screen.findByText('The request is cancelled.')).toBeInTheDocument()
    expect(await screen.findByText('Upload the card to get the badge.')).toBeInTheDocument()
    expect(db.verificationRequests[0]?.status).toBe('cancelled')
    expect(db.identity?.status).toBe('unverified')
  })

  it('shows the rejection message in the candidate form for a managed profile', async () => {
    db.verificationRequests = [
      request({ kind: 'selfie', status: 'rejected', rejection_reason: 'face_mismatch' }),
    ]
    renderCentre(meWith({ profile: { managed_by: 'parent', first_name: 'Ayesha' } }))
    expect(
      await screen.findByText(
        'Not approved: The selfie does not match the document or the profile photos. Please make sure the selfie shows Ayesha, and that every profile photo is of Ayesha. You can try again.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute(
      'href',
      '/me/verification/selfie',
    )
  })

  it('uses "you" when the candidate manages the profile and fills in the support email', async () => {
    const user = userEvent.setup()
    db.verificationRequests = [
      request({ id: 'a', kind: 'selfie', status: 'rejected', rejection_reason: 'face_mismatch' }),
      request({
        id: 'b',
        kind: 'id_document',
        status: 'rejected',
        rejection_reason: 'suspected_fraud',
        created_at: '2026-11-15T10:00:00Z',
        reviewed_at: '2026-11-16T10:00:00Z',
      }),
    ]
    renderCentre()
    expect(
      await screen.findByText(
        /^Not approved: .*Please make sure the selfie shows you, and that every profile photo is of you\. You can try again\.$/,
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Not approved: We could not accept this document. If you believe this is a mistake, email support@example.com. You can try again.',
      ),
    ).toBeInTheDocument()

    // Past requests: kind, status, date and the message.
    const toggle = screen.getByRole('button', { name: 'Past requests' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Identity document: Not approved, 16 Nov 2026')).toBeVisible()
    expect(screen.getByText('Photo check: Not approved, 18 Nov 2026')).toBeVisible()
  })

  it('shows the screen error when the state cannot be loaded', async () => {
    server.use(
      http.get(apiUrl('/v1/me/verifications'), () => apiError(503, 'service_unavailable', 'Down')),
    )
    renderCentre()
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
  })

  it('lets a closed profile view but not submit', async () => {
    renderCentre(meWith({ profile: { status: 'closed' } }))
    await waitFor(() =>
      expect(
        screen.getAllByText('The profile is closed. Reopen it to send a verification request.'),
      ).not.toHaveLength(0),
    )
    expect(await screen.findByText('Upload the card to get the badge.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Upload the card' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Take a selfie' })).not.toBeInTheDocument()
  })
})
