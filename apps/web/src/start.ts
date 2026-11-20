import { clerkMiddleware } from '@clerk/tanstack-react-start/server'
import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start'
import { clerkEnabled } from './lib/env'
import { securityHeaders } from './lib/security-headers'

/**
 * Request middleware (17 section 5, 06 section 3.1). Error reporting comes first, then, in the
 * order Clerk's TanStack Start quickstart gives: CSRF protection for server functions, then
 * Clerk. Then the security headers of 17 section 14 and `X-Robots-Tag: noindex` for signed-in
 * routes (17 section 13).
 */

/**
 * TanStack Start turns an error thrown in a server route or server function into a 500 itself,
 * so the `withSentry` wrapper in `server.ts` never sees it. These report it to Sentry first, like
 * Sentry's `sentryGlobalRequestMiddleware` and `sentryGlobalFunctionMiddleware`. They are written
 * here because importing Sentry's versions into this file, which the browser also loads, puts the
 * whole browser SDK into the main bundle. Code inside `.server()` never reaches the browser, and
 * the SDK it loads is the one `server.ts` already started.
 */
const sentryRequestMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next()
  } catch (error) {
    const { captureException } = await import('@sentry/cloudflare')
    captureException(error, {
      mechanism: { type: 'auto.middleware.tanstackstart.request', handled: false },
    })
    throw error
  }
})

const sentryFunctionMiddleware = createMiddleware({ type: 'function' }).server(async ({ next }) => {
  try {
    return await next()
  } catch (error) {
    const { captureException } = await import('@sentry/cloudflare')
    captureException(error, {
      mechanism: { type: 'auto.middleware.tanstackstart.server_function', handled: false },
    })
    throw error
  }
})

// TanStack Start adds no CSRF middleware of its own once this file exists.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
})

const headersMiddleware = createMiddleware().server(async ({ next, pathname }) => {
  const result = await next()
  const headers = securityHeaders(pathname)
  for (const [name, value] of Object.entries(headers)) {
    result.response.headers.set(name, value)
  }
  return result
})

export const startInstance = createStart(() => ({
  requestMiddleware: clerkEnabled
    ? [sentryRequestMiddleware, csrfMiddleware, clerkMiddleware(), headersMiddleware]
    : [sentryRequestMiddleware, csrfMiddleware, headersMiddleware],
  functionMiddleware: [sentryFunctionMiddleware],
}))
