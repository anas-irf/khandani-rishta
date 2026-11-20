import type { Me } from '~/lib/api-types'
import { ONBOARDING_STEPS, type OnboardingStep, stepIndex } from '~/lib/gate'

/** The steps, their screens and groups (07 sections 2.2 and 2.3). */

export const SCREEN_IDS: Record<OnboardingStep, string> = {
  account_for: 'ONB-01',
  basics: 'ONB-02',
  community: 'ONB-03',
  location: 'ONB-04',
  education_career: 'ONB-05',
  family: 'ONB-06',
  lifestyle: 'ONB-07',
  photos: 'ONB-08',
  preferences: 'ONB-09',
  identity: 'ONB-10',
  review: 'ONB-11',
}

export const STEP_GROUPS: { key: string; steps: OnboardingStep[] }[] = [
  { key: 'about', steps: ['account_for', 'basics', 'community', 'location'] },
  { key: 'background', steps: ['education_career', 'family', 'lifestyle'] },
  { key: 'photos_preferences', steps: ['photos', 'preferences'] },
  { key: 'verify_finish', steps: ['identity', 'review'] },
]

export const SECTION_STEPS = [
  'account_for',
  'basics',
  'community',
  'location',
  'education_career',
  'family',
  'lifestyle',
] as const

export type SectionStep = (typeof SECTION_STEPS)[number]

export function isSectionStep(step: string): step is SectionStep {
  return (SECTION_STEPS as readonly string[]).includes(step)
}

export function groupOf(step: OnboardingStep) {
  return STEP_GROUPS.find((group) => group.steps.includes(step)) ?? STEP_GROUPS[0]
}

/**
 * Steps completed in each group: a step is completed when its index is lower than the index
 * of `Me.profile.onboarding_step` (07 section 2.3).
 */
export function groupProgress(currentStep: string) {
  const current = stepIndex(currentStep)
  return STEP_GROUPS.map((group) => ({
    key: group.key,
    total: group.steps.length,
    done: group.steps.filter((step) => stepIndex(step) < current).length,
  }))
}

/** Whether the step offers a skip control (07 section 2.2). */
export function isSkippable(step: OnboardingStep, config: Me['config']): boolean {
  if (step === 'family' || step === 'lifestyle') return true
  if (step === 'photos') return !config.photo_required
  if (step === 'identity') return !config.identity_required
  return false
}

export function previousStep(step: OnboardingStep): OnboardingStep | null {
  return ONBOARDING_STEPS[stepIndex(step) - 1] ?? null
}

export function nextStep(step: OnboardingStep): OnboardingStep {
  return ONBOARDING_STEPS[stepIndex(step) + 1] ?? 'review'
}
