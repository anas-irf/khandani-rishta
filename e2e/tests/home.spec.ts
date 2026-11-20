import { expect, test } from './fixtures'

test.describe('home page', () => {
  test('explains the product and invites sign-up', { tag: '@smoke' }, async ({ page }) => {
    await page.goto('/')

    await expect(page).toHaveTitle('Free rishta for Pakistani families | Khandani Rishta')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Rishta, the khandani way.' }),
    ).toBeVisible()
    await expect(page.getByText('A respectful place for families and individuals')).toBeVisible()

    const create = page.getByRole('link', { name: 'Create a free profile' }).first()
    await expect(create).toBeVisible()
    await expect(create).toHaveAttribute('href', /\/sign-in/)
    await expect(page.getByRole('link', { name: 'How it works' }).first()).toBeVisible()
  })

  test('describes the organisation in structured data', async ({ page }) => {
    await page.goto('/')

    const json = await page.locator('script[type="application/ld+json"]').first().textContent()
    const data = JSON.parse(json ?? '{}')
    expect(data['@type']).toBe('Organization')
    expect(data.name).toBe('Khandani Rishta')
  })

  test('has no detectable accessibility issues', async ({ page, makeAxeBuilder }) => {
    await page.goto('/')

    const { violations } = await makeAxeBuilder().analyze()

    expect(violations).toEqual([])
  })
})
