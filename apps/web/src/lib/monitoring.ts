import { appEnv, sentryDsn } from './env'

/**
 * Error reporting. Sentry is enabled only when `VITE_SENTRY_DSN` is set (17 section 15); the SDK
 * is loaded lazily so it never adds weight when reporting is off. No personal data is sent:
 * request bodies, query strings and URLs in breadcrumbs are scrubbed (17 section 14).
 */
type Reporter = (error: unknown, context?: Record<string, unknown>) => void

let reporter: Reporter | null = null

export function reportError(error: unknown, context?: Record<string, unknown>) {
  if (reporter) {
    reporter(error, context)
    return
  }
  if (import.meta.env.DEV && import.meta.env.MODE !== 'test') {
    console.error('[report]', error, context ?? '')
  }
}

/** Removes the query string and fragment from a URL before it is reported. */
export function scrubUrl(url: string): string {
  const index = url.search(/[?#]/)
  return index === -1 ? url : url.slice(0, index)
}

let started = false

/** Starts Sentry in the browser when a DSN is configured. Safe to call more than once. */
export async function initMonitoring(): Promise<void> {
  if (started || !sentryDsn || typeof window === 'undefined') return
  started = true
  const Sentry = await import('@sentry/tanstackstart-react')
  Sentry.init({
    dsn: sentryDsn,
    environment: appEnv,
    beforeBreadcrumb(breadcrumb) {
      const data = breadcrumb.data
      if (data && typeof data.url === 'string') data.url = scrubUrl(data.url)
      if (data && typeof data.from === 'string') data.from = scrubUrl(data.from)
      if (data && typeof data.to === 'string') data.to = scrubUrl(data.to)
      return breadcrumb
    },
    beforeSend(event) {
      if (event.request) {
        event.request.data = undefined
        event.request.query_string = undefined
        event.request.cookies = undefined
        if (event.request.url) event.request.url = scrubUrl(event.request.url)
      }
      return event
    },
  })
  reporter = (error, context) => {
    Sentry.captureException(error, context ? { extra: context } : undefined)
  }
}
