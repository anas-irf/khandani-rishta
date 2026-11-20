/**
 * Build-time configuration (17 section 15). `VITE_*` values are public and baked into the bundle.
 */

/**
 * Mock mode runs the app without the API or Clerk: Mock Service Worker answers API calls from
 * `src/mocks` and a fake session replaces Clerk. It is switched on only by `vite --mode mock`
 * (see vite.config.ts) and never in a production build.
 */
export const isMockMode = import.meta.env.VITE_MOCK_MODE === 'true'

export const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? ''

/**
 * Clerk runs when a publishable key is configured and mock mode is off. Without a key (a fresh
 * clone, the CI build for the public-page smoke tests) the app still serves its public pages
 * and treats every visitor as signed out.
 */
export const clerkEnabled = !isMockMode && clerkPublishableKey.startsWith('pk_')

export const appEnv = (import.meta.env.VITE_APP_ENV ?? 'local') as
  | 'local'
  | 'staging'
  | 'production'

export const sentryDsn = import.meta.env.VITE_SENTRY_DSN ?? ''
