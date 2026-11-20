import { defineConfig } from 'vitest/config'

const isCI = Boolean(process.env.CI)

// Unit tests run without the Cloudflare and TanStack Start plugins.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'happy-dom',
    environmentOptions: {
      happyDOM: {
        url: 'http://localhost:3000/',
        // The mock API answers on another origin; happy-dom would send CORS preflights that a
        // real browser sends too, but that the API (not the web app) is responsible for.
        settings: { fetch: { disableSameOriginPolicy: true } },
      },
    },
    env: { VITE_API_BASE_URL: 'http://localhost:8787' },
    setupFiles: ['./src/test/setup.ts'],
    // Tests with many renders are slower on Windows; keep a generous timeout.
    testTimeout: 15_000,
    // CI adds inline annotations on the pull request and a JUnit file for the job summary.
    reporters: isCI
      ? ['default', 'github-actions', ['junit', { outputFile: 'test-results/junit.xml' }]]
      : ['default'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/routeTree.gen.ts', 'src/**/*.d.ts'],
      reporter: ['text-summary', 'html', 'json-summary'],
    },
  },
})
