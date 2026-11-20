import { describe, expect, it } from 'vitest'
import { makeMe } from '~/mocks/factories'
import type { Gate, Me } from './api-types'
import {
  allowedForGate,
  gateHome,
  matchesPrefix,
  ONBOARDING_STEPS,
  onboardingPath,
  resolveRedirect,
  statusPanelFor,
} from './gate'

function me(gate: Gate, onboardingStep: Me['profile']['onboarding_step'] = 'done') {
  return makeMe({ gate, profile: { onboarding_step: onboardingStep } })
}

describe('gateHome (17 section 4.2)', () => {
  it.each([
    ['banned', '/account/blocked'],
    ['suspended', '/account/blocked'],
    ['deletion_scheduled', '/account/deletion'],
    ['consent_required', '/account/consent'],
    ['changes_requested', '/account/changes'],
    ['pending_review', '/account/review'],
    ['ok', '/home'],
  ] as const)('sends %s to %s', (gate, path) => {
    expect(gateHome(me(gate))).toBe(path)
  })

  it.each(ONBOARDING_STEPS.map((step) => [step, `/onboarding/${step.replaceAll('_', '-')}`]))(
    'sends onboarding at %s to %s',
    (step, path) => {
      expect(gateHome(me('onboarding', step))).toBe(path)
    },
  )

  it('falls back to the first step for an unknown step', () => {
    expect(onboardingPath('something_new')).toBe('/onboarding/account-for')
  })
})

describe('matchesPrefix', () => {
  it('matches the prefix itself and paths below it only', () => {
    expect(matchesPrefix('/me', '/me')).toBe(true)
    expect(matchesPrefix('/me/edit/basics', '/me')).toBe(true)
    expect(matchesPrefix('/messages', '/me')).toBe(false)
  })
})

