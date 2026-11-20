import { clerkMiddleware } from '@clerk/tanstack-react-start/server'
import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start'
import { clerkEnabled } from './lib/env'
import { securityHeaders } from './lib/security-headers'

/**
 * Request middleware (17 section 5, 06 section 3.1), in the order Clerk's TanStack Start
 * quickstart gives: CSRF protection for server functions, then Clerk. Then the security
 * headers of 17 section 14 and `X-Robots-Tag: noindex` for signed-in routes (17 section 13).
 */

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
    ? [csrfMiddleware, clerkMiddleware(), headersMiddleware]
    : [csrfMiddleware, headersMiddleware],
}))
