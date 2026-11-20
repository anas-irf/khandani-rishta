import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import type { ProfileDetail } from '~/lib/api-types'
import { db } from '~/mocks/db'
import { makePhotoView, makeProfileCard, makeProfileDetail } from '~/mocks/factories'
import { apiError, apiUrl } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderWithProviders } from '~/test/render'
import { PhotoViewer } from './PhotoViewer'
import { ProfileByCode } from './ProfileByCode'

const ID = '10000000-0000-4000-8000-0000000000bb'

const photos = [
  makePhotoView({
    id: 'p1',
    is_primary: true,
    large_url: 'https://r2.test/l1.jpg',
    medium_url: 'https://r2.test/m1.jpg',
  }),
  makePhotoView({
    id: 'p2',
    is_primary: false,
    large_url: 'https://r2.test/l2.jpg',
    medium_url: 'https://r2.test/m2.jpg',
  }),
  makePhotoView({
    id: 'p3',
    is_primary: false,
    large_url: 'https://r2.test/l3.jpg',
    medium_url: 'https://r2.test/m3.jpg',
  }),
]

function viewerDetail(overrides: Partial<ProfileDetail> = {}): ProfileDetail {
  return makeProfileDetail({
    card: makeProfileCard({ id: ID, display_name: 'Bilal K.', photo: photos[0] ?? null }),
    photos,
    ...overrides,
  })
}

function renderViewer(detail: ProfileDetail, index?: number) {
  server.use(http.get(apiUrl('/v1/profiles/:id'), () => HttpResponse.json(detail)))
  return renderWithProviders(() => <PhotoViewer profileId={ID} index={index} />, {
    me: db.me,
    path: `/profiles/${ID}/photos`,
  })
}

function currentImage() {
  return document.querySelector('img[data-viewer-photo]') as HTMLImageElement | null
}

describe('APP-PHOTOS', () => {
  it('opens at the index with the large variant and a position indicator', async () => {
    renderViewer(viewerDetail(), 1)
    expect(await screen.findByRole('dialog', { name: 'Photos of Bilal K.' })).toBeInTheDocument()
    expect(screen.getByText('2 of 3')).toBeInTheDocument()
    expect(currentImage()).toHaveAttribute('src', 'https://r2.test/l2.jpg')
    expect(currentImage()).toHaveAttribute('draggable', 'false')
    expect(screen.queryByRole('link', { name: /download/i })).toBeNull()
  })

  it('moves with the arrow keys and the buttons, and keeps the index in the URL', async () => {
    const user = userEvent.setup()
    const { router } = renderViewer(viewerDetail(), 0)
    const dialog = await screen.findByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'ArrowRight' })
    expect(await screen.findByText('2 of 3')).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.search).toEqual({ index: 1 }))
    await user.click(screen.getByRole('button', { name: 'Next photo' }))
    expect(screen.getByText('3 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next photo' })).toBeDisabled()
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' })
    expect(screen.getByText('2 of 3')).toBeInTheDocument()
  })

  it('moves with a swipe', async () => {
    renderViewer(viewerDetail(), 0)
    await screen.findByRole('dialog')
    const area = currentImage()?.parentElement as HTMLElement
    fireEvent.pointerDown(area, { clientX: 300 })
    fireEvent.pointerUp(area, { clientX: 100 })
    expect(await screen.findByText('2 of 3')).toBeInTheDocument()
  })

  it('shows the medium variant and the access overlay on a blurred photo', async () => {
    const blurred = makePhotoView({
      id: 'b1',
      is_blurred: true,
      large_url: null,
      medium_url: 'https://r2.test/blur.jpg',
    })
    renderViewer(
      viewerDetail({
        photos: [blurred],
        locked: ['photos'],
        relation: { ...viewerDetail().relation, photo_access: 'can_request' },
      }),
    )
    await screen.findByRole('dialog')
    expect(currentImage()).toHaveAttribute('src', 'https://r2.test/blur.jpg')
    expect(screen.getByText("Bilal K.'s photos are private")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Request photos' })).toBeInTheDocument()
  })

  it('a photo that fails to load offers "Try again", which refetches the profile', async () => {
    const user = userEvent.setup()
    let loads = 0
    const detail = viewerDetail()
    server.use(
      http.get(apiUrl('/v1/profiles/:id'), () => {
        loads += 1
        return HttpResponse.json(detail)
      }),
    )
    renderWithProviders(() => <PhotoViewer profileId={ID} />, { me: db.me })
    await screen.findByRole('dialog')
    fireEvent.error(currentImage() as HTMLImageElement)
    expect(await screen.findByText('Could not load this photo.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(loads).toBe(2))
  })

  it('closes back to the profile without history', async () => {
    const user = userEvent.setup()
    const { router } = renderViewer(viewerDetail())
    await user.click(await screen.findByRole('button', { name: 'Close' }))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/profiles/${ID}`))
  })

  it('reports a photo with the photo subject', async () => {
    const user = userEvent.setup()
    renderViewer(viewerDetail())
    await user.click(await screen.findByRole('button', { name: 'Report photo' }))
    expect(await screen.findByText('Report Bilal K.')).toBeInTheDocument()
  })

  it('answers not_found with "This is no longer available."', async () => {
    server.use(http.get(apiUrl('/v1/profiles/:id'), () => apiError(404, 'not_found', 'Gone')))
    renderWithProviders(() => <PhotoViewer profileId={ID} />, { me: db.me })
    expect(await screen.findByText('This is no longer available.')).toBeInTheDocument()
  })
})

describe('/p/$publicCode', () => {
  it('resolves the code and replaces the URL with the profile', async () => {
    const member = [...db.profiles.values()].find((p) => p.relation.tier === 'member')
    const code = member?.card.public_code ?? ''
    const { router } = renderWithProviders(
      () => <ProfileByCode publicCode={code.toLowerCase()} />,
      {
        me: db.me,
        path: `/p/${code}`,
      },
    )
    await waitFor(() => expect(router.state.location.pathname).toBe(`/profiles/${member?.card.id}`))
  })

  it('says when no profile with this code is available', async () => {
    renderWithProviders(() => <ProfileByCode publicCode="KR00000000" />, { me: db.me })
    expect(
      await screen.findByText('No profile with this code is available to you.'),
    ).toBeInTheDocument()
  })
})
