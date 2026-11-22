import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { goTo, type Scenario, signIn } from './helpers'
import {
  DEVTOOLS,
  emulateTextScale,
  expectSoundLayout,
  inspectLayout,
  type LayoutViewport,
  settle,
  TOUCH_LARGE,
  VIEWPORTS,
} from './layout'

/**
 * The Mehfil Heritage layout in the windows of DESIGN.md sections 7 and 8: no horizontal
 * overflow, the switch at 768 (specs/17 section 9.1), nothing cut or overlapping, and targets
 * of 48 and more. Each window runs once: phone windows on the phone project (a touch screen
 * with a mobile layout viewport) as `@phone-only`, and what needs a desktop window on the
 * desktop project as `@desktop-only`.
 */

/** The 11th seeded member of the mock API, who can be sent an interest. */
const MEMBER_CODE = 'KR7F00000B'

async function openLanding(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}

async function openHome(page: Page) {
  await signIn(page)
  await expect(page.getByRole('heading', { name: 'Your matches' })).toBeVisible()
  await expect(page.locator('[data-profile-card="full"]').first()).toBeVisible()
}

async function openProfile(page: Page) {
  await signIn(page)
  await goTo(page, `/p/${MEMBER_CODE}`)
  await expect(page).toHaveURL(/\/profiles\/[^/]+$/)
  await expect(page.getByRole('heading', { level: 1, name: /Imran\s+Q\./ })).toBeVisible()
}

async function openReceivedProfile(page: Page) {
  await signIn(page, 'active', '/interests')
  await page.locator('main [data-card-link]').first().click()
  await expect(page).toHaveURL(/\/profiles\/[^/]+$/)
  await expect(page.locator('[data-received-interest]')).toBeVisible()
}

async function openSearch(page: Page) {
  await signIn(page, 'active', '/search')
  await expect(page.getByRole('form', { name: 'Search filters' })).toBeVisible()
}

async function runSearch(page: Page) {
  await openSearch(page)
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  const results = page.getByRole('region', { name: 'Search results' })
  await expect(results.locator('[data-profile-card]').first()).toBeVisible()
}

async function openInterests(page: Page) {
  await signIn(page, 'active', '/interests')
  await expect(page.getByRole('button', { name: 'Accept' }).first()).toBeVisible()
}

async function openChat(page: Page) {
  await signIn(page, 'active', '/chats')
  await page.getByRole('list', { name: 'Conversations' }).getByRole('link').first().click()
  await expect(page).toHaveURL(/\/chats\/[^/?]+/)
  await expect(page.getByRole('log')).toBeVisible()
}

async function openPrivacy(page: Page) {
  await signIn(page, 'active', '/settings/privacy')
  await expect(page.getByRole('switch').first()).toBeVisible()
}

async function openOwnProfile(page: Page) {
  await signIn(page, 'active', '/me')
  await expect(page.getByRole('heading', { name: 'Basics' })).toBeVisible()
}

const KEY_SCREENS = [
  { id: 'PUB-HOME', open: openLanding },
  { id: 'APP-HOME', open: openHome },
  { id: 'APP-PROFILE', open: openProfile },
  { id: 'APP-PROFILE with a received interest', open: openReceivedProfile },
  { id: 'APP-SEARCH', open: openSearch },
  { id: 'APP-SEARCH results', open: runSearch },
  { id: 'APP-INTERESTS', open: openInterests },
  { id: 'APP-CHAT', open: openChat },
  { id: 'SET-PRIVACY', open: openPrivacy },
  { id: 'ME-PROFILE', open: openOwnProfile },
]

const ONBOARDING = [
  ['ONB-01', 'account-for'],
  ['ONB-02', 'basics'],
  ['ONB-03', 'community'],
  ['ONB-04', 'location'],
  ['ONB-05', 'education-career'],
  ['ONB-06', 'family'],
  ['ONB-07', 'lifestyle'],
  ['ONB-08', 'photos'],
  ['ONB-09', 'preferences'],
  ['ONB-10', 'identity'],
  ['ONB-11', 'review'],
] as const

function useWindow(viewport: LayoutViewport) {
  test.use({ viewport: { width: viewport.width, height: viewport.height } })
  test.beforeEach(async ({ page }) => {
    if (viewport.textScale !== 1) await emulateTextScale(page, viewport.textScale)
  })
}

