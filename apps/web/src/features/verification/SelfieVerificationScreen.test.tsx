import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Me } from '~/lib/api-types'
import { todayInKarachi } from '~/lib/format'
import { prepareImage } from '~/lib/image'
import { db } from '~/mocks/db'
import { makeMe, makeOwnPhoto } from '~/mocks/factories'
import { selfieGestureFor } from '~/mocks/handlers/verifications'
import { apiError, apiUrl, validationError } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderWithProviders } from '~/test/render'
import type { CaptureMode } from './capture'
import { SelfieVerificationScreen } from './SelfieVerificationScreen'

vi.mock('~/lib/image', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/lib/image')>()
  return { ...actual, prepareImage: vi.fn() }
})

const INSTRUCTIONS: Record<string, string> = {
  peace_sign: 'Hold up two fingers next to your face',
  thumbs_up: 'Give a thumbs up next to your face',
  open_palm: 'Show your open palm next to your face',
  hand_on_head: 'Place one hand flat on top of your head',
}

function meWithPhoto(overrides: Parameters<typeof makeMe>[0] = {}): Me {
  return makeMe({ ...overrides, profile: { photo: makeOwnPhoto(), ...overrides.profile } })
}

function renderSelfie(me: Me = meWithPhoto(), captureMode: CaptureMode = 'phone') {
  return renderWithProviders(() => <SelfieVerificationScreen captureMode={captureMode} />, {
    me,
  })
}

async function todaysInstruction() {
  const gesture = await selfieGestureFor(db.ownProfile.id, todayInKarachi())
  return INSTRUCTIONS[gesture] ?? ''
}

async function captureOnPhone(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Continue' }))
  await screen.findByText(await todaysInstruction())
  await user.upload(
    screen.getByTestId('selfie-camera-input'),
    new File([new Uint8Array(3000)], 'selfie.jpg', { type: 'image/jpeg' }),
  )
  await user.click(await screen.findByRole('button', { name: 'Use this photo' }))
}

