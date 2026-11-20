import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, HttpResponse, http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OwnPhoto } from '~/lib/api-types'
import { ImageError, prepareImage } from '~/lib/image'
import { db } from '~/mocks/db'
import { makeMe, makeOwnPhoto } from '~/mocks/factories'
import { photoMockState } from '~/mocks/handlers/photos'
import { apiError, apiUrl } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderWithProviders } from '~/test/render'
import { PhotoManager } from './PhotoManager'
import { PHOTO_POLL_FAST_MS, PHOTO_POLL_SLOW_MS, photoPollInterval } from './queries'

vi.mock('~/lib/image', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/lib/image')>()
  return { ...actual, prepareImage: vi.fn() }
})

function photo(id: string, overrides: Partial<OwnPhoto> = {}): OwnPhoto {
  return makeOwnPhoto({ id, is_primary: false, ...overrides })
}

function seedPhotos(photos: OwnPhoto[]) {
  db.ownPhotos = photos
  db.ownProfile.photos = photos
}

function renderManager(options: { badges?: ('photo_verified' | 'id_verified')[] } = {}) {
  const me = makeMe({ profile: { badges: options.badges ?? [] } })
  return renderWithProviders(() => <PhotoManager context="me" />, { me })
}

function jpeg(name = 'photo.jpg') {
  return new File([new Uint8Array(5000)], name, { type: 'image/jpeg' })
}

/** Counts requests to an endpoint and lets them through to the mock API. */
function countRequests(method: 'get' | 'put', path: string) {
  const counter = { count: 0 }
  server.use(
    http[method](apiUrl(path), () => {
      counter.count += 1
      return undefined
    }),
  )
  return counter
}

async function openMenu(user: ReturnType<typeof userEvent.setup>, position: number) {
  await user.click(await screen.findByRole('button', { name: `Options for photo ${position}` }))
  return screen.findByRole('menu')
}

