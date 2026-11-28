import { expect, test } from './fixtures'

/** The public pages of 17 section 3.1, with the title each one sets. */
const publicPages = [
  { path: '/', title: 'Free rishta for Pakistani families | Khandani Rishta' },
  { path: '/how-it-works', title: 'How it works | Khandani Rishta' },
  { path: '/safety', title: 'Safety advice | Khandani Rishta' },
  { path: '/nikah-guide', title: 'Nikah guide | Khandani Rishta' },
  { path: '/faq', title: 'Questions and answers | Khandani Rishta' },
  { path: '/download', title: 'Download the Android app | Khandani Rishta' },
  { path: '/contact', title: 'Contact | Khandani Rishta' },
  { path: '/terms', title: 'Terms of Use | Khandani Rishta' },
  { path: '/privacy', title: 'Privacy Policy | Khandani Rishta' },
  { path: '/community-guidelines', title: 'Community Guidelines | Khandani Rishta' },
]

test.describe('public pages', () => {
  for (const { path, title } of publicPages) {
    test.describe(path, () => {
      test('answers 200 with its own title, one h1 and the GeoNames credit', {
        tag: '@smoke',
      }, async ({ page }) => {
        const response = await page.goto(path)
        expect(response?.status()).toBe(200)

        await expect(page).toHaveTitle(title)
        await expect(page.locator('h1')).toHaveCount(1)
        await expect(page.getByRole('main')).toBeVisible()
        await expect(
          page
            .getByRole('contentinfo')
            .getByText('City data from GeoNames (geonames.org), licensed under CC BY 4.0.'),
        ).toBeVisible()
      })

      test('has a description and Open Graph tags with the brand image', async ({ page }) => {
        await page.goto(path)

        // A real sentence: at least 20 characters, not only whitespace.
        await expect(page.locator('meta[name="description"]')).toHaveAttribute(
          'content',
          /^\s*\S.{19,}/,
        )
        await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', title)
        await expect(page.locator('meta[property="og:description"]')).toHaveAttribute(
          'content',
          /^\s*\S.{19,}/,
        )
        await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
          'content',
          '/og-image.svg',
        )
      })

      test('has no detectable accessibility issues', async ({ page, makeAxeBuilder }) => {
        await page.goto(path)

        const { violations } = await makeAxeBuilder().analyze()

        expect(violations).toEqual([])
      })
    })
  }
})

test.describe('public page frame', () => {
  test('has a header with the main links and the account buttons', { tag: '@smoke' }, async ({
    page,
    isMobile,
  }) => {
    await page.goto('/how-it-works')

    const banner = page.getByRole('banner')
    await expect(banner.getByRole('link', { name: 'Khandani Rishta' })).toHaveAttribute('href', '/')

    if (isMobile) {
      // The page is complete before its scripts run. The header marks itself once React runs it
      // (`useBarHeight` in apps/web/src/lib/media.ts), and only then can the menu open.
      await expect(banner).toHaveAttribute('data-sticky-bar', '')
      await banner.getByRole('button', { name: 'Open menu' }).click()
      const menu = page.getByRole('dialog', { name: 'Menu' })
      for (const name of ['How it works', 'Safety', 'Nikah guide', 'FAQ', 'Download the app']) {
        await expect(menu.getByRole('link', { name })).toBeVisible()
      }
      await expect(menu.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', /\/sign-in/)
      await expect(menu.getByRole('link', { name: 'Create a free profile' })).toHaveAttribute(
        'href',
        /\/sign-in/,
      )
    } else {
      const nav = banner.getByRole('navigation', { name: 'Main' })
      await expect(nav.getByRole('link', { name: 'How it works' })).toBeVisible()
      await expect(nav.getByRole('link', { name: 'Safety' })).toBeVisible()
      await expect(nav.getByRole('link', { name: 'Download the app' })).toBeVisible()
      await expect(banner.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
        'href',
        /\/sign-in/,
      )
      await expect(banner.getByRole('link', { name: 'Create a free profile' })).toHaveAttribute(
        'href',
        /\/sign-in/,
      )
    }
  })

  test('has a skip link that moves focus to the main content', async ({ page }) => {
    await page.goto('/safety')

    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: 'Skip to content' })
    await expect(skip).toBeFocused()
    await expect(skip).toBeVisible()

    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/#main$/)
    await expect(page.locator('main#main')).toBeFocused()
  })

  test('has the footer of every public page', async ({ page }) => {
    await page.goto('/contact')

    const footer = page.getByRole('contentinfo')
    for (const [name, href] of [
      ['How it works', '/how-it-works'],
      ['Safety', '/safety'],
      ['Questions and answers', '/faq'],
      ['Nikah guide', '/nikah-guide'],
      ['Download the app', '/download'],
      ['Terms of Use', '/terms'],
      ['Privacy Policy', '/privacy'],
      ['Community Guidelines', '/community-guidelines'],
      ['Contact', '/contact'],
    ]) {
      await expect(footer.getByRole('link', { name })).toHaveAttribute('href', href)
    }
  })
})