beforeEach(() => {
  // The photo check needs an approved photo in the mock too (12 section 4.1).
  db.ownPhotos = [makeOwnPhoto({ status: 'approved' })]
  vi.mocked(prepareImage).mockImplementation(async () => ({
    blob: new Blob([new Uint8Array(2000)], { type: 'image/jpeg' }),
    width: 1200,
    height: 1600,
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SelfieVerificationScreen', () => {
  it('explains the check, shows the gesture, captures and submits the selfie', async () => {
    const user = userEvent.setup()
    renderSelfie()
    expect(
      await screen.findByText(
        'Take one selfie of yourself doing the gesture below. We compare it with the profile photos. The selfie is never shown on the profile and is deleted 30 days after our decision.',
      ),
    ).toBeInTheDocument()
    await captureOnPhone(user)
    await user.click(await screen.findByRole('button', { name: 'Submit selfie' }))
    expect(
      await screen.findByText('Thank you. We usually review within 24 hours.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Done' })).toHaveAttribute('href', '/me/verification')
    expect(prepareImage).toHaveBeenCalledWith(expect.any(Blob), { maxLongSide: 1600, minSide: 0 })
    expect(db.verificationRequests).toMatchObject([{ kind: 'selfie', status: 'pending' }])
  })

  it('names the candidate on a managed profile', async () => {
    renderSelfie(meWithPhoto({ profile: { managed_by: 'parent', first_name: 'Ayesha' } }))
    expect(
      await screen.findByText('This selfie must be of Ayesha, the person this profile is for.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Take one selfie of Ayesha doing the gesture below/),
    ).toBeInTheDocument()
  })

  it('asks for a photo first without an approved photo', async () => {
    renderSelfie(makeMe({ profile: { photo: null } }))
    expect(await screen.findByText('Add a photo first.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add a photo' })).toHaveAttribute('href', '/me/photos')
  })

  it('shows "Add a photo first" when the API answers invalid_state', async () => {
    const user = userEvent.setup()
    db.ownPhotos = []
    renderSelfie()
    await captureOnPhone(user)
    await user.click(await screen.findByRole('button', { name: 'Submit selfie' }))
    expect(await screen.findByText('Add a photo first.')).toBeInTheDocument()
  })

  it('returns to the centre when a selfie is already being reviewed', async () => {
    const user = userEvent.setup()
    db.verificationRequests = [
      {
        id: 'pending',
        kind: 'selfie',
        status: 'pending',
        rejection_reason: null,
        created_at: '2026-11-19T10:00:00Z',
        reviewed_at: null,
      },
    ]
    const { router } = renderSelfie()
    await captureOnPhone(user)
    await user.click(await screen.findByRole('button', { name: 'Submit selfie' }))
    expect(await screen.findByText('A selfie is already being reviewed.')).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.pathname).toBe('/me/verification'))
  })

  it('restarts at the gesture when the challenge changed', async () => {
    const user = userEvent.setup()
    server.use(
      http.post(apiUrl('/v1/me/verifications'), () =>
        validationError([{ field: 'gesture', code: 'mismatch', message: 'Changed' }]),
      ),
    )
    renderSelfie()
    await captureOnPhone(user)
    await user.click(await screen.findByRole('button', { name: 'Submit selfie' }))
    expect(
      await screen.findByText('The requested gesture has changed. Please take a new selfie.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open camera' })).toBeInTheDocument()
  })

  it('keeps the photo and offers "Try again" when the upload fails', async () => {
    const user = userEvent.setup()
    let refuse = true
    server.use(
      http.put('https://r2.mock.local/uploads/*', () =>
        refuse ? new HttpResponse(null, { status: 403 }) : undefined,
      ),
    )
    renderSelfie()
    await captureOnPhone(user)
    await user.click(await screen.findByRole('button', { name: 'Submit selfie' }))
    expect(
      await screen.findByText('The upload failed. Check your connection and try again.'),
    ).toBeInTheDocument()
    refuse = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(
      await screen.findByText('Thank you. We usually review within 24 hours.'),
    ).toBeInTheDocument()
  })

  it('asks to retake a photo that is too large', async () => {
    const user = userEvent.setup()
    server.use(
      http.post(apiUrl('/v1/me/verifications/uploads'), () =>
        apiError(413, 'payload_too_large', 'Too large', { details: { max_bytes: 10485760 } }),
      ),
    )
    renderSelfie()
    await captureOnPhone(user)
    await user.click(await screen.findByRole('button', { name: 'Submit selfie' }))
    expect(
      await screen.findByText('This photo is too large. Please retake it.'),
    ).toBeInTheDocument()
  })

  it('explains that a desktop without a camera cannot take the selfie', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: undefined })
    renderSelfie(meWithPhoto(), 'desktop')
    await user.click(await screen.findByRole('button', { name: 'Continue' }))
    await user.click(await screen.findByRole('button', { name: 'Open camera' }))
    expect(
      await screen.findByText('Open Khandani Rishta on your phone to take the selfie'),
    ).toBeInTheDocument()
    // No gallery picker on this screen.
    expect(screen.queryByTestId('selfie-camera-input')).not.toBeInTheDocument()
  })

  it('explains how to allow a refused camera and tries again', async () => {
    const user = userEvent.setup()
    const getUserMedia = vi.fn(async () => {
      throw Object.assign(new Error('denied'), { name: 'NotAllowedError' })
    })
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia } })
    renderSelfie(meWithPhoto(), 'desktop')
    await user.click(await screen.findByRole('button', { name: 'Continue' }))
    await user.click(await screen.findByRole('button', { name: 'Open camera' }))
    expect(
      await screen.findByText(
        'We need the camera for this check. Allow camera access in your settings and try again.',
      ),
    ).toBeInTheDocument()
    expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: 'user' }, audio: false })
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2))
  })

  it('shows the closed notice instead of the flow', async () => {
    renderSelfie(meWithPhoto({ profile: { status: 'closed' } }))
    expect(
      await screen.findByText('The profile is closed. Reopen it to send a verification request.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument()
  })
})
