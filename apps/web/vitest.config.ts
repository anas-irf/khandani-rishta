import { defineConfig } from 'vitest/config'

// Unit tests run without the Cloudflare and TanStack Start plugins.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