test.describe('page content', () => {
  test('the FAQ answers open on click and the page carries FAQPage data', async ({ page }) => {
    await page.goto('/faq')

    const answer = page.getByText(/We never charge for safety or verification/)
    await expect(answer).toBeHidden()
    await page.getByText('Is Khandani Rishta free?').click()
    await expect(answer).toBeVisible()

    const json = await page.locator('script[type="application/ld+json"]').first().textContent()
    const data = JSON.parse(json ?? '{}')
    expect(data['@type']).toBe('FAQPage')
    expect(data.mainEntity.length).toBeGreaterThanOrEqual(20)
    expect(data.mainEntity[0]['@type']).toBe('Question')
    expect(data.mainEntity[0].acceptedAnswer['@type']).toBe('Answer')
  })

  test.describe('without JavaScript', () => {
    test.use({ javaScriptEnabled: false })

    test('the FAQ answers still open (plain details elements)', async ({ page }) => {
      await page.goto('/faq')

      const answer = page.getByText(/We never charge for safety or verification/)
      await expect(answer).toBeHidden()
      await page.getByText('Is Khandani Rishta free?').click()
      await expect(answer).toBeVisible()
    })
  })

  test('the legal pages say they are waiting for legal review', async ({ page }) => {
    for (const path of ['/terms', '/privacy', '/community-guidelines']) {
      await page.goto(path)
      await expect(page.getByText('Pending legal review')).toBeVisible()
    }
  })

  test('the nikah guide shows its notice and twelve sections', async ({ page }) => {
    await page.goto('/nikah-guide')

    await expect(page.getByText(/It is not legal or religious advice/)).toHaveCount(2)
    await expect(
      page.getByRole('heading', { level: 2 }).filter({ hasText: /^\d+\. / }),
    ).toHaveCount(12)
  })

  test('the download page never breaks, with or without a release', async ({ page }) => {
    await page.goto('/download')

    await expect(
      page.getByRole('heading', { level: 1, name: 'Download the Android app' }),
    ).toBeVisible()
    // Either the release (version, download button) or a clear "not available" message.
    await expect(
      page
        .getByRole('link', { name: 'Download for Android' })
        .or(page.getByText(/The Android app (download )?is not available/)),
    ).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open in the browser' })).toBeVisible()
  })

  test('the contact page shows the support address', async ({ page }) => {
    await page.goto('/contact')

    await expect(page.getByRole('link', { name: /^support@/ })).toHaveAttribute(
      'href',
      /^mailto:support@/,
    )
  })
})

test.describe('crawler files', () => {
  test('robots.txt allows the public pages and hides the application', { tag: '@smoke' }, async ({
    request,
  }) => {
    const response = await request.get('/robots.txt')
    expect(response.status()).toBe(200)

    const lines = (await response.text()).split(/\r?\n/)
    expect(lines).toContain('User-agent: *')
    expect(lines).toContain('Allow: /')
    for (const path of [
      '/home',
      '/matches',
      '/search',
      '/profiles',
      '/interests',
      '/chats',
      '/shortlist',
      '/visitors',
      '/notifications',
      '/photo-requests',
      '/me',
      '/settings',
      '/onboarding',
      '/account',
      '/admin',
      '/sign-in',
    ]) {
      expect(lines, `Disallow: ${path}`).toContain(`Disallow: ${path}`)
    }
    // "/p/" and not "/p", which would also hide /privacy.
    expect(lines).toContain('Disallow: /p/')
    expect(lines).not.toContain('Disallow: /p')
    expect(lines).not.toContain('Disallow: /')
  })

  test('sitemap.xml lists the public pages and nothing else', { tag: '@smoke' }, async ({
    request,
  }) => {
    const response = await request.get('/sitemap.xml')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('xml')

    const xml = await response.text()
    const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1] ?? '')
    const paths = locations.map((loc) => new URL(loc).pathname)

    expect(paths.sort()).toEqual(publicPages.map((entry) => entry.path).sort())
    for (const loc of locations) expect(loc).toMatch(/^https?:\/\//)
    expect(xml).not.toMatch(/\/(home|me|sign-in|admin|profiles)\b/)
  })

  test('assetlinks.json names the Android package and its certificate', async ({ request }) => {
    const response = await request.get('/.well-known/assetlinks.json')
    expect(response.status()).toBe(200)

    const statements = await response.json()
    expect(statements[0].target.namespace).toBe('android_app')
    expect(statements[0].target.package_name).toBe('com.khandanirishta.app')
    // App Links stay unverified unless each entry is a real SHA-256: 32 colon-separated hex bytes.
    const sha256 = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/
    const fingerprints = statements[0].target.sha256_cert_fingerprints
    expect(fingerprints.length).toBeGreaterThan(0)
    for (const fingerprint of fingerprints) expect(fingerprint).toMatch(sha256)
  })

  test('the favicon and the Open Graph image are served', async ({ request }) => {
    for (const path of ['/favicon.svg', '/og-image.svg']) {
      const response = await request.get(path)
      expect(response.status(), path).toBe(200)
      expect(response.headers()['content-type'], path).toContain('svg')
    }
  })
})