beforeEach(() => {
  vi.mocked(prepareImage).mockImplementation(async () => ({
    blob: new Blob([new Uint8Array(4000)], { type: 'image/jpeg' }),
    width: 800,
    height: 800,
  }))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('PhotoManager states', () => {
  it('shows grey slots while loading, then the photos and the free slots', async () => {
    server.use(
      http.get(apiUrl('/v1/me/photos'), async () => {
        await delay(150)
        return undefined
      }),
    )
    renderManager()
    expect(await screen.findByRole('status')).toHaveAttribute('aria-busy', 'true')
    expect(await screen.findByRole('button', { name: 'Open photo 1' })).toBeInTheDocument()
    expect(screen.getByText('Main photo')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Add a photo, 5 free of 6/ })).toHaveLength(5)
    expect(screen.getByRole('heading', { name: 'Photo guidelines' })).toBeInTheDocument()
  })

  it('shows the empty line when there are no photos', async () => {
    seedPhotos([])
    renderManager()
    expect(
      await screen.findByText('No photos yet. Profiles with a photo receive far more interest.'),
    ).toBeInTheDocument()
    // The first empty slot is the main photo slot.
    expect(screen.getAllByRole('button', { name: /Add a photo, 6 free of 6/ })).toHaveLength(6)
  })

  it('shows the screen error with a reference when the list fails', async () => {
    server.use(http.get(apiUrl('/v1/me/photos'), () => apiError(500, 'internal_error', 'Boom')))
    renderManager()
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.getByText(/Reference: mock-/)).toBeInTheDocument()
  })

  it('labels every status and lists the rejection messages', async () => {
    seedPhotos([
      photo('p1', { status: 'approved', is_primary: true, position: 0 }),
      photo('p2', { status: 'pending_review', position: 1 }),
      photo('p3', { status: 'processing', position: 2, thumb_url: null, medium_url: null }),
      photo('p4', { status: 'rejected', rejection_reason: 'low_quality', position: 3 }),
      photo('p5', { status: 'failed', position: 4, thumb_url: null }),
    ])
    renderManager()
    expect(await screen.findByText('In review')).toBeInTheDocument()
    expect(screen.getByText('Processing...')).toBeInTheDocument()
    expect(screen.getByText('Not approved')).toBeInTheDocument()
    expect(screen.getByText('Could not be read')).toBeInTheDocument()
    expect(
      screen.getByText('This photo is too blurry or too dark. Please upload a clearer one.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'This file could not be read. Upload a JPEG, PNG or WebP photo of at least 400 by 400 pixels.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Photo guidelines' })).toBeInTheDocument()
    // Rejected and failed photos do not count: 3 of 6 used.
    expect(screen.getAllByRole('button', { name: /Add a photo, 3 free of 6/ })).toHaveLength(3)
  })

  it('disables adding at the limit with the caption', async () => {
    seedPhotos(
      Array.from({ length: 6 }, (_, index) =>
        photo(`p${index}`, { position: index, is_primary: index === 0 }),
      ),
    )
    renderManager()
    expect(await screen.findByText('You have reached the maximum of 6 photos.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add a photo/ })).not.toBeInTheDocument()
  })
})

describe('PhotoManager upload', () => {
  it('uploads a photo, shows it processing, polls every 3 seconds and stops when done', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    photoMockState().processingMs = 2000
    renderManager()
    await screen.findByRole('button', { name: 'Open photo 1' })

    await user.upload(screen.getByTestId('photo-input'), jpeg())
    // The confirmed photo replaces the upload slot and waits for processing.
    expect(await screen.findByRole('button', { name: 'Open photo 2' })).toBeInTheDocument()
    expect(screen.getByText('Processing...')).toBeInTheDocument()
    expect(prepareImage).toHaveBeenCalledTimes(1)
    expect(db.ownPhotos).toHaveLength(2)

    const gets = countRequests('get', '/v1/me/photos')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PHOTO_POLL_FAST_MS)
    })
    await waitFor(() => expect(screen.queryByText('Processing...')).not.toBeInTheDocument())
    expect(gets.count).toBeGreaterThanOrEqual(1)
    expect(db.ownPhotos[1]?.status).toBe('approved')

    // Nothing is in progress any more: no further polling.
    const later = gets.count
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PHOTO_POLL_SLOW_MS * 3)
    })
    expect(gets.count).toBe(later)
  })

  it('does not poll for photos waiting for a moderator (08 section 5.2 step 6)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    seedPhotos([photo('p1', { status: 'pending_review', position: 0 })])
    renderManager()
    await screen.findByText('In review')
    const gets = countRequests('get', '/v1/me/photos')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PHOTO_POLL_SLOW_MS * 2)
    })
    expect(gets.count).toBe(0)
  })

  it('polls every 3 seconds for the first minute, then every 15, and never with a live socket', () => {
    const now = Date.parse('2026-11-20T10:00:00Z')
    const processing = (createdAt: string) => [
      photo('p', { status: 'processing', created_at: createdAt }),
    ]
    expect(photoPollInterval(processing('2026-11-20T09:59:30Z'), false, now)).toBe(
      PHOTO_POLL_FAST_MS,
    )
    expect(photoPollInterval(processing('2026-11-20T09:58:00Z'), false, now)).toBe(
      PHOTO_POLL_SLOW_MS,
    )
    expect(photoPollInterval(processing('2026-11-20T09:59:30Z'), true, now)).toBe(false)
    expect(photoPollInterval([photo('p', { status: 'approved' })], false, now)).toBe(false)
    expect(photoPollInterval(undefined, false, now)).toBe(false)
  })

  it('sends the prepared file with exactly the ticket headers', async () => {
    const user = userEvent.setup()
    const puts: (string | null)[] = []
    server.use(
      http.put('https://r2.mock.local/uploads/*', ({ request }) => {
        puts.push(request.headers.get('content-type'))
        return undefined
      }),
    )
    renderManager()
    await screen.findByRole('button', { name: 'Open photo 1' })
    await user.upload(screen.getByTestId('photo-input'), jpeg())
    await screen.findByRole('button', { name: 'Open photo 2' })
    expect(puts).toEqual(['image/jpeg'])
  })

  it('shows the message of a file that fails the checks and frees the slot', async () => {
    const user = userEvent.setup()
    vi.mocked(prepareImage).mockRejectedValueOnce(new ImageError('too_small'))
    renderManager()
    await screen.findByRole('button', { name: 'Open photo 1' })
    await user.upload(screen.getByTestId('photo-input'), jpeg())
    expect(
      await screen.findByText(
        'This photo is too small. Choose one that is at least 400 by 400 pixels.',
      ),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /Add a photo, 5 free of 6/ })).toHaveLength(5),
    )
  })

  it('refuses other file types before preparing them', async () => {
    const user = userEvent.setup({ applyAccept: false })
    renderManager()
    await screen.findByRole('button', { name: 'Open photo 1' })
    await user.upload(
      screen.getByTestId('photo-input'),
      new File(['x'], 'photo.heic', { type: 'image/heic' }),
    )
    expect(await screen.findByText('Choose a JPEG, PNG or WebP photo.')).toBeInTheDocument()
    expect(prepareImage).not.toHaveBeenCalled()
  })

  it('shows the limit message when the API answers limit_reached', async () => {
    const user = userEvent.setup()
    server.use(
      http.post(apiUrl('/v1/me/photos/uploads'), () =>
        apiError(429, 'limit_reached', 'Limit', { details: { limit: 6, used: 6 } }),
      ),
    )
    renderManager()
    await screen.findByRole('button', { name: 'Open photo 1' })
    await user.upload(screen.getByTestId('photo-input'), jpeg())
    expect(await screen.findByText('You have reached the maximum of 6 photos.')).toBeInTheDocument()
    // The limit dialog of the global handler is not opened for this action.
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('shows the rate limit message of 08 section 5.2', async () => {
    const user = userEvent.setup()
    server.use(
      http.post(apiUrl('/v1/me/photos/uploads'), () =>
        apiError(429, 'rate_limited', 'Slow down', { details: { retry_after_seconds: 60 } }),
      ),
    )
    renderManager()
    await screen.findByRole('button', { name: 'Open photo 1' })
    await user.upload(screen.getByTestId('photo-input'), jpeg())
    expect(
      await screen.findByText(
        'You have uploaded many photos in a short time. Please try again later.',
      ),
    ).toBeInTheDocument()
  })

  it('shows "Upload failed" after three rounds and uploads again on "Try again"', async () => {
    const user = userEvent.setup()
    let refuse = true
    server.use(
      http.put('https://r2.mock.local/uploads/*', () =>
        refuse ? new HttpResponse(null, { status: 403 }) : undefined,
      ),
    )
    renderManager()
    await screen.findByRole('button', { name: 'Open photo 1' })
    await user.upload(screen.getByTestId('photo-input'), jpeg())
    expect(await screen.findByText('Upload failed')).toBeInTheDocument()
    expect(db.ownPhotos).toHaveLength(1)

    refuse = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('button', { name: 'Open photo 2' })).toBeInTheDocument()
    expect(screen.queryByText('Upload failed')).not.toBeInTheDocument()
  })

  it('cancels an upload in progress and frees the slot', async () => {
    const user = userEvent.setup()
    server.use(
      http.put('https://r2.mock.local/uploads/*', async () => {
        await delay('infinite')
        return new HttpResponse(null)
      }),
    )
    renderManager()
    await screen.findByRole('button', { name: 'Open photo 1' })
    await user.upload(screen.getByTestId('photo-input'), jpeg())
    const cancel = await screen.findByRole('button', { name: 'Cancel upload' })
    expect(screen.getByText('Uploading...')).toBeInTheDocument()
    await user.click(cancel)
    await waitFor(() => expect(screen.queryByText('Uploading...')).not.toBeInTheDocument())
    expect(screen.getAllByRole('button', { name: /Add a photo, 5 free of 6/ })).toHaveLength(5)
    expect(db.ownPhotos).toHaveLength(1)
  })

  it('runs at most two uploads at a time; the others wait', async () => {
    const user = userEvent.setup()
    server.use(
      http.put('https://r2.mock.local/uploads/*', async () => {
        await delay('infinite')
        return new HttpResponse(null)
      }),
    )
    seedPhotos([])
    renderManager()
    await screen.findByText(/No photos yet/)
    await user.upload(screen.getByTestId('photo-input'), [
      jpeg('a.jpg'),
      jpeg('b.jpg'),
      jpeg('c.jpg'),
    ])
    await waitFor(() => expect(screen.getAllByText('Uploading...')).toHaveLength(2))
    expect(screen.getAllByText('Waiting...')).toHaveLength(1)
  })
})

