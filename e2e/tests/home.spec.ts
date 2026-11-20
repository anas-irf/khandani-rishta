import { expect, test } from './fixtures'

test.describe('home page', () => {
  test('shows the name and a coming-soon message', { tag: '@smoke' }, async ({ page }) => {
    await page.goto('/')

    await expect(page).toHaveTitle('Khandani Rishta')
    await expect(page.getByRole('heading', { level: 1, name: 'Khandani Rishta' })).toBeVisible()
    await expect(page.getByText('Coming soon.')).toBeVisible()
  })

  test('has no detectable accessibility issues', async ({ page, makeAxeBuilder }) => {
    await page.goto('/')

    const { violations } = await makeAxeBuilder().analyze()

    expect(violations).toEqual([])
  })
})
