/**
 * Response headers set by the Worker (17 sections 13 and 14).
 */

/** Paths of public pages (17 section 3.1). Everything else is signed-in and not indexed. */
const PUBLIC_PATHS = new Set([
  '/',
  '/how-it-works',
  '/safety',
  '/nikah-guide',
  '/faq',
  '/download',
  '/contact',
  '/terms',
  '/privacy',
  '/community-guidelines',
  '/robots.txt',
  '/sitemap.xml',
])

export function isPublicPagePath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname) || pathname.startsWith('/.well-known/')
}

export function securityHeaders(pathname: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
    'X-Frame-Options': 'DENY',
  }
  if (!isPublicPagePath(pathname)) headers['X-Robots-Tag'] = 'noindex'
  return headers
}
