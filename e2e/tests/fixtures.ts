import AxeBuilder from '@axe-core/playwright'
import { test as base, expect } from '@playwright/test'

/** WCAG 2.2 level A and AA rules, the usual accessibility target for public sites. */
const wcagTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

interface Fixtures {
  /** Page errors matching one of these patterns don't fail the test. */
  allowedPageErrors: RegExp[]
  /** Builds an axe accessibility scan of the current page. */
  makeAxeBuilder: () => AxeBuilder
  /** Fails the test when the page throws an uncaught exception or logs a console error. */
  failOnPageErrors: undefined
}

export const test = base.extend<Fixtures>({
  allowedPageErrors: [[], { option: true }],

  makeAxeBuilder: async ({ page }, provide) => {
    await provide(() => new AxeBuilder({ page }).withTags(wcagTags))
  },

  failOnPageErrors: [
    async ({ page, allowedPageErrors }, provide) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text())
      })

      await provide(undefined)

      const unexpected = errors.filter(
        (error) => !allowedPageErrors.some((pattern) => pattern.test(error)),
      )
      expect(unexpected, 'errors reported by the page').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
