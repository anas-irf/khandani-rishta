import type { Page } from '@playwright/test'
import { expect } from '../fixtures'

/** A window the layout has to hold (DESIGN.md sections 7 and 8, specs/17 section 9.1). */
export interface LayoutViewport {
  name: string
  width: number
  height: number
  /** The reader's own font size, as a multiple of the browser's 16 px. */
  textScale: number
}

export const VIEWPORTS = {
  desktop: { name: '1280x800', width: 1280, height: 800, textScale: 1 },
  breakpoint: { name: '768x1024', width: 768, height: 1024, textScale: 1 },
  phone: { name: '390x844', width: 390, height: 844, textScale: 1 },
  compact: { name: '360x800', width: 360, height: 800, textScale: 1 },
  compactLargeText: { name: '360x800 at 200% text', width: 360, height: 800, textScale: 2 },
} satisfies Record<string, LayoutViewport>

/** The smallest touch target and the primary action of a phone (DESIGN.md 5.2), in CSS px. */
export const TOUCH = 48
export const TOUCH_LARGE = 56
/** Below this width the phone layout applies (specs/17 section 9.1). */
const WIDE_FROM = 768

/** The router's floating button exists in development only, so no check may count it. */
const DEVTOOLS = '.TanStackRouterDevtools, button[aria-label="Open TanStack Router Devtools"]'

/**
 * Raises the browser's default font size, as a reader does in the settings, so every rem on the
 * page follows it. An inline size on `<html>` would also fail hydration. Chromium only, which
 * every project here is.
 */
export async function emulateTextScale(page: Page, scale: number) {
  const session = await page.context().newCDPSession(page)
  await session.send('Page.enable')
  await session.send('Page.setFontSizes', {
    fontSizes: { standard: 16 * scale, fixed: 13 * scale },
  })
}

/** Fonts loaded, no skeleton left, and two frames for the bars to publish their heights. */
export async function settle(page: Page) {
  await expect(page.locator('main [role="status"][aria-busy="true"]')).toHaveCount(0)
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
}

export interface LayoutReport {
  innerWidth: number
  scrollWidth: number
  rootFontSize: number
  /** Boxes that scroll sideways and are not one of the snapping rows of cards. */
  scrollsSideways: string[]
  /** Words outside the window, or cut by a box that hides its overflow. */
  cutWords: string[]
  /** Words split over two lines. */
  brokenWords: string[]
  /** Words sticking out of their own button, link, badge or card. */
  spilledWords: string[]
  /** Controls or cards lying on top of each other. */
  overlapping: string[]
  /** Controls with less than 48 by 48 to tap. */
  smallTargets: string[]
  /** Main actions of a phone less than 56 tall. */
  shortPrimaries: string[]
}

