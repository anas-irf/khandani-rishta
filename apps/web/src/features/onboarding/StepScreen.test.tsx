import { screen, waitFor, within } from '@testing-library/react'
import { http } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { track } from '~/lib/track'
import { db } from '~/mocks/db'
import { apiError, apiUrl, validationError } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderOnboarding } from './test-utils'

vi.mock('~/lib/track', () => ({ track: vi.fn(), flush: vi.fn(async () => undefined) }))

const CONTINUE = '/v1/me/onboarding/continue'

afterEach(() => {
  server.events.removeAllListeners()
  vi.mocked(track).mockClear()
})

function events(name: string) {
  return vi
    .mocked(track)
    .mock.calls.filter(([event]) => event === name)
    .map(([, properties]) => properties)
}

describe('the per-step sequence (07 section 2.4)', () => {
  it('saves, continues the current step, replaces Me and opens the next step', async () => {
    const view = renderOnboarding('/onboarding/education-career')
    expect(await screen.findByRole('heading', { name: 'Education and career' })).toBeInTheDocument()
    await view.user.click(await screen.findByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { name: 'Family' })).toBeInTheDocument()
    expect(view.pathname()).toBe('/onboarding/family')
    expect(view.calls('PUT', '/v1/me/profile/sections/education_career')).toHaveLength(1)
    expect(view.calls('POST', CONTINUE).map((call) => call.body)).toEqual([
      { step: 'education_career' },
    ])
    expect(view.cachedMe()?.profile.onboarding_step).toBe('family')
    expect(events('onboarding_step_viewed')).toEqual([
      { step: 'education_career', mode: 'flow' },
      { step: 'family', mode: 'flow' },
    ])
    expect(events('onboarding_step_completed')).toEqual([
      expect.objectContaining({ step: 'education_career', managed_by: 'self' }),
    ])
  })

  it('does not call continue for an earlier step', async () => {
    const view = renderOnboarding('/onboarding/community')
    await view.user.click(await screen.findByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(view.pathname()).toBe('/onboarding/location'))
    expect(view.calls('PUT', '/v1/me/profile/sections/community')).toHaveLength(1)
    expect(view.calls('POST', CONTINUE)).toHaveLength(0)
  })

  it('in edit mode saves and returns to the review without continue', async () => {
    const view = renderOnboarding('/onboarding/community?edit=true', {
      prepare: () => {
        db.me.profile.onboarding_step = 'review'
      },
    })
    await view.user.click(await screen.findByRole('button', { name: 'Save' }))
    await waitFor(() => expect(view.pathname()).toBe('/onboarding/review'))
    expect(await screen.findByRole('button', { name: 'Create my profile' })).toBeInTheDocument()
    expect(view.calls('POST', CONTINUE)).toHaveLength(0)
    expect(events('onboarding_step_viewed')[0]).toEqual({ step: 'community', mode: 'edit' })
  })

  it('follows another device on 409 invalid_state', async () => {
    const view = renderOnboarding('/onboarding/education-career')
    server.use(
      http.post(apiUrl(CONTINUE), () => {
        db.me.profile.onboarding_step = 'lifestyle'
        return apiError(409, 'invalid_state', 'Moved on', {
          details: { onboarding_step: 'lifestyle' },
        })
      }),
    )
    await view.user.click(await screen.findByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(view.pathname()).toBe('/onboarding/lifestyle'))
    expect(view.cachedMe()?.profile.onboarding_step).toBe('lifestyle')
  })

  it('shows the requirement messages when continue answers validation_failed', async () => {
    const view = renderOnboarding('/onboarding/education-career')
    server.use(
      http.post(apiUrl(CONTINUE), () =>
        validationError([
          { field: 'employment_type', code: 'required', message: 'Select an employment type.' },
        ]),
      ),
    )
    await view.user.click(await screen.findByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Select an employment type.')).toBeInTheDocument()
    expect(view.pathname()).toBe('/onboarding/education-career')
    expect(events('onboarding_validation_failed')).toEqual([
      { step: 'education_career', fields: 'employment_type', codes: 'required' },
    ])
  })

  it('makes a double submission impossible', async () => {
    const view = renderOnboarding('/onboarding/education-career')
    const button = await screen.findByRole('button', { name: 'Continue' })
    await view.user.dblClick(button)
    await waitFor(() => expect(view.pathname()).toBe('/onboarding/family'))
    expect(view.calls('PUT', '/v1/me/profile/sections/education_career')).toHaveLength(1)
    expect(view.calls('POST', CONTINUE)).toHaveLength(1)
  })

  it('disables Continue while offline', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderOnboarding('/onboarding/education-career')
    expect(await screen.findByRole('button', { name: 'Continue' })).toBeDisabled()
    online.mockRestore()
  })
})

