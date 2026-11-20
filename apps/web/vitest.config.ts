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
    setupFiles: ['./src/test/setup.ts'],
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
