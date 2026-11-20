import * as Sentry from '@sentry/cloudflare'
import { wrapFetchWithSentry } from '@sentry/tanstackstart-react'
import handler from '@tanstack/react-start/server-entry'
import { appEnv, sentryDsn } from './lib/env'
import { scrubBreadcrumb, scrubEvent, sentryDataCollection } from './lib/monitoring'

/**
 * Worker entry (`main` in wrangler.jsonc). It wraps TanStack Start's handler with Sentry's
 * Cloudflare SDK, following Sentry's "TanStack Start on Cloudflare" setup, so errors thrown while
 * rendering or handling a request on the Worker are reported. It uses the same `VITE_SENTRY_DSN`
 * as the browser (17 section 15); without one the SDK is not started. Request bodies, query
 * strings, cookies and credentials are scrubbed exactly as in the browser (17 section 14).
 */
export default Sentry.withSentry(
  () =>
    sentryDsn
      ? {
          dsn: sentryDsn,
          environment: appEnv,
          dataCollection: sentryDataCollection,
          tracesSampleRate: appEnv === 'production' ? 0.05 : 0.2,
          beforeBreadcrumb: scrubBreadcrumb,
          beforeSend: scrubEvent,
        }
      : undefined,
  wrapFetchWithSentry(handler),
)
