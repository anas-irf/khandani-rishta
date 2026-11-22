import { expect, test as setup } from '@playwright/test'

/**
 * Runs once, before the journeys (playwright.config.ts). The dev server compiles what it serves
 * on the first visit. When every worker makes that visit at the same moment it takes longer than
 * an assertion waits, so this one visit compiles the public page, the sign-in and the signed-in
 * shell first.
 */
setup('the dev server has compiled the app', async ({ page }) => {
  const compiled = { timeout: 120_000 }
  await page.goto('/', compiled)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible(compiled)
  await page.goto('/chats', compiled)
  await expect(page).toHaveURL(/\/sign-in/, compiled)
  await page.getByRole('button', { name: 'Continue as test member' }).click(compiled)
  await expect(page.getByRole('list', { name: 'Conversations' })).toBeVisible(compiled)
})
