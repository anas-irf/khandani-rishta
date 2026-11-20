import type { Page } from '@playwright/test'
import { expect } from '../fixtures'

/**
 * Situations of the mock API (apps/web/src/mocks/db.ts). Each journey signs in as the test
 * member in one of them; the mock database starts fresh on every page load.
 */
export type Scenario =
  | 'active'
  | 'new'
  | 'onboarding_midway'
  | 'onboarding_review'
  | 'pending_review'
  | 'changes_requested'
  | 'consent_required'
  | 'paused'
  | 'closed'
  | 'suspended'
  | 'banned'
  | 'deletion_scheduled'
  | 'admin'

/** Signs in through the mock sign-in page and waits until the gate has routed the member. */
export async function signIn(page: Page, scenario: Scenario = 'active', target = '/home') {
  await page.goto(`/sign-in?mock_scenario=${scenario}&redirect_url=${encodeURIComponent(target)}`)
  await page.getByRole('button', { name: 'Continue as test member' }).click()
  await expect(page).not.toHaveURL(/\/sign-in/)
}

/** In-app navigation (a full page load would restart the mock database). */
export async function goTo(page: Page, path: string) {
  await page.evaluate((href) => {
    window.history.pushState({}, '', href)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)
  await expect(page).toHaveURL(new RegExp(`${path.replace(/[?]/g, '\\?')}`))
}
