import { expect, test } from '../fixtures'
import { goTo, signIn } from './helpers'

/**
 * The main member journeys of 16 section 5 against the web app in mock mode: browse, send an
 * interest, accept one, chat, and change a privacy setting.
 */
test.describe('member journeys', () => {
  test('home shows matches, and a match opens the profile', async ({ page }) => {
    await signIn(page)
    await expect(page.getByRole('heading', { name: 'Your matches' })).toBeVisible()
    const firstCard = page.locator('[data-profile-card]').first()
    await firstCard.getByRole('link').first().click()
    await expect(page).toHaveURL(/\/profiles\//)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('accepting a received interest opens the new chat (16 section 5.3)', async ({ page }) => {
    await signIn(page, 'active', '/interests')
    await expect(page).toHaveURL(/\/interests/)
    await page.getByRole('button', { name: 'Accept' }).first().click()
    await expect(page).toHaveURL(/\/chats\/[^/]+$/)
    await expect(page.getByRole('textbox')).toBeVisible()
  })

  test('a sent chat message appears in the conversation (16 section 5.4)', async ({ page }) => {
    await signIn(page, 'active', '/chats')
    await page.getByRole('list', { name: 'Conversations' }).getByRole('link').first().click()
    await expect(page).toHaveURL(/\/chats\/[^/]+$/)
    const composer = page.getByRole('textbox')
    await composer.fill('Assalam o Alaikum, how is your family?')
    await composer.press('Enter')
    await expect(page.getByText('Assalam o Alaikum, how is your family?')).toBeVisible()
  })

  test('a shared profile code link opens that profile (16 section 4.1)', async ({ page }) => {
    await signIn(page)
    // The 11th seeded member of the mock API (apps/web/src/mocks/db.ts).
    await goTo(page, '/p/KR7F00000B')
    await expect(page).toHaveURL(/\/profiles\/[^/]+$/)
    await expect(page.getByRole('heading', { level: 1, name: /Imran Q\./ })).toBeVisible()
  })

  test('privacy settings save', async ({ page }) => {
    await signIn(page, 'active', '/settings/privacy')
    await expect(page).toHaveURL(/\/settings\/privacy/)
    const toggle = page.getByRole('switch').first()
    const before = await toggle.getAttribute('aria-checked')
    await toggle.click()
    await expect(toggle).not.toHaveAttribute('aria-checked', before ?? '')
  })

  test('signing out returns to the landing page', async ({ page, isMobile }) => {
    test.skip(isMobile, 'The account menu is on the wide top bar.')
    await signIn(page)
    await page.getByRole('button', { name: 'Account menu' }).click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/$/)
  })
})