for (const viewport of Object.values(VIEWPORTS)) {
  const tag = viewport.width >= 768 ? '@desktop-only' : '@phone-only'

  test.describe(`layout at ${viewport.name}`, { tag }, () => {
    useWindow(viewport)

    for (const screen of KEY_SCREENS) {
      test(`${screen.id} holds its layout`, async ({ page }) => {
        await screen.open(page)
        await expectSoundLayout(page, viewport, screen.id)
      })
    }

    test('ONB-* every step holds its layout', async ({ page }) => {
      // Eleven screens and the completion in one signed-in session.
      test.setTimeout(150_000)
      await signIn(page, 'onboarding_review')
      for (const [id, slug] of ONBOARDING) {
        await test.step(id, async () => {
          await goTo(page, `/onboarding/${slug}`)
          await expect(page.locator(`[data-screen="${id}"]`)).toBeVisible()
          await expectSoundLayout(page, viewport, id)
        })
      }
      await test.step('ONB-DONE', async () => {
        await page.getByRole('button', { name: 'Create my profile' }).click()
        await expect(page.locator('[data-screen="ONB-DONE"]')).toBeVisible()
        await expectSoundLayout(page, viewport, 'ONB-DONE')
      })
    })
  })
}

for (const viewport of [VIEWPORTS.compact, VIEWPORTS.compactLargeText]) {
  test.describe(`every other screen at ${viewport.name}`, { tag: '@phone-only' }, () => {
    useWindow(viewport)

    const publicPaths = [
      '/how-it-works',
      '/safety',
      '/nikah-guide',
      '/faq',
      '/download',
      '/contact',
      '/terms',
      '/privacy',
      '/community-guidelines',
    ]
    for (const path of publicPaths) {
      test(`${path} holds its layout`, async ({ page }) => {
        await page.goto(path)
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        await expectSoundLayout(page, viewport, path)
      })
    }

    const memberPaths = [
      '/matches',
      '/shortlist',
      '/visitors',
      '/photo-requests',
      '/notifications',
      '/chats',
      '/me/photos',
      '/me/preferences',
      '/me/edit/basics',
      '/me/verification',
      '/me/verification/identity',
      '/me/verification/selfie',
      '/settings',
      '/settings/notifications',
      '/settings/blocked',
      '/settings/contacts',
      '/settings/help',
    ]
    for (const path of memberPaths) {
      test(`${path} holds its layout`, async ({ page }) => {
        await signIn(page)
        await goTo(page, path)
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        await expectSoundLayout(page, viewport, path)
      })
    }

    test.describe('SET-ACCOUNT', () => {
      // "No export yet" is a 404 of the API, which the browser logs.
      test.use({ allowedPageErrors: [[/status of 404/], { scope: 'test' }] })

      test('/settings/account holds its layout', async ({ page }) => {
        await signIn(page, 'active', '/settings/account')
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        await expectSoundLayout(page, viewport, '/settings/account')
      })
    })

    test('APP-CONNECTION holds its layout', async ({ page }) => {
      await openChat(page)
      await goTo(page, `${new URL(page.url()).pathname}/details`)
      await expect(page.getByRole('heading', { name: 'Connection details' })).toBeVisible()
      await expectSoundLayout(page, viewport, 'APP-CONNECTION')
    })

    const gates: Scenario[] = [
      'new',
      'pending_review',
      'changes_requested',
      'consent_required',
      'suspended',
      'banned',
      'deletion_scheduled',
      'paused',
    ]
    for (const scenario of gates) {
      test(`the first screen of a ${scenario} member holds its layout`, async ({ page }) => {
        await signIn(page, scenario, scenario === 'paused' ? '/search' : '/home')
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        await expectSoundLayout(page, viewport, scenario)
      })
    }
  })
}

/** The windows on both sides of the switch, and the two ends. */
const SWITCH_WIDTHS = [
  { width: 360, wide: false },
  { width: 767, wide: false },
  { width: 768, wide: true },
  { width: 1280, wide: true },
]

async function scrollPageTo(page: Page, position: 'middle' | 'top') {
  await page.evaluate((to) => {
    window.scrollTo(0, to === 'top' ? 0 : document.documentElement.scrollHeight / 2)
  }, position)
}

async function boxOf(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox()
  if (!box) throw new Error(`${selector} is not rendered`)
  return { ...box, bottom: box.y + box.height, end: box.x + box.width }
}

