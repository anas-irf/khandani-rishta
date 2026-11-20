import { expect, test } from './fixtures'

test.describe('unknown pages', () => {
  // The browser reports the 404 response of the page itself as a console error.
  test.use({ allowedPageErrors: [/status of 404/] })

  test('answer 404 and link back to the home page', { tag: '@smoke' }, async ({ page }) => {
    const response = await page.goto('/this-page-does-not-exist')

    expect(response?.status()).toBe(404)
    await expect(page.getByText('The page you are looking for does not exist.')).toBeVisible()

    await page.getByRole('link', { name: 'Home' }).click()
    await expect(page).toHaveURL('/')
  })
})
