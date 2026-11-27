import { expect, test } from './fixtures'

test.describe('sign-in', () => {
  test('renders the sign-in page', { tag: '@smoke' }, async ({ page }) => {
    const response = await page.goto('/sign-in')

    expect(response?.status()).toBe(200)
    await expect(page).toHaveTitle('Sign in | Khandani Rishta')
    // One page heading: ours when Clerk is not configured (pull request builds), Clerk's own once
    // its card loads (deployed sites).
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByRole('link', { name: 'Khandani Rishta home' })).toHaveAttribute(
      'href',
      '/',
    )
  })

  test('keeps signed-in routes out of search engines', { tag: '@smoke' }, async ({ request }) => {
    const response = await request.get('/home')

    expect(response.headers()['x-robots-tag']).toBe('noindex')
    expect(response.headers()['x-content-type-options']).toBe('nosniff')
  })

  test('sends a signed-out visitor from an app URL to sign-in and back', async ({ page }) => {
    await page.goto('/chats')

    await expect(page).toHaveURL(/\/sign-in\/?\?redirect_url=%2Fchats/)
  })
})