test.describe('the layout switches at 768', { tag: '@desktop-only' }, () => {
  for (const { width, wide } of SWITCH_WIDTHS) {
    test.describe(`at ${width}`, () => {
      const height = 800
      test.use({ viewport: { width, height } })

      test('PUB-HOME has the menu on phones, the links when wide', async ({ page }) => {
        await openLanding(page)
        const header = page.getByRole('banner')
        await expect(header.getByRole('button', { name: 'Open menu' })).toBeVisible({
          visible: !wide,
        })
        await expect(header.getByRole('navigation', { name: 'Main' })).toBeVisible({
          visible: wide,
        })
      })

      test('APP-HOME has the two phone bars, or the wide top bar', async ({ page }) => {
        await openHome(page)
        const bottomNav = '[data-slot="bottom-nav"]'
        const phoneBar = '[data-slot="home-top-bar"]'
        const topBar = '[data-slot="top-bar"]'
        await expect(page.locator(topBar)).toBeVisible({ visible: wide })
        await expect(page.locator(phoneBar)).toBeVisible({ visible: !wide })
        await expect(page.locator(bottomNav)).toBeVisible({ visible: !wide })

        await scrollPageTo(page, 'middle')
        if (wide) {
          await expect.poll(async () => (await boxOf(page, topBar)).y).toBeCloseTo(0, 0)
          expect((await boxOf(page, topBar)).height).toBeGreaterThanOrEqual(80)
          await expect(page.locator(topBar).getByRole('link', { name: /^Home/ })).toBeVisible()
          return
        }
        await expect.poll(async () => (await boxOf(page, phoneBar)).y).toBeCloseTo(0, 0)
        expect((await boxOf(page, phoneBar)).height).toBeGreaterThanOrEqual(64)
        const nav = await boxOf(page, bottomNav)
        expect(nav.bottom).toBeCloseTo(height, 0)
        expect(nav.height).toBeGreaterThanOrEqual(64)

        // Five labels, at least 6 apart (DESIGN.md 6.17).
        const labels = await page.locator(`${bottomNav} a`).evaluateAll((links) =>
          links.map((link) => {
            const label = [...link.childNodes].find(
              (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
            )
            if (!label) throw new Error('a tab has no label')
            const range = document.createRange()
            range.selectNodeContents(label)
            const { left, right, top } = range.getBoundingClientRect()
            return { left, right, top }
          }),
        )
        expect(labels).toHaveLength(5)
        for (const [index, label] of labels.entries()) {
          const previous = labels[index - 1]
          if (!previous || Math.abs(previous.top - label.top) > 4) continue
          expect(label.left - previous.right).toBeGreaterThanOrEqual(6)
        }
      })

      test('APP-PROFILE has the bottom action bar, or the side rail', async ({ page }) => {
        await openProfile(page)
        const actionBar = '[data-slot="action-bar"][data-action-bar]'
        const rail = '[data-slot="action-rail"]'
        await expect(page.locator('[data-slot="bottom-nav"]')).toBeHidden()
        await expect(page.locator(wide ? rail : actionBar)).toBeVisible()
        await expect(page.locator(wide ? actionBar : rail)).toBeHidden()

        const actions = page.locator(wide ? rail : actionBar)
        const primary = await actions.getByRole('button', { name: 'Send interest' }).boundingBox()
        expect(primary?.height).toBeGreaterThanOrEqual(TOUCH_LARGE)

        if (wide) {
          const title = await page.getByRole('heading', { level: 1 }).boundingBox()
          expect((await boxOf(page, rail)).x).toBeGreaterThanOrEqual(
            (title?.x ?? width) + (title?.width ?? 0),
          )
          await scrollPageTo(page, 'middle')
          await expect.poll(async () => (await boxOf(page, rail)).y).toBeGreaterThan(0)
          const bar = await boxOf(page, '[data-slot="top-bar"]')
          expect((await boxOf(page, rail)).y).toBeGreaterThanOrEqual(bar.bottom)
          return
        }
        const onScreen = async () => (await boxOf(page, actionBar)).bottom
        await expect.poll(onScreen).toBeCloseTo(height, 0)
        await scrollPageTo(page, 'middle')
        await expect.poll(onScreen).toBeCloseTo(height, 0)
        const phoneBar = await boxOf(page, '[data-slot="profile-top-bar"]')
        expect(phoneBar.y).toBeCloseTo(0, 0)
        expect(phoneBar.height).toBeGreaterThanOrEqual(64)
      })

      test('APP-SEARCH has one view on phones, two when wide', async ({ page }) => {
        await runSearch(page)
        const form = page.getByRole('form', { name: 'Search filters' })
        const filters = page.getByRole('button', { name: /^Filters/ })
        await expect(form).toBeVisible({ visible: wide })
        await expect(filters).toBeVisible({ visible: !wide })
        if (wide) return
        await filters.click()
        await expect(form).toBeVisible()
      })

      test('APP-CHAT fills the window, with the list beside it when wide', async ({ page }) => {
        await openChat(page)
        await settle(page)
        const list = page.getByRole('list', { name: 'Conversations' })
        await expect(list).toBeVisible({ visible: wide })
        const composer = await page.getByRole('textbox', { name: 'Message' }).boundingBox()
        expect(composer).not.toBeNull()
        expect((composer?.y ?? height) + (composer?.height ?? 0)).toBeLessThanOrEqual(height)
        // The messages scroll, not the page.
        expect(
          await page.evaluate(() => document.documentElement.scrollHeight),
        ).toBeLessThanOrEqual(height + 1)
        if (!wide) return
        const listBox = await list.boundingBox()
        const log = await page.getByRole('log').boundingBox()
        expect(log?.x ?? 0).toBeGreaterThanOrEqual((listBox?.x ?? 0) + (listBox?.width ?? width))
      })
    })
  }
})

test.describe('type and accessibility', { tag: '@desktop-only' }, () => {
  test('body text is Source Sans 3 at 17, and display text Instrument Serif', async ({ page }) => {
    await openLanding(page)
    await settle(page)
    const type = await page.evaluate(() => {
      const body = getComputedStyle(document.body)
      const title = document.querySelector('h1')
      return {
        family: body.fontFamily,
        size: body.fontSize,
        display: title ? getComputedStyle(title).fontFamily : '',
        loaded: [...document.fonts]
          .filter((font) => font.status === 'loaded')
          .map((font) => font.family.replaceAll('"', '')),
      }
    })
    expect(type.family).toContain('Source Sans 3')
    expect(type.size).toBe('17px')
    expect(type.display).toContain('Instrument Serif')
    expect(type.loaded).toContain('Source Sans 3 Variable')
    expect(type.loaded).toContain('Instrument Serif')
  })

  for (const viewport of [VIEWPORTS.desktop, VIEWPORTS.phone]) {
    test.describe(`at ${viewport.name}`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } })
      for (const screen of KEY_SCREENS) {
        test(`${screen.id} has no detectable accessibility issues`, async ({
          page,
          makeAxeBuilder,
        }) => {
          await screen.open(page)
          await settle(page)
          let scan = makeAxeBuilder()
          for (const selector of DEVTOOLS.split(', ')) scan = scan.exclude(selector)
          const { violations } = await scan.analyze()
          expect(violations).toEqual([])
        })
      }
    })
  }

  test('the layout checks catch planted defects', async ({ page }) => {
    // A phone's window, where every rule applies.
    await page.setViewportSize({ width: VIEWPORTS.phone.width, height: VIEWPORTS.phone.height })
    await openLanding(page)
    await settle(page)
    await page.evaluate(() => {
      const plant = (html: string) => {
        const host = document.createElement('div')
        host.innerHTML = html
        document.body.append(host)
      }
      plant('<div style="width:150vw">too wide</div>')
      plant('<p style="width:40px;overflow:hidden;white-space:nowrap">clippedlabel</p>')
      plant('<p style="width:30px;overflow-wrap:anywhere">khandani</p>')
      plant('<button style="width:56px;height:56px;white-space:nowrap">spillinglabel</button>')
      plant(
        '<button style="width:60px;height:60px">one</button><button style="width:60px;height:60px;margin-left:-30px">two</button>',
      )
      plant('<button style="width:20px;height:20px">x</button>')
      plant(
        '<button data-slot="button" data-variant="default" style="width:120px;height:48px">short</button>',
      )
      plant('<div style="width:80px;overflow-x:auto"><div style="width:300px">pane</div></div>')
    })
    const found = await inspectLayout(page)
    expect(found.scrollWidth).toBeGreaterThan(found.innerWidth)
    expect(found.cutWords.join()).toContain('clippedlabel')
    expect(found.brokenWords.join()).toContain('khandani')
    expect(found.spilledWords.join()).toContain('spillinglabel')
    expect(found.overlapping.join()).toContain('"two"')
    expect(found.smallTargets.join()).toContain('"x"')
    expect(found.shortPrimaries.join()).toContain('"short"')
    expect(found.scrollsSideways.join()).toContain('pane')
  })
})