describe('navigation rules (07 section 2.5)', () => {
  it('Back opens the previous step without calling the API', async () => {
    const view = renderOnboarding('/onboarding/education-career')
    await view.user.click(await screen.findByRole('button', { name: 'Back' }))
    await waitFor(() => expect(view.pathname()).toBe('/onboarding/location'))
    expect(view.requests).toHaveLength(0)
  })

  it('has no Back on ONB-01', async () => {
    renderOnboarding('/onboarding/account-for', { scenario: 'new' })
    expect(await screen.findByRole('button', { name: 'Continue' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
    expect(events('onboarding_started')).toHaveLength(1)
  })

  it('asks "Discard changes?" when leaving a changed step by Back', async () => {
    const view = renderOnboarding('/onboarding/education-career')
    await view.user.type(await screen.findByLabelText(/^Degree/), 'BS Physics')
    await view.user.click(screen.getByRole('button', { name: 'Back' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Discard changes?' })
    expect(
      within(dialog).getByText('What you entered on this step has not been saved.'),
    ).toBeInTheDocument()
    await view.user.click(within(dialog).getByRole('button', { name: 'Keep editing' }))
    expect(view.pathname()).toBe('/onboarding/education-career')
    expect(screen.getByLabelText(/^Degree/)).toHaveValue('BS Physics')
    await view.user.click(screen.getByRole('button', { name: 'Back' }))
    await view.user.click(await screen.findByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(view.pathname()).toBe('/onboarding/location'))
    expect(view.requests).toHaveLength(0)
  })

  it('"Skip for now" on an untouched step calls continue only', async () => {
    const view = renderOnboarding('/onboarding/family', {
      prepare: () => {
        db.me.profile.onboarding_step = 'family'
      },
    })
    await view.user.click(await screen.findByRole('button', { name: 'Skip for now' }))
    await waitFor(() => expect(view.pathname()).toBe('/onboarding/lifestyle'))
    expect(view.calls('POST', CONTINUE).map((call) => call.body)).toEqual([{ step: 'family' }])
    expect(view.calls('PUT', '/v1/me/profile/sections/family')).toHaveLength(0)
    expect(events('onboarding_step_skipped')).toEqual([{ step: 'family' }])
  })

  it('"Skip for now" with input asks "Save what you entered?"', async () => {
    const view = renderOnboarding('/onboarding/family', {
      prepare: () => {
        db.me.profile.onboarding_step = 'family'
      },
    })
    await view.user.type(await screen.findByLabelText(/^Father's occupation/), 'Teacher')
    await view.user.click(screen.getByRole('button', { name: 'Skip for now' }))
    const dialog = await screen.findByRole('dialog', { name: 'Save what you entered?' })
    await view.user.click(within(dialog).getByRole('button', { name: 'Save and continue' }))
    await waitFor(() => expect(view.pathname()).toBe('/onboarding/lifestyle'))
    expect(view.calls('PUT', '/v1/me/profile/sections/family')).toHaveLength(1)
    expect(db.ownProfile.family.father_occupation).toBe('Teacher')
  })

  it('"Skip without saving" calls continue only', async () => {
    const view = renderOnboarding('/onboarding/family', {
      prepare: () => {
        db.me.profile.onboarding_step = 'family'
      },
    })
    await view.user.type(await screen.findByLabelText(/^Father's occupation/), 'Teacher')
    await view.user.click(screen.getByRole('button', { name: 'Skip for now' }))
    await view.user.click(await screen.findByRole('button', { name: 'Skip without saving' }))
    await waitFor(() => expect(view.pathname()).toBe('/onboarding/lifestyle'))
    expect(view.calls('PUT', '/v1/me/profile/sections/family')).toHaveLength(0)
    expect(db.ownProfile.family.father_occupation).toBeNull()
  })

  it('offers no skip on required steps and in edit mode', async () => {
    renderOnboarding('/onboarding/education-career')
    expect(await screen.findByRole('button', { name: 'Continue' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Skip for now' })).not.toBeInTheDocument()
  })

  it('opens the current step for an unknown step key', async () => {
    const view = renderOnboarding('/onboarding/nowhere')
    await waitFor(() => expect(view.pathname()).toBe('/onboarding/education-career'))
  })
})

describe('ONB-10 identity', () => {
  it('offers "Skip for now" with its note only when the number is not required', async () => {
    const view = renderOnboarding('/onboarding/identity', {
      prepare: () => {
        db.me.profile.onboarding_step = 'identity'
        db.me.config.identity_required = false
      },
    })
    expect(await screen.findByRole('button', { name: 'Skip for now' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'You can add it later from the verification screen. Profiles without it cannot be verified.',
      ),
    ).toBeInTheDocument()
    await view.user.click(screen.getByRole('button', { name: 'Skip for now' }))
    await waitFor(() => expect(view.pathname()).toBe('/onboarding/review'))
    expect(await screen.findByRole('button', { name: 'Create my profile' })).toBeInTheDocument()
  })

  it('saves the number and continues', async () => {
    const view = renderOnboarding('/onboarding/identity', {
      prepare: () => {
        db.me.profile.onboarding_step = 'identity'
      },
    })
    expect(screen.queryByRole('button', { name: 'Skip for now' })).not.toBeInTheDocument()
    await view.user.type(await screen.findByLabelText('CNIC number'), '3520212345672')
    await view.user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(view.pathname()).toBe('/onboarding/review'))
    expect(await screen.findByRole('button', { name: 'Create my profile' })).toBeInTheDocument()
    expect(view.calls('PUT', '/v1/me/identity')).toHaveLength(1)
    expect(view.calls('POST', CONTINUE).map((call) => call.body)).toEqual([{ step: 'identity' }])
  })

  it('shows "Enter the identity number to continue." when continue still needs it', async () => {
    const view = renderOnboarding('/onboarding/identity', {
      prepare: () => {
        db.me.profile.onboarding_step = 'identity'
      },
    })
    server.use(
      http.post(apiUrl(CONTINUE), () =>
        validationError([{ field: 'number', code: 'required', message: 'Number missing.' }]),
      ),
    )
    await view.user.type(await screen.findByLabelText('CNIC number'), '3520212345672')
    await view.user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Enter the identity number to continue.')).toBeInTheDocument()
    expect(view.pathname()).toBe('/onboarding/identity')
  })
})

describe('ONB-09 preferences', () => {
  it('always saves the full preferences, then continues', async () => {
    const view = renderOnboarding('/onboarding/preferences', {
      prepare: () => {
        db.me.profile.onboarding_step = 'preferences'
      },
    })
    expect(
      await screen.findByRole('heading', { name: 'Who are you looking for?' }),
    ).toBeInTheDocument()
    await view.user.click(await screen.findByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(view.pathname()).toBe('/onboarding/identity'))
    expect(view.calls('PUT', '/v1/me/preferences')).toHaveLength(1)
    expect(db.preferences).not.toBeNull()
  })
})
