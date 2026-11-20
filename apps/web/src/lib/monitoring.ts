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

type ScrubbableBreadcrumb = { data?: { [key: string]: unknown } }

/** Strips query strings from the URLs a breadcrumb carries (17 section 14). */
export function scrubBreadcrumb<T extends ScrubbableBreadcrumb>(breadcrumb: T): T {
  const data = breadcrumb.data
  if (data && typeof data.url === 'string') data.url = scrubUrl(data.url)
  if (data && typeof data.from === 'string') data.from = scrubUrl(data.from)
  if (data && typeof data.to === 'string') data.to = scrubUrl(data.to)
  return breadcrumb
}

type ScrubbableEvent = {
  request?: {
    data?: unknown
    query_string?: unknown
    cookies?: unknown
    url?: string
    headers?: { [key: string]: string }
  }
}

/**
 * Removes the request body, query string, cookies and credentials from an event before it is
 * sent, in the browser and on the Worker (17 section 14, 20 section 7).
 */
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  const request = event.request
  if (request) {
    request.data = undefined
    request.query_string = undefined
    request.cookies = undefined
    if (request.url) request.url = scrubUrl(request.url)
    if (request.headers) {
      for (const name of Object.keys(request.headers)) {
        if (/^(authorization|cookie|set-cookie|x-clerk-.*)$/i.test(name)) {
          delete request.headers[name]
        }
      }
    }
  }
  return event
}

/**
 * What the SDK may collect (Sentry 11 `dataCollection`): no user fields, cookies, bodies or query
 * strings, and only a few harmless request headers (20 section 7).
 */
export const sentryDataCollection = {
  userInfo: false,
  cookies: false,
  httpBodies: [],
  urlQueryParams: false,
  httpHeaders: { request: { allow: ['user-agent', 'accept-language', 'cf-ray'] }, response: false },
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
    dataCollection: sentryDataCollection,
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSend: scrubEvent,
  })
  reporter = (error, context) => {
    Sentry.captureException(error, context ? { extra: context } : undefined)
  }
}
