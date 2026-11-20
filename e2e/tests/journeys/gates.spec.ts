import { expect, test } from '../fixtures'
import { signIn } from './helpers'

/**
 * Routing by gate (16 section 3, 17 section 4): wherever a member asks to go, the gate decides.
 * These run against the web app in mock mode (playwright.config.ts).
 */
test.describe('gates', () => {
  test('a signed-out visitor is sent to sign-in and back to the screen they asked for', async ({
    page,
  }) => {
    await page.goto('/chats')
    await expect(page).toHaveURL(/\/sign-in\/?\?redirect_url=%2Fchats/)
    await page.getByRole('button', { name: 'Continue as test member' }).click()
    await expect(page).toHaveURL(/\/chats/)
  })

  test('a new member starts onboarding at the first step', async ({ page }) => {
    await signIn(page, 'new')
    await expect(page).toHaveURL(/\/onboarding\/account-for/)
  })

  test('a member midway through onboarding resumes at the current step', async ({ page }) => {
    await signIn(page, 'onboarding_midway')
    await expect(page).toHaveURL(/\/onboarding\/education-career/)
  })

  test('a profile under review lands on the review screen and cannot browse', async ({ page }) => {
    await signIn(page, 'pending_review', '/search')
    await expect(page).toHaveURL(/\/account\/review/)
  })

  test('a profile with requested changes lands on the changes screen', async ({ page }) => {
    await signIn(page, 'changes_requested')
    await expect(page).toHaveURL(/\/account\/changes/)
    await expect(page.getByText('Please add a clearer description in About me.')).toBeVisible()
  })

  test('updated terms must be accepted first', async ({ page }) => {
    await signIn(page, 'consent_required')
    await expect(page).toHaveURL(/\/account\/consent/)
  })

  test('a suspended member sees the blocked screen with the end date', async ({ page }) => {
    await signIn(page, 'suspended')
    await expect(page).toHaveURL(/\/account\/blocked/)
  })

  test('a banned member cannot leave the blocked screen except for help', async ({ page }) => {
    await signIn(page, 'banned', '/settings/help')
    await expect(page).toHaveURL(/\/settings\/help/)
  })

  test('a member with a scheduled deletion lands on the deletion screen', async ({ page }) => {
    await signIn(page, 'deletion_scheduled')
    await expect(page).toHaveURL(/\/account\/deletion/)
  })

  test('a paused profile sees the status panel instead of search', async ({ page }) => {
    await signIn(page, 'paused', '/search')
    await expect(page.getByRole('heading', { name: 'The profile is paused' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Resume the profile' })).toBeVisible()
  })

  test('the staff console is not found for members and open for admins', async ({ page }) => {
    await signIn(page, 'active', '/admin')
    await expect(page.getByText('The page you are looking for does not exist.')).toBeVisible()
  })
})