/** Measures the page as rendered. The whole function runs in the browser. */
export async function inspectLayout(page: Page): Promise<LayoutReport> {
  return page.evaluate(
    ({ minimum, large, wideFrom, devtools }) => {
      interface Box {
        left: number
        top: number
        right: number
        bottom: number
      }

      const CONTROLS =
        'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="switch"], [role="tab"]'
      const IGNORED = `${devtools}, script, style, option`
      const root = document.documentElement
      const scrollable = (overflow: string) => overflow === 'auto' || overflow === 'scroll'
      const clips = (overflow: string) => overflow === 'hidden' || overflow === 'clip'

      const nameOf = (element: Element) => {
        const words = element.getAttribute('aria-label') ?? element.textContent ?? ''
        return `${element.tagName.toLowerCase()} "${words.trim().replace(/\s+/g, ' ').slice(0, 40)}"`
      }

      function ancestors(element: Element): Element[] {
        const list: Element[] = []
        for (let node: Element | null = element; node && node !== root; node = node.parentElement) {
          list.push(node)
        }
        return list
      }

      /** Rendered, and not text kept for screen readers (a 1 by 1 box that hides the rest). */
      function isShown(element: Element): boolean {
        if (element.closest(IGNORED)) return false
        if (!element.checkVisibility({ visibilityProperty: true })) return false
        return !ancestors(element).some((node) => {
          const box = node.getBoundingClientRect()
          if (box.width > 1.5 || box.height > 1.5) return false
          const style = getComputedStyle(node)
          return style.position === 'absolute' && style.overflow === 'hidden'
        })
      }

      /** DESIGN.md 6.16 and specs/16 6.10: a repeated name in a phone bar, and a chat preview. */
      function mayBeShortened(element: Element): boolean {
        if (element.closest('[data-preview]')) return true
        return (
          getComputedStyle(element).textOverflow === 'ellipsis' &&
          element.closest('[aria-hidden="true"]') !== null
        )
      }

      /** Whether a word is cut sideways by the window or by a box around it. */
      function cutSideways(element: Element, word: DOMRect): boolean {
        for (const node of ancestors(element)) {
          const style = getComputedStyle(node)
          if (style.display === 'inline') continue
          if (scrollable(style.overflowX) && node.scrollWidth > node.clientWidth + 1) return false
          if (style.overflowX === 'visible' || node === document.body) continue
          const box = node.getBoundingClientRect()
          if (word.left < box.left - 1.5 || word.right > box.right + 1.5) return true
        }
        return word.left < -1 || word.right > window.innerWidth + 1
      }

      /** How far the box of a word may pass its line: half of what the font adds to the line. */
      function slack(element: Element, word: DOMRect): number {
        const line = Number.parseFloat(getComputedStyle(element).lineHeight) || word.height
        return 4 + Math.max(0, (word.height - line) / 2)
      }

      /** Whether a word is cut above or below by a box that hides its overflow. */
      function cutVertically(element: Element, word: DOMRect): boolean {
        const over = slack(element, word)
        for (const node of ancestors(element)) {
          const style = getComputedStyle(node)
          if (style.display === 'inline') continue
          if (scrollable(style.overflowY)) return false
          if (!clips(style.overflowY) || node === document.body) continue
          const box = node.getBoundingClientRect()
          if (word.top < box.top - over || word.bottom > box.bottom + over) return true
        }
        return false
      }

      /** The part of a box that its scrolling and clipping ancestors let through. */
      function visiblePart(element: Element, box: DOMRect): Box | null {
        let { left, top, right, bottom } = box
        for (const node of ancestors(element).slice(1)) {
          if (node === document.body) break
          const style = getComputedStyle(node)
          if (style.display === 'inline') continue
          const around = node.getBoundingClientRect()
          if (style.overflowX !== 'visible') {
            left = Math.max(left, around.left)
            right = Math.min(right, around.right)
          }
          if (style.overflowY !== 'visible') {
            top = Math.max(top, around.top)
            bottom = Math.min(bottom, around.bottom)
          }
        }
        return right - left > 2 && bottom - top > 2 ? { left, top, right, bottom } : null
      }

      /** The sticky or fixed layer an element belongs to: bars cover what scrolls under them. */
      function layerOf(element: Element): Element | null {
        return (
          ancestors(element).find((node) =>
            ['sticky', 'fixed'].includes(getComputedStyle(node).position),
          ) ?? null
        )
      }

      /** Whether `element` sits in an absolute layer above what it shares with `under`. */
      function floatsOver(element: Element, under: Element): boolean {
        for (const node of ancestors(element)) {
          if (node.contains(under)) return false
          if (getComputedStyle(node).position === 'absolute') return true
        }
        return false
      }

      const within = (inner: Box, outer: Box) =>
        inner.left >= outer.left - 1 &&
        inner.right <= outer.right + 1 &&
        inner.top >= outer.top - 1 &&
        inner.bottom <= outer.bottom + 1

      const elements = [...document.body.querySelectorAll('*')].filter(isShown)

      const scrollsSideways = elements
        .filter((element) => {
          if (element.matches('textarea, input, select')) return false
          if (element.scrollWidth <= element.clientWidth + 1) return false
          const style = getComputedStyle(element)
          return scrollable(style.overflowX) && style.scrollSnapType === 'none'
        })
        .map(nameOf)

      const cutWords = new Set<string>()
      const brokenWords = new Set<string>()
      const spilledWords = new Set<string>()
      const texts = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let text = texts.nextNode(); text; text = texts.nextNode()) {
        const element = text.parentElement
        const value = text.textContent ?? ''
        if (!element || !value.trim() || !isShown(element) || mayBeShortened(element)) continue
        const where = nameOf(element)
        const owner = element.closest(
          'a, button, summary, [data-slot="badge"], [data-profile-card]',
        )
        const owned =
          owner &&
          getComputedStyle(owner).display !== 'inline' &&
          !element.closest('[data-slot="count-badge"]')
            ? owner.getBoundingClientRect()
            : null

        for (const token of value.matchAll(/\S+/g)) {
          // An address may break anywhere. A word may break only at a hyphen.
          const address = /[@_/\\]|\w[.:]\w/.test(token[0])
          for (const part of token[0].matchAll(/[^-‐–]+/g)) {
            const start = token.index + part.index
            const range = document.createRange()
            range.setStart(text, start)
            range.setEnd(text, start + part[0].length)
            const boxes = [...range.getClientRects()].filter((box) => box.width > 0.5)
            if (boxes.length === 0) continue
            const found = `"${part[0]}" in ${where}`
            const tops = boxes.map((box) => box.top)
            if (!address && /\p{L}/u.test(part[0]) && Math.max(...tops) - Math.min(...tops) > 4) {
              brokenWords.add(found)
            }
            for (const box of boxes) {
              if (cutSideways(element, box) || cutVertically(element, box)) cutWords.add(found)
              if (!owned) continue
              const sideways = box.left < owned.left - 1.5 || box.right > owned.right + 1.5
              const over = slack(element, box)
              const upright = box.top < owned.top - over || box.bottom > owned.bottom + over
              if (sideways || upright) spilledWords.add(found)
            }
          }
        }
      }

      // A closed select draws its value itself, so no text node shows that it is cut. Like a
      // placeholder, the prompt of an empty one may end in an ellipsis.
      const ink = document.createElement('canvas').getContext('2d')
      for (const element of elements) {
        if (!ink || !(element instanceof HTMLSelectElement) || !element.value) continue
        const style = getComputedStyle(element)
        ink.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
        const value = element.selectedOptions[0]?.text ?? ''
        const padding =
          Number.parseFloat(style.paddingInlineStart) + Number.parseFloat(style.paddingInlineEnd)
        if (ink.measureText(value).width > element.clientWidth - padding + 1) {
          cutWords.add(`"${value}" in a select`)
        }
      }

      // Not `[aria-hidden]` inputs: Radix keeps one behind each checkbox and radio for the form.
      const controls = elements.filter(
        (element) => element.matches(CONTROLS) && !element.matches('[aria-hidden="true"]'),
      )
      const placed = [...controls, ...elements.filter((el) => el.matches('[data-profile-card]'))]
        .map((element) => {
          const style = getComputedStyle(element)
          const raw =
            style.display === 'inline'
              ? [...element.getClientRects()]
              : [element.getBoundingClientRect()]
          const boxes = raw.flatMap((box) => visiblePart(element, box) ?? [])
          return { element, boxes, layer: layerOf(element) }
        })
        .filter((item) => item.boxes.length > 0)

      const overlapping = new Set<string>()
      for (const [index, a] of placed.entries()) {
        for (const b of placed.slice(index + 1)) {
          if (a.element.contains(b.element) || b.element.contains(a.element)) continue
          if (a.layer !== b.layer) continue
          for (const first of a.boxes) {
            for (const second of b.boxes) {
              const x = Math.min(first.right, second.right) - Math.max(first.left, second.left)
              const y = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top)
              if (x <= 2 || y <= 2) continue
              // A control set into a picture that is itself a button (a photo's options, or
              // Request photos on a gallery): one is wholly inside the other, in layers of a stack.
              const stacked = floatsOver(a.element, b.element) || floatsOver(b.element, a.element)
              if (stacked && (within(first, second) || within(second, first))) continue
              overlapping.add(`${nameOf(a.element)} over ${nameOf(b.element)}`)
            }
          }
        }
      }

      // Bars cover what scrolls under them, but never each other. A sticky bar cannot leave the
      // box it is in, so one that does not fit there slides under the bar below it.
      const bars = elements
        .filter((element) => element.matches('[data-sticky-bar]'))
        .filter((element) => ['sticky', 'fixed'].includes(getComputedStyle(element).position))
      for (const [index, bar] of bars.entries()) {
        const first = bar.getBoundingClientRect()
        const sticksToEnd = getComputedStyle(bar).bottom !== 'auto'
        if (
          sticksToEnd &&
          first.top < window.innerHeight &&
          first.bottom > window.innerHeight + 2
        ) {
          overlapping.add(`${nameOf(bar)} past the end of the window`)
        }
        for (const other of bars.slice(index + 1)) {
          if (bar.contains(other) || other.contains(bar)) continue
          const second = other.getBoundingClientRect()
          const x = Math.min(first.right, second.right) - Math.max(first.left, second.left)
          const y = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top)
          if (x > 2 && y > 2) overlapping.add(`${nameOf(bar)} under or over ${nameOf(other)}`)
        }
      }

      const smallTargets = controls.flatMap((element) => {
        let { width, height } = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        // A hit area grown with a pseudo-element: `tap-target`, or a link stretched over its card.
        const grown = getComputedStyle(element, '::after')
        const stretched = grown.content !== 'none' && grown.position === 'absolute'
        if (stretched) {
          width = Math.max(width, Number.parseFloat(grown.width) || 0)
          height = Math.max(height, Number.parseFloat(grown.height) || 0)
        }
        // A label is part of the target of its checkbox, radio or switch.
        if (element.matches('input, button, [role="switch"]')) {
          const own = (element as HTMLInputElement).labels
          for (const label of own ? [...own] : []) {
            const box = label.getBoundingClientRect()
            if (box.height >= minimum - 0.5) {
              width = Math.max(width, box.width)
              height = Math.max(height, box.height)
            }
          }
        }
        // WCAG 2.5.8 leaves out a link inside a sentence, where the line sets the height.
        const sentence = element.parentElement?.textContent?.trim() ?? ''
        const inSentence =
          style.display === 'inline' &&
          !stretched &&
          sentence.length > (element.textContent?.trim().length ?? 0)
        if (inSentence || (width >= minimum - 0.5 && height >= minimum - 0.5)) return []
        return [`${nameOf(element)} is ${Math.round(width)} by ${Math.round(height)}`]
      })

      // DESIGN.md section 1: primary actions on phones are 56 tall.
      const primary = ':is([data-variant="default"], [data-variant="inverse"])'
      const shortPrimaries =
        window.innerWidth >= wideFrom
          ? []
          : elements
              .filter((element) => element.matches(`[data-slot="button"]${primary}`))
              .filter((element) => element.getBoundingClientRect().height < large - 0.5)
              .map(nameOf)

      return {
        innerWidth: window.innerWidth,
        scrollWidth: root.scrollWidth,
        rootFontSize: Number.parseFloat(getComputedStyle(root).fontSize),
        scrollsSideways,
        cutWords: [...cutWords],
        brokenWords: [...brokenWords],
        spilledWords: [...spilledWords],
        overlapping: [...overlapping],
        smallTargets,
        shortPrimaries,
      }
    },
    { minimum: TOUCH, large: TOUCH_LARGE, wideFrom: WIDE_FROM, devtools: DEVTOOLS },
  )
}

