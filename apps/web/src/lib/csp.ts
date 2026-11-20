/**
 * Content Security Policy of 17 section 14, built per response with a nonce for the inline
 * scripts TanStack Start writes during server rendering.
 */

/** The Clerk Frontend API host encoded in a publishable key (`pk_test_<base64("host$")>`). */
export function clerkFrontendApiHost(publishableKey: string): string | null {
  const encoded = publishableKey.split('_')[2]
  if (!encoded) return null
  try {
    const decoded = atob(encoded)
    const host = decoded.endsWith('$') ? decoded.slice(0, -1) : decoded
    return /^[a-z0-9.-]+$/i.test(host) ? host : null
  } catch {
    return null
  }
}

function origin(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

export type CspOptions = {
  /** Per-response nonce, for pages rendered on the Worker. */
  nonce?: string
  /** `sha256-...` hashes of the inline scripts, for prerendered pages served as static files. */
  scriptHashes?: string[]
  apiBaseUrl: string
  clerkPublishableKey?: string
}

export function buildContentSecurityPolicy({
  nonce,
  scriptHashes = [],
  apiBaseUrl,
  clerkPublishableKey,
}: CspOptions): string {
  const api = origin(apiBaseUrl)
  const apiSocket = api ? api.replace(/^http/, 'ws') : null
  const clerk = clerkPublishableKey ? clerkFrontendApiHost(clerkPublishableKey) : null
  const clerkOrigin = clerk ? `https://${clerk}` : null
  const r2 = 'https://*.r2.cloudflarestorage.com'
  const sentry = 'https://*.sentry.io'
  const turnstile = 'https://challenges.cloudflare.com'

  const directives: Record<string, (string | null)[]> = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      nonce ? `'nonce-${nonce}'` : null,
      ...scriptHashes.map((hash) => `'${hash}'`),
      clerkOrigin,
      turnstile,
    ],
    // Clerk's components and the toast library inject styles at run time.
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', r2, 'https://img.clerk.com'],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", api, apiSocket, clerkOrigin, r2, sentry],
    'media-src': ["'self'", 'blob:'],
    'worker-src': ["'self'", 'blob:'],
    'frame-src': [turnstile],
    'frame-ancestors': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'object-src': ["'none'"],
  }

  return Object.entries(directives)
    .map(([name, values]) => `${name} ${Array.from(new Set(values.filter(Boolean))).join(' ')}`)
    .join('; ')
}

/**
 * The contents of the inline scripts of an HTML document that the browser would run (data blocks
 * such as JSON-LD are not scripts and need no hash).
 */
export function inlineScripts(html: string): string[] {
  const scripts: string[] = []
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attributes = match[1] ?? ''
    const body = match[2] ?? ''
    if (/\bsrc\s*=/i.test(attributes)) continue
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attributes)?.[1]?.toLowerCase()
    if (
      type &&
      type !== 'module' &&
      type !== 'text/javascript' &&
      type !== 'application/javascript'
    ) {
      continue
    }
    if (body.length > 0) scripts.push(body)
  }
  return scripts
}

/** `sha256-<base64>` of a script body, as CSP expects it. */
export async function scriptHash(body: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))
  return `sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}`
}

/** A random nonce, base64 encoded, fresh for every response. */
export function createNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}
