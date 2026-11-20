import { screen, waitFor, within } from '@testing-library/react'
import { http } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { track } from '~/lib/track'
import { db } from '~/mocks/db'
import { makeOwnPhoto, makePreferences } from '~/mocks/factories'
import { apiError, apiUrl } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderOnboarding } from './test-utils'

vi.mock('~/lib/track', () => ({ track: vi.fn(), flush: vi.fn(async () => undefined) }))

afterEach(() => {
  server.events.removeAllListeners()
  vi.mocked(track).mockClear()
})

function atReview(extra?: () => void) {
  return renderOnboarding('/onboarding/review', {
    prepare: () => {
      db.me.profile.onboarding_step = 'review'
      db.ownProfile.onboarding_step = 'review'
      db.preferences = makePreferences({ age_importance: 'must' })
      db.identity = {
        document_type: 'cnic',
        number_masked: '*********1234',
        status: 'unverified',
        verified_at: null,
      }
      extra?.()
    },
  })
}

describe('ONB-11 review', () => {
  it('shows one card per step with Edit links that open the step in edit mode', async () => {
    const view = atReview(() => {
      db.ownProfile.location = { ...db.ownProfile.location, area: 'Gulberg' }
    })
    expect(await screen.findByRole('heading', { name: 'Review and finish' })).toBeInTheDocument()
    const basics = await screen.findByRole('region', { name: 'Basics' })
    expect(within(basics).getByText('Ayesha Khan')).toBeInTheDocument()
    expect(within(basics).getByRole('link', { name: 'Edit: Basics' })).toHaveAttribute(
      'href',
      '/onboarding/basics?edit=true',
    )
    const location = screen.getByRole('region', { name: 'Location' })
    expect(within(location).getByText('Gulberg')).toBeInTheDocument()
    expect(within(location).getAllByText('Private by default').length).toBeGreaterThan(0)
    const family = screen.getByRole('region', { name: 'Family' })
    expect(within(family).getByText('Not added yet')).toBeInTheDocument()
    expect(within(family).getByRole('link', { name: 'Add: Family' })).toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: 'Photos' })).getByText('No photos yet'),
    ).toBeInTheDocument()
    const lookingFor = screen.getByRole('region', { name: 'Looking for' })
    expect(within(lookingFor).getByText('Age: 25 to 32 years')).toBeInTheDocument()
    expect(within(lookingFor).getAllByText('Must have')).toHaveLength(2)
    expect(
      within(screen.getByRole('region', { name: 'Identity' })).getByText('*********1234'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/They cannot be changed after the profile is created/),
    ).toBeInTheDocument()
    await view.user.click(within(basics).getByRole('link', { name: 'Edit: Basics' }))
    await waitFor(() => expect(view.pathname()).toBe('/onboarding/basics'))
    expect(await screen.findByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('shows photo thumbnails with their status labels', async () => {
    atReview(() => {
      db.ownPhotos = [makeOwnPhoto({ status: 'pending_review', is_primary: false })]
    })
    const photos = await screen.findByRole('region', { name: 'Photos' })
    expect(within(photos).getByText('In review')).toBeInTheDocument()
  })

  it('creates the profile and opens ONB-DONE for gate ok', async () => {
    const view = atReview()
    await view.user.click(await screen.findByRole('button', { name: 'Create my profile' }))
    await waitFor(() => expect(view.pathname()).toBe('/onboarding/done'))
    expect(await screen.findByText('Mubarak! The profile is live.')).toBeInTheDocument()
    expect(view.cachedMe()?.gate).toBe('ok')
    expect(vi.mocked(track)).toHaveBeenCalledWith(
      'onboarding_completed',
      expect.objectContaining({ result_gate: 'ok' }),
    )
  })

  it('opens GATE-REVIEW when the profile goes to manual review', async () => {
    const view = atReview(() => {
      db.extra.profileReview = 'manual'
    })
    await view.user.click(await screen.findByRole('button', { name: 'Create my profile' }))
    await waitFor(() => expect(view.pathname()).toBe('/account/review'))
    expect(view.cachedMe()?.gate).toBe('pending_review')
  })

  it('opens the step that owns the first missing field, in edit mode, with the message', async () => {
    const view = atReview(() => {
      db.ownProfile.basics = { ...db.ownProfile.basics, height_cm: null }
    })
    await view.user.click(await screen.findByRole('button', { name: 'Create my profile' }))
    await waitFor(() => expect(view.pathname()).toBe('/onboarding/basics'))
    expect(await screen.findByText('Some details are missing.')).toBeInTheDocument()
    expect(await screen.findByText('Select a height.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('follows the gate on invalid_state', async () => {
    const view = atReview()
    server.use(
      http.post(apiUrl('/v1/me/onboarding/complete'), () => {
        db.me.profile.status = 'active'
        db.me.profile.onboarding_step = 'done'
        return apiError(409, 'invalid_state', 'Already done')
      }),
    )
    await view.user.click(await screen.findByRole('button', { name: 'Create my profile' }))
    await waitFor(() => expect(view.pathname()).toBe('/home'))
  })

  it('shows a server failure inline with Try again', async () => {
    const view = atReview()
    server.use(
      http.post(apiUrl('/v1/me/onboarding/complete'), () =>
        apiError(500, 'internal_error', 'Boom'),
      ),
    )
    await view.user.click(await screen.findByRole('button', { name: 'Create my profile' }))
    expect(
      await screen.findByText(
        'Something went wrong on our side. Your earlier steps are saved. Please try again.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('shows the error state when a summary cannot be loaded', async () => {
    server.use(http.get(apiUrl('/v1/me/preferences'), () => apiError(500, 'internal_error', 'x')))
    atReview()
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
  })
})
