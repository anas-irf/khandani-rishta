import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { msw } from 'msw/vite'
import { defineConfig, loadEnv, type PluginOption } from 'vite'
import { buildContentSecurityPolicy, inlineScripts, scriptHash } from './src/lib/csp'

/**
 * Public pages that are prerendered at build time (17 section 3.1). `/` stays server-rendered
 * because it redirects signed-in visitors, and `/download` because it reads the latest release.
 */
const PRERENDERED_PAGES = [
  '/how-it-works',
  '/safety',
  '/nikah-guide',
  '/faq',
  '/contact',
  '/terms',
  '/privacy',
  '/community-guidelines',
]

/** Headers for files served without the Worker (17 section 14). */
const STATIC_HEADERS = [
  'Referrer-Policy: strict-origin-when-cross-origin',
  'X-Content-Type-Options: nosniff',
  'Permissions-Policy: camera=(self), microphone=(), geolocation=()',
  'X-Frame-Options: DENY',
]

export default defineConfig(({ mode }) => {
  // `vite --mode mock`: mocked API and session, for development and end-to-end journeys
  // without a backend (src/lib/env.ts). Never used for a deployable build.
  const mock = mode === 'mock'
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const apiBaseUrl = env.VITE_API_BASE_URL || 'http://localhost:8787'
  const clerkPublishableKey = env.VITE_CLERK_PUBLISHABLE_KEY

  // Prerendered pages are static files: Cloudflare serves them without running the Worker, so
  // they get their security headers from `_headers`, with the policy allowing their inline
  // scripts by hash instead of by the Worker's per-response nonce.
  const pagePolicies = new Map<string, string>()
  const writeStaticHeaders = () => {
    const blocks = [`/*\n${STATIC_HEADERS.map((line) => `  ${line}`).join('\n')}`]
    for (const [path, policy] of [...pagePolicies].sort()) {
      blocks.push(`${path}\n  Content-Security-Policy: ${policy}`)
    }
    writeFileSync(join(process.cwd(), 'dist/client/_headers'), `${blocks.join('\n\n')}\n`)
  }

  const plugins: PluginOption[] = [
    tailwindcss(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tanstackStart({
      pages: PRERENDERED_PAGES.map((path) => ({ path })),
      prerender: {
        enabled: !mock,
        // Only the pages listed above: no discovery of other static routes, no link crawling.
        autoStaticPathsDiscovery: false,
        crawlLinks: false,
        filter: (page) => PRERENDERED_PAGES.includes(page.path),
        // `/faq` is written as `faq.html`, so it is served at `/faq` without a redirect.
        autoSubfolderIndex: false,
        failOnError: true,
        onSuccess: async ({ page, html }) => {
          const hashes = await Promise.all(inlineScripts(html).map((body) => scriptHash(body)))
          pagePolicies.set(
            page.path,
            buildContentSecurityPolicy({ scriptHashes: hashes, apiBaseUrl, clerkPublishableKey }),
          )
          writeStaticHeaders()
        },
      },
    }),
    viteReact(),
  ]
  if (mock) plugins.unshift(msw({ mode: 'worker-only' }))

  return {
    server: {
      port: 3000,
    },
    resolve: {
      tsconfigPaths: true,
    },
    define: mock ? { 'import.meta.env.VITE_MOCK_MODE': JSON.stringify('true') } : {},
    optimizeDeps: {
      // Routes are loaded lazily and there is no index.html to scan, so without this the dev
      // server discovers dependencies on the first visit of each screen and reloads the page.
      entries: [
        'src/routes/**/*.tsx',
        'src/features/**/*.tsx',
        'src/components/**/*.tsx',
        '!src/**/*.test.tsx',
        '!src/**/test-harness.tsx',
      ],
      // The mock API is pre-bundled up front too, so it is never re-optimised mid-session.
      include: mock ? ['msw', 'msw/browser'] : [],
    },
    plugins,
  }
})
