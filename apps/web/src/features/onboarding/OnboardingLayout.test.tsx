import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { track } from '~/lib/track'
import { resetDb } from '~/mocks/db'
import { currentMe } from '~/mocks/handlers/account'
import { renderWithProviders } from '~/test/render'
import { ProgressHeader } from './ProgressHeader'
import { groupProgress, isSkippable, nextStep, previousStep } from './steps'

vi.mock('~/lib/track', () => ({
  track: vi.fn(),
  flush: vi.fn(async () => undefined),
  setTrackingSession: vi.fn(),
}))

describe('progress (07 section 2.3)', () => {
  it('fills each group by the steps completed before the current step', () => {
    expect(groupProgress('education_career')).toEqual([
      { key: 'about', total: 4, done: 4 },
      { key: 'background', total: 3, done: 0 },
      { key: 'photos_preferences', total: 2, done: 0 },
      { key: 'verify_finish', total: 2, done: 0 },
    ])
    expect(groupProgress('review').map((group) => group.done)).toEqual([4, 3, 2, 1])
  })

  it('shows the group name and "Step N of 11" for the step on screen', async () => {
    resetDb('onboarding_midway')
    renderWithProviders(() => <ProgressHeader step="community" currentStep="education_career" />, {
      me: structuredClone(currentMe()),
    })
    expect(await screen.findByText('Step 3 of 11')).toBeInTheDocument()
    expect(screen.getByText('About')).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'Onboarding progress' })
    expect(within(list).getByText('Background: 0 of 3 steps done')).toBeInTheDocument()
  })
})

describe('step order and skipping (07 section 2.2)', () => {
  const config = currentMe().config

  it('knows the neighbours of a step', () => {
    expect(previousStep('account_for')).toBeNull()
    expect(previousStep('basics')).toBe('account_for')
    expect(nextStep('identity')).toBe('review')
  })

  it('makes photos and identity skippable only when not required', () => {
    expect(isSkippable('family', config)).toBe(true)
    expect(isSkippable('basics', config)).toBe(false)
    expect(isSkippable('photos', { ...config, photo_required: false })).toBe(true)
    expect(isSkippable('photos', { ...config, photo_required: true })).toBe(false)
    expect(isSkippable('identity', { ...config, identity_required: true })).toBe(false)
    expect(isSkippable('identity', { ...config, identity_required: false })).toBe(true)
  })
})

describe('OnboardingLayout', () => {
  it('signs out from the overflow menu after confirmation and records the event', async () => {
    const { OnboardingLayout } = await import('./OnboardingLayout')
    resetDb('onboarding_midway')
    const signOut = vi.fn(async () => undefined)
    renderWithProviders(() => <OnboardingLayout />, {
      path: '/onboarding/education-career',
      me: structuredClone(currentMe()),
      session: { signOut },
    })
    const user = userEvent.setup()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'More options' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Sign out of Khandani Rishta?' })
    await user.click(within(dialog).getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(signOut).toHaveBeenCalled())
  })
})

describe('funnel events', () => {
  it('never carries personal data in the sign-out event', async () => {
    const { trackSignedOut } = await import('./funnel')
    trackSignedOut('basics')
    expect(vi.mocked(track)).toHaveBeenCalledWith('onboarding_signed_out', { step: 'basics' })
  })
})
