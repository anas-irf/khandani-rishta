import { defineConfig, devices } from '@playwright/test'

const isCI = Boolean(process.env.CI)

/**
 * Address of a deployed site to test, for example the staging URL after a deploy. When it
 * is not set, Playwright serves the local production build (`pnpm build:web` first) itself.
 */
const deployedUrl = process.env.E2E_BASE_URL
const port = Number(process.env.E2E_PORT ?? 4173)
const baseURL = deployedUrl ?? `http://localhost:${port}`

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: true,
  // A stray `test.only` would silently skip every other test.
  forbidOnly: isCI,
  // One retry in CI tells flaky tests (passed on retry) apart from broken ones.
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : undefined,
  reporter: isCI
    ? [
        ['list'],
        ['github'],
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
        ['junit', { outputFile: 'playwright-report/junit.xml' }],
      ]
    : [['list'], ['html', { open: 'on-failure', outputFolder: 'playwright-report' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // Most visitors are expected on phones, so every test also runs on a mobile viewport.
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: deployedUrl
    ? undefined
    : {
        command: `pnpm --filter @khandani/web preview --port ${port} --strictPort`,
        url: baseURL,
        reuseExistingServer: !isCI,
        timeout: 120_000,
      },
})