/** The rules every screen keeps in every window. Soft, so one run names every defect. */
export async function expectSoundLayout(page: Page, viewport: LayoutViewport, screen: string) {
  await settle(page)
  const layout = await inspectLayout(page)
  const at = `${screen} at ${viewport.name}`

  // A phone widens its window to fit content that is too wide, so the width is checked first.
  expect.soft(layout.innerWidth, `${at}: the window width`).toBe(viewport.width)
  expect
    .soft(layout.scrollWidth, `${at}: no horizontal page overflow`)
    .toBeLessThanOrEqual(layout.innerWidth)
  expect.soft(layout.rootFontSize, `${at}: the root font size`).toBe(16 * viewport.textScale)
  expect.soft(layout.scrollsSideways, `${at}: boxes scrolling sideways`).toEqual([])
  expect.soft(layout.cutWords, `${at}: cut words`).toEqual([])
  expect.soft(layout.brokenWords, `${at}: broken words`).toEqual([])
  expect.soft(layout.spilledWords, `${at}: words outside their control`).toEqual([])
  expect.soft(layout.overlapping, `${at}: overlapping controls or cards`).toEqual([])
  expect.soft(layout.smallTargets, `${at}: touch targets under ${TOUCH}`).toEqual([])
  expect.soft(layout.shortPrimaries, `${at}: main actions under ${TOUCH_LARGE}`).toEqual([])
}

export { DEVTOOLS }
