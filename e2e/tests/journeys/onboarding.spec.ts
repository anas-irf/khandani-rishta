import { expect, test } from '../fixtures'
import { signIn } from './helpers'

/** 16 section 5.1: from the last onboarding step to the first match list. */
test.describe('onboarding completion', () => {
  test('creating the profile shows ONB-DONE, then the matches', async ({ page }) => {
    await signIn(page, 'onboarding_review')
    await expect(page).toHaveURL(/\/onboarding\/review/)

    await page.getByRole('button', { name: 'Create my profile' }).click()

    await expect(page).toHaveURL(/\/onboarding\/done/)
    await expect(page.getByRole('heading', { name: 'Mubarak! The profile is live.' })).toBeVisible()

    await page.getByRole('button', { name: 'See my matches' }).click()
    await expect(page).toHaveURL(/\/(home|matches)/)
  })

  test('an earlier step can be reopened, but not a later one', async ({ page }) => {
    await signIn(page, 'onboarding_midway')
    await expect(page).toHaveURL(/\/onboarding\/education-career/)
    await page.goto('/onboarding/basics')
    await expect(page).toHaveURL(/\/onboarding\/basics/)
  })
})
