// Adds DOM matchers such as `toBeInTheDocument` to Vitest's `expect`.
import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import type { ResourceKey } from 'i18next'
import { toast } from 'sonner'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { setTokenGetter } from '~/lib/api'
import { i18n } from '~/lib/i18n'
import { resetDb } from '~/mocks/db'
import { server } from '~/mocks/server'

// Screens wait for Me, the reference data and their own queries through the mock API; the
// default 1 s for `findBy*` is too short on slower machines.
configure({ asyncUtilTimeout: 5000 })

// Every English namespace is loaded up front, so components never suspend on translations.
const locales = import.meta.glob<{ default: ResourceKey }>('../locales/en/*.json', { eager: true })
for (const [path, module] of Object.entries(locales)) {
  const namespace = /([^/]+)\.json$/.exec(path)?.[1]
  if (namespace) i18n.addResourceBundle('en', namespace, module.default, true, true)
}

// happy-dom has no IntersectionObserver or matchMedia; lists and layouts use them.
class TestIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}
globalThis.IntersectionObserver ??=
  TestIntersectionObserver as unknown as typeof globalThis.IntersectionObserver

// The mock API answers every request; an unhandled request fails the test.
beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' })
  setTokenGetter(async () => 'test-token')
})

afterEach(() => {
  // Sonner keeps toasts in a module-level store; clear them so tests stay independent.
  toast.dismiss()
  cleanup()
  server.resetHandlers()
  resetDb('active')
  window.localStorage.clear()
  window.sessionStorage.clear()
})

afterAll(() => {
  server.close()
})
