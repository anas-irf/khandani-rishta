import { setupWorker } from 'msw/browser'
import { isMockScenario, resetDb } from './db'
import { handlers } from './handlers'

const SCENARIO_KEY = 'kr.mock.scenario'

type MockWindow = Window & { __krMockWorker?: Promise<unknown> }

/**
 * Starts the mock API in the browser (mock mode only, see src/lib/env.ts). A scenario can be
 * chosen with `?mock_scenario=<name>` on any URL; it is remembered for the tab.
 *
 * Starting twice (React runs effects twice in development) would patch `fetch` and `WebSocket`
 * twice, so the first start is reused. The promise lives on `window`, not in module scope,
 * because the dev server can load two copies of this module after re-optimising dependencies.
 */
export function startMockWorker(): Promise<unknown> {
  const target = window as MockWindow
  target.__krMockWorker ??= (async () => {
    const fromUrl = new URL(window.location.href).searchParams.get('mock_scenario')
    if (isMockScenario(fromUrl)) window.sessionStorage.setItem(SCENARIO_KEY, fromUrl)
    const saved = window.sessionStorage.getItem(SCENARIO_KEY)
    resetDb(isMockScenario(saved) ? saved : 'active')

    const worker = setupWorker(...handlers)
    await worker.start({
      onUnhandledFrame: 'bypass',
      quiet: true,
      serviceWorker: { url: '/mockServiceWorker.js' },
    })
    return worker
  })()
  return target.__krMockWorker
}
