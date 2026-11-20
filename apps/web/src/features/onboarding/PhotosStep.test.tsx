import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { track } from '~/lib/track'
import { db } from '~/mocks/db'
import { makeOwnPhoto } from '~/mocks/factories'
import { server } from '~/mocks/server'
import { renderOnboarding } from './test-utils'

vi.mock('~/lib/track', () => ({ track: vi.fn(), flush: vi.fn(async () => undefined) }))

afterEach(() => {
  server.events.removeAllListeners()
  vi.mocked(track).mockClear()
})

function atPhotos(prepare?: () => void) {
  return renderOnboarding('/onboarding/photos', {
    prepare: () => {
      db.me.profile.onboarding_step = 'photos'
      db.ownProfile.onboarding_step = 'photos'
      prepare?.()
    },
  })
}

describe('ONB-08 photos', () => {
  it('always sends the photo privacy choice, then continues', async () => {
    const view = atPhotos(() => {
      db.ownPhotos = [makeOwnPhoto({ status: 'pending_review' })]
    })
    expect(await screen.findByRole('heading', { name: 'Photos' })).toBeInTheDocument()
    const choice = await screen.findByRole('radiogroup', { name: 'Who can see the photos?' })
    expect(within(choice).getByRole('radio', { name: /All members/ })).toBeChecked()
    expect(screen.queryByRole('button', { name: 'Add photos later' })).not.toBeInTheDocument()
    await view.user.click(within(choice).getByRole('radio', { name: /Connections only/ }))
    await view.user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(view.pathname()).toBe('/onboarding/preferences'))
    expect(view.calls('PATCH', '/v1/me/privacy').map((call) => call.body)).toEqual([
      { photo_visibility: 'connections' },
    ])
    expect(view.calls('POST', '/v1/me/onboarding/continue').map((call) => call.body)).toEqual([
      { step: 'photos' },
    ])
    expect(vi.mocked(track)).toHaveBeenCalledWith('onboarding_photo_privacy_chosen', {
      photo_visibility: 'connections',
      photo_count: 1,
    })
  })

  it('"Add photos later" asks first, then performs the same two calls', async () => {
    const view = atPhotos()
    await view.user.click(await screen.findByRole('button', { name: 'Add photos later' }))
    const dialog = await screen.findByRole('dialog', { name: 'Continue without a photo?' })
    expect(
      within(dialog).getByText(
        'Profiles with a photo receive far more interest. You can add photos at any time.',
      ),
    ).toBeInTheDocument()
    await view.user.click(within(dialog).getByRole('button', { name: 'Add a photo' }))
    expect(view.requests).toHaveLength(0)
    await view.user.click(screen.getByRole('button', { name: 'Add photos later' }))
    await view.user.click(await screen.findByRole('button', { name: 'Continue without' }))
    await waitFor(() => expect(view.pathname()).toBe('/onboarding/preferences'))
    expect(view.calls('PATCH', '/v1/me/privacy')).toHaveLength(1)
    expect(view.calls('POST', '/v1/me/onboarding/continue')).toHaveLength(1)
    expect(vi.mocked(track)).toHaveBeenCalledWith('onboarding_step_skipped', { step: 'photos' })
  })

  it('needs a photo first when photo_required is on', async () => {
    const view = atPhotos(() => {
      db.me.config.photo_required = true
    })
    expect(
      await screen.findByRole('radiogroup', { name: 'Who can see the photos?' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add photos later' })).not.toBeInTheDocument()
    await view.user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findAllByText('Add at least one photo to continue.')).not.toHaveLength(0)
    expect(view.requests).toHaveLength(0)
  })
})
