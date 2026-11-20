import { track } from '~/lib/track'

/**
 * The onboarding funnel events of 07 section 17. Properties never carry personal data. The
 * start time and the skipped steps are kept in `sessionStorage` (no personal data either) so
 * `onboarding_completed` can report the total duration and the skipped steps.
 */

const STORAGE_KEY = 'kr.onboarding.funnel'

type FunnelState = { startedAt: number; skipped: string[]; started: boolean }

function read(): FunnelState | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as FunnelState) : null
  } catch {
    return null
  }
}

function write(state: FunnelState | null) {
  try {
    if (state) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    else window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage unavailable: the events still go out, with less detail.
  }
}

function state(): FunnelState {
  const current = read()
  if (current) return current
  const fresh = { startedAt: Date.now(), skipped: [], started: false }
  write(fresh)
  return fresh
}

/** A step screen is shown; the very first screen of a new profile also starts the funnel. */
export function trackStepViewed(step: string, mode: 'flow' | 'edit', currentStep: string) {
  const funnel = state()
  if (step === 'account_for' && currentStep === 'account_for' && !funnel.started) {
    write({ ...funnel, started: true, startedAt: Date.now() })
    track('onboarding_started')
  }
  track('onboarding_step_viewed', { step, mode })
}

export function trackStepCompleted(step: string, viewedAt: number, managedBy: string | null) {
  track('onboarding_step_completed', {
    step,
    duration_ms: Math.max(0, Date.now() - viewedAt),
    managed_by: managedBy ?? '',
  })
}

export function trackStepSkipped(step: string) {
  const funnel = state()
  if (!funnel.skipped.includes(step)) write({ ...funnel, skipped: [...funnel.skipped, step] })
  track('onboarding_step_skipped', { step })
}

export function trackCompleted(resultGate: string) {
  const funnel = state()
  track('onboarding_completed', {
    result_gate: resultGate,
    total_duration_ms: Math.max(0, Date.now() - funnel.startedAt),
    skipped_steps: funnel.skipped.join(','),
  })
  write(null)
}

export function trackSignedOut(step: string) {
  track('onboarding_signed_out', { step })
}
