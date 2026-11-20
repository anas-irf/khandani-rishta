import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IdentitySummary, Me } from '~/lib/api-types'
import { prepareImage } from '~/lib/image'
import { db } from '~/mocks/db'
import { makeMe } from '~/mocks/factories'
import { apiError, apiUrl, validationError } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderWithProviders } from '~/test/render'
import { IdentityVerificationScreen } from './IdentityVerificationScreen'

vi.mock('~/lib/image', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/lib/image')>()
  return { ...actual, prepareImage: vi.fn() }
})

type User = ReturnType<typeof userEvent.setup>

function image(name: string) {
  return new File([new Uint8Array(4000)], name, { type: 'image/jpeg' })
}

function renderIdentity(path = '/me/verification/identity', me: Me = makeMe()) {
  return renderWithProviders(() => <IdentityVerificationScreen captureMode="phone" />, {
    path,
    me,
  })
}

async function pickCard(user: User, name: string) {
  await user.upload(await screen.findByTestId('card-photo-input'), image(name))
  await user.click(await screen.findByRole('button', { name: 'Use this photo' }))
}

async function takeSelfie(user: User) {
  await user.upload(await screen.findByTestId('selfie-camera-input'), image('selfie.jpg'))
  await user.click(await screen.findByRole('button', { name: 'Use this photo' }))
}

beforeEach(() => {
  vi.mocked(prepareImage).mockImplementation(async () => ({
    blob: new Blob([new Uint8Array(3000)], { type: 'image/jpeg' }),
    width: 1600,
    height: 1000,
  }))
})