describe('allowedForGate (17 section 4.2)', () => {
  describe.each(['banned', 'suspended'] as const)('%s', (gate) => {
    it.each([
      ['/account/blocked', true],
      ['/settings/help', true],
      ['/home', false],
      ['/settings', false],
      ['/settings/account', false],
      ['/account/deletion', false],
      ['/me', false],
      ['/admin', false],
      ['/onboarding/basics', false],
    ])('%s -> %s', (path, allowed) => {
      expect(allowedForGate(me(gate), path)).toBe(allowed)
    })
  })

  describe('deletion_scheduled', () => {
    it.each([
      ['/account/deletion', true],
      ['/settings/help', true],
      ['/account/blocked', false],
      ['/home', false],
      ['/settings/account', false],
      ['/admin', false],
    ])('%s -> %s', (path, allowed) => {
      expect(allowedForGate(me('deletion_scheduled'), path)).toBe(allowed)
    })
  })

  describe('consent_required', () => {
    it.each([
      ['/account/consent', true],
      ['/settings/help', false],
      ['/home', false],
      ['/me', false],
      ['/admin', true],
    ])('%s -> %s', (path, allowed) => {
      expect(allowedForGate(me('consent_required'), path)).toBe(allowed)
    })
  })

  describe('onboarding', () => {
    const atLocation = me('onboarding', 'location')

    it('allows /onboarding itself (it redirects to the current step)', () => {
      expect(allowedForGate(atLocation, '/onboarding')).toBe(true)
    })

    it('allows the current step and every earlier step', () => {
      for (const slug of ['account-for', 'basics', 'community', 'location']) {
        expect(allowedForGate(atLocation, `/onboarding/${slug}`)).toBe(true)
      }
    })

    it('refuses later steps', () => {
      for (const slug of ['education-career', 'family', 'photos', 'review']) {
        expect(allowedForGate(atLocation, `/onboarding/${slug}`)).toBe(false)
      }
    })

    it('refuses /onboarding/done, unknown steps and app routes', () => {
      expect(allowedForGate(atLocation, '/onboarding/done')).toBe(false)
      expect(allowedForGate(atLocation, '/onboarding/not-a-step')).toBe(false)
      expect(allowedForGate(atLocation, '/home')).toBe(false)
      expect(allowedForGate(atLocation, '/me')).toBe(false)
      expect(allowedForGate(atLocation, '/account/review')).toBe(false)
    })

    it('allows help and admin', () => {
      expect(allowedForGate(atLocation, '/settings/help')).toBe(true)
      expect(allowedForGate(atLocation, '/admin')).toBe(true)
    })

    it('allows every step when the current step is review', () => {
      const atReview = me('onboarding', 'review')
      for (const step of ONBOARDING_STEPS) {
        expect(allowedForGate(atReview, `/onboarding/${step.replaceAll('_', '-')}`)).toBe(true)
      }
    })
  })

  describe.each([
    ['changes_requested', '/account/changes', '/account/review'],
    ['pending_review', '/account/review', '/account/changes'],
  ] as const)('%s', (gate, own, other) => {
    it.each([
      [own, true],
      [other, false],
      ['/me', true],
      ['/me/edit/basics', true],
      ['/me/photos', true],
      ['/me/preferences', true],
      ['/me/verification', true],
      ['/me/verification/identity', true],
      ['/me/verification/selfie', true],
      ['/settings', true],
      ['/settings/privacy', true],
      ['/settings/notifications', true],
      ['/settings/contacts', true],
      ['/settings/account', true],
      ['/settings/help', true],
      ['/settings/blocked', false],
      ['/notifications', true],
      ['/home', false],
      ['/search', false],
      ['/chats', false],
      ['/interests', false],
      ['/onboarding/basics', false],
      ['/admin', true],
    ])('%s -> %s', (path, allowed) => {
      expect(allowedForGate(me(gate), path)).toBe(allowed)
    })
  })

  describe('ok', () => {
    it.each([
      ['/home', true],
      ['/matches', true],
      ['/search', true],
      ['/profiles/abc', true],
      ['/profiles/abc/photos', true],
      ['/p/KR7Q2M', true],
      ['/interests', true],
      ['/chats', true],
      ['/chats/abc', true],
      ['/chats/abc/details', true],
      ['/shortlist', true],
      ['/visitors', true],
      ['/notifications', true],
      ['/photo-requests', true],
      ['/me', true],
      ['/settings/blocked', true],
      ['/admin/reports', true],
      ['/onboarding/done', true],
      ['/onboarding', false],
      ['/onboarding/basics', false],
      ['/account/review', false],
      ['/account/blocked', false],
    ])('%s -> %s', (path, allowed) => {
      expect(allowedForGate(me('ok'), path)).toBe(allowed)
    })
  })

  it('ignores a trailing slash', () => {
    expect(allowedForGate(me('ok'), '/home/')).toBe(true)
    expect(allowedForGate(me('banned'), '/account/blocked/')).toBe(true)
  })
})

describe('resolveRedirect', () => {
  it('returns null for an allowed path', () => {
    expect(resolveRedirect(me('ok'), '/home')).toBeNull()
  })

  it('returns the gate home for a refused path', () => {
    expect(resolveRedirect(me('pending_review'), '/home')).toBe('/account/review')
    expect(resolveRedirect(me('onboarding', 'basics'), '/onboarding/review')).toBe(
      '/onboarding/basics',
    )
    expect(resolveRedirect(me('ok'), '/onboarding/basics')).toBe('/home')
  })
})

describe('statusPanelFor (17 section 4.3)', () => {
  it.each([
    ['active', 'browse', null],
    ['active', 'engage', null],
    ['paused', 'browse', 'paused'],
    ['paused', 'engage', null],
    ['paused', 'connected', null],
    ['closed', 'browse', 'closed'],
    ['closed', 'engage', 'closed'],
    ['closed', 'connected', null],
    ['closed', 'open', null],
  ] as const)('%s profile on a %s screen -> %s', (status, level, panel) => {
    expect(statusPanelFor(status, level)).toBe(panel)
  })
})
