/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the API, for example https://api.example.com */
  readonly VITE_API_BASE_URL?: string
  /** Clerk publishable key (`pk_test_...` or `pk_live_...`). */
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string
  /** `local`, `staging` or `production`. */
  readonly VITE_APP_ENV?: string
  /** Sentry DSN. Empty disables reporting. */
  readonly VITE_SENTRY_DSN?: string
  /** `true` only in `vite --mode mock`: mocked API and session (src/lib/env.ts). */
  readonly VITE_MOCK_MODE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