describe('IdentityVerificationScreen', () => {
  it('uploads front, back and selfie, then submits the request', async () => {
    const user = userEvent.setup()
    const slots: string[] = []
    server.use(
      http.post(apiUrl('/v1/me/verifications/uploads'), async ({ request }) => {
        slots.push(((await request.clone().json()) as { slot: string }).slot)
        return undefined
      }),
    )
    renderIdentity()
    // The number exists: step 1 is skipped and the masked number shown at step 2.
    expect(await screen.findByText('Registered number: CNIC *********1234')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Place the card on a dark, flat surface. Make sure all four corners are visible. Avoid glare. Do not cover any part of the card.',
      ),
    ).toBeInTheDocument()
    await pickCard(user, 'front.jpg')
    expect(await screen.findByRole('heading', { name: 'Back of the card' })).toBeInTheDocument()
    await pickCard(user, 'back.jpg')
    expect(
      await screen.findByText(/^Now a quick selfie of yourself so we can match the card\./),
    ).toBeInTheDocument()
    await takeSelfie(user)
    await user.click(await screen.findByRole('button', { name: 'Submit for review' }))
    expect(
      await screen.findByText(
        'Thank you. We will review your documents, usually within 24 hours. You can keep using the app meanwhile.',
      ),
    ).toBeInTheDocument()
    expect(slots).toEqual(['front', 'back', 'selfie'])
    expect(db.verificationRequests).toMatchObject([{ kind: 'id_document', status: 'pending' }])
    expect(db.identity?.status).toBe('pending')
    expect(prepareImage).toHaveBeenCalledWith(expect.any(File))
    expect(prepareImage).toHaveBeenCalledWith(expect.any(Blob), { maxLongSide: 1600, minSide: 0 })
  })

  it('skips the back for a passport', async () => {
    const user = userEvent.setup()
    db.identity = {
      document_type: 'passport',
      number_masked: '*****4567',
      status: 'unverified',
      verified_at: null,
    }
    renderIdentity()
    expect(
      await screen.findByRole('heading', { name: 'Photo page of the passport' }),
    ).toBeInTheDocument()
    await pickCard(user, 'passport.jpg')
    await takeSelfie(user)
    await user.click(await screen.findByRole('button', { name: 'Submit for review' }))
    expect(await screen.findByText(/Thank you. We will review your documents/)).toBeInTheDocument()
    expect(db.verificationRequests[0]?.kind).toBe('id_document')
  })

  it('asks for the number first when none was added', async () => {
    const user = userEvent.setup()
    db.identity = null
    renderIdentity()
    expect(await screen.findByRole('heading', { name: 'Document number' })).toBeInTheDocument()
    expect(await screen.findByText('Why we ask for the CNIC number')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: /CNIC number/ }), '3520212345672')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { name: 'Front of the card' })).toBeInTheDocument()
    const saved = db.identity as IdentitySummary | null
    expect(saved?.number_masked).toBe('*********5672')
  })

  it('opens the number step to change an existing number', async () => {
    renderIdentity('/me/verification/identity?change=true')
    expect(await screen.findByRole('heading', { name: 'Document number' })).toBeInTheDocument()
  })

  it('shows the managed-profile note on the number step', async () => {
    db.identity = null
    renderIdentity(
      '/me/verification/identity',
      makeMe({ profile: { managed_by: 'parent', first_name: 'Ayesha' } }),
    )
    expect(await screen.findByText("Enter Ayesha's number, not your own.")).toBeInTheDocument()
  })

  it('says so when the identity is already under review', async () => {
    db.identity = {
      document_type: 'cnic',
      number_masked: '*********1234',
      status: 'pending',
      verified_at: null,
    }
    renderIdentity()
    expect(
      await screen.findByText('Under review. We usually finish within 24 hours.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to verification' })).toHaveAttribute(
      'href',
      '/me/verification',
    )
  })

  it('returns to the centre on already_exists', async () => {
    const user = userEvent.setup()
    server.use(
      http.post(apiUrl('/v1/me/verifications'), () => apiError(409, 'already_exists', 'Pending')),
    )
    const { router } = renderIdentity()
    await pickCard(user, 'front.jpg')
    await pickCard(user, 'back.jpg')
    await takeSelfie(user)
    await user.click(await screen.findByRole('button', { name: 'Submit for review' }))
    expect(await screen.findByText('A request is already being reviewed.')).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.pathname).toBe('/me/verification'))
  })

  it('goes back to the back of the card when it is required', async () => {
    const user = userEvent.setup()
    server.use(
      http.post(apiUrl('/v1/me/verifications'), () =>
        validationError([{ field: 'back_key', code: 'required', message: 'Upload the back.' }]),
      ),
    )
    renderIdentity()
    await pickCard(user, 'front.jpg')
    await pickCard(user, 'back.jpg')
    await takeSelfie(user)
    await user.click(await screen.findByRole('button', { name: 'Submit for review' }))
    expect(await screen.findByRole('heading', { name: 'Back of the card' })).toBeInTheDocument()
  })

  it('retries only the failed upload round', async () => {
    const user = userEvent.setup()
    const slots: string[] = []
    let failSelfie = true
    server.use(
      http.post(apiUrl('/v1/me/verifications/uploads'), async ({ request }) => {
        const { slot } = (await request.clone().json()) as { slot: string }
        slots.push(slot)
        if (slot === 'selfie' && failSelfie) return HttpResponse.error()
        return undefined
      }),
    )
    renderIdentity()
    await pickCard(user, 'front.jpg')
    await pickCard(user, 'back.jpg')
    await takeSelfie(user)
    await user.click(await screen.findByRole('button', { name: 'Submit for review' }))
    expect(
      await screen.findByText('The upload failed. Check your connection and try again.'),
    ).toBeInTheDocument()
    failSelfie = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText(/Thank you. We will review your documents/)).toBeInTheDocument()
    expect(slots.filter((slot) => slot === 'front')).toHaveLength(1)
    expect(slots.filter((slot) => slot === 'back')).toHaveLength(1)
  })

  it('refreshes and returns to the centre on invalid_state', async () => {
    const user = userEvent.setup()
    server.use(
      http.post(apiUrl('/v1/me/verifications'), () =>
        apiError(409, 'invalid_state', 'Verified', { details: { status: 'verified' } }),
      ),
    )
    const { router } = renderIdentity()
    await pickCard(user, 'front.jpg')
    await pickCard(user, 'back.jpg')
    await takeSelfie(user)
    await user.click(await screen.findByRole('button', { name: 'Submit for review' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/me/verification'))
  })
})