describe('PhotoManager actions', () => {
  beforeEach(() => {
    seedPhotos([photo('p1', { position: 0, is_primary: true }), photo('p2', { position: 1 })])
  })

  it('moves a photo earlier with the keyboard-accessible menu', async () => {
    const user = userEvent.setup()
    const orders = countRequests('put', '/v1/me/photos/order')
    renderManager()
    const menu = await openMenu(user, 2)
    await user.click(within(menu).getByRole('menuitem', { name: 'Move earlier' }))
    await waitFor(() => expect(orders.count).toBe(1))
    await waitFor(() => expect(db.ownPhotos.map((entry) => entry.id)).toEqual(['p2', 'p1']))
    // Reordering does not change the main photo.
    expect(db.ownPhotos.find((entry) => entry.is_primary)?.id).toBe('p1')
  })

  it('offers no "Move earlier" for the first photo', async () => {
    const user = userEvent.setup()
    renderManager()
    const menu = await openMenu(user, 1)
    expect(within(menu).getByRole('menuitem', { name: 'Move earlier' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('tells the member when the new order cannot be saved', async () => {
    const user = userEvent.setup()
    server.use(
      http.put(apiUrl('/v1/me/photos/order'), () => apiError(500, 'internal_error', 'Boom')),
    )
    renderManager()
    const menu = await openMenu(user, 2)
    await user.click(within(menu).getByRole('menuitem', { name: 'Move earlier' }))
    expect(await screen.findByText('Could not save the new order. Try again.')).toBeInTheDocument()
    expect(screen.queryByText('Something went wrong. Please try again.')).not.toBeInTheDocument()
  })

  it('removes a photo after the confirmation', async () => {
    const user = userEvent.setup()
    renderManager()
    const menu = await openMenu(user, 2)
    await user.click(within(menu).getByRole('menuitem', { name: 'Remove' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove this photo?' })
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }))
    expect(await screen.findByText('Photo removed.')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Open photo 2' })).not.toBeInTheDocument(),
    )
    expect(db.ownPhotos.map((entry) => entry.id)).toEqual(['p1'])
  })

  it('keeps the photo when the removal is cancelled', async () => {
    const user = userEvent.setup()
    renderManager()
    const menu = await openMenu(user, 2)
    await user.click(within(menu).getByRole('menuitem', { name: 'Remove' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(db.ownPhotos).toHaveLength(2)
  })

  it('makes an approved photo the main photo', async () => {
    const user = userEvent.setup()
    renderManager()
    const menu = await openMenu(user, 2)
    await user.click(within(menu).getByRole('menuitem', { name: 'Make main photo' }))
    expect(await screen.findByText('Main photo changed.')).toBeInTheDocument()
    expect(db.ownPhotos.find((entry) => entry.is_primary)?.id).toBe('p2')
  })

  it('warns first when the profile is photo verified', async () => {
    const user = userEvent.setup()
    renderManager({ badges: ['photo_verified'] })
    const menu = await openMenu(user, 2)
    await user.click(within(menu).getByRole('menuitem', { name: 'Make main photo' }))
    const dialog = await screen.findByRole('alertdialog', {
      name: 'This removes the Photo verified badge',
    })
    expect(db.ownPhotos.find((entry) => entry.is_primary)?.id).toBe('p1')
    await user.click(within(dialog).getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Main photo changed.')).toBeInTheDocument()
    expect(db.ownPhotos.find((entry) => entry.is_primary)?.id).toBe('p2')
  })

  it('warns before removing the main photo of a photo-verified profile', async () => {
    const user = userEvent.setup()
    renderManager({ badges: ['photo_verified'] })
    const menu = await openMenu(user, 1)
    await user.click(within(menu).getByRole('menuitem', { name: 'Remove' }))
    const warning = await screen.findByRole('alertdialog', {
      name: 'This removes the Photo verified badge',
    })
    await user.click(within(warning).getByRole('button', { name: 'Continue' }))
    const confirm = await screen.findByRole('alertdialog', { name: 'Remove this photo?' })
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }))
    await screen.findByText('Photo removed.')
    // The next approved photo becomes the main photo (08 section 5.5 rule 2).
    expect(db.ownPhotos.map((entry) => [entry.id, entry.is_primary])).toEqual([['p2', true]])
  })

  it('explains invalid_state when the photo is not approved any more', async () => {
    const user = userEvent.setup()
    server.use(
      http.patch(apiUrl('/v1/me/photos/:photoId'), () =>
        apiError(409, 'invalid_state', 'Not approved', { details: { status: 'rejected' } }),
      ),
    )
    renderManager()
    const menu = await openMenu(user, 2)
    await user.click(within(menu).getByRole('menuitem', { name: 'Make main photo' }))
    expect(
      await screen.findByText('Only an approved photo can be the main photo.'),
    ).toBeInTheDocument()
  })

  it('opens a photo full size with its controls', async () => {
    const user = userEvent.setup()
    renderManager()
    await user.click(await screen.findByRole('button', { name: 'Open photo 2' }))
    const dialog = await screen.findByRole('dialog', { name: 'Photo 2' })
    expect(within(dialog).getByRole('button', { name: 'Make main photo' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Move later' })).toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: 'Move earlier' }))
    await waitFor(() => expect(db.ownPhotos[0]?.id).toBe('p2'))
  })
})
