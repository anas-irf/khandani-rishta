import { describe, expect, it } from 'vitest'
import {
  buildContentSecurityPolicy,
  clerkFrontendApiHost,
  createNonce,
  inlineScripts,
  scriptHash,
} from './csp'

const key = `pk_test_${btoa('happy-fox-12.clerk.accounts.dev$')}`

describe('clerkFrontendApiHost', () => {
  it('decodes the Frontend API host from a publishable key', () => {
    expect(clerkFrontendApiHost(key)).toBe('happy-fox-12.clerk.accounts.dev')
  })

  it('returns null for malformed keys', () => {
    expect(clerkFrontendApiHost('pk_test_')).toBeNull()
    expect(clerkFrontendApiHost('pk_test_!!!')).toBeNull()
    expect(clerkFrontendApiHost(`pk_test_${btoa('evil host<script>$')}`)).toBeNull()
  })
})

describe('buildContentSecurityPolicy (17 section 14)', () => {
  const policy = buildContentSecurityPolicy({
    nonce: 'abc123',
    apiBaseUrl: 'https://api.example.com',
    clerkPublishableKey: key,
  })
  const directive = (name: string) =>
    policy
      .split('; ')
      .find((part) => part.startsWith(`${name} `))
      ?.split(' ')
      .slice(1)

  it('allows only own scripts, the nonce, Clerk, its bot protection and Turnstile', () => {
    expect(directive('script-src')).toEqual([
      "'self'",
      "'nonce-abc123'",
      'https://happy-fox-12.clerk.accounts.dev',
      'https://*.protect.clerk.com',
      'https://challenges.cloudflare.com',
    ])
  })

  it('lets the browser reach the API over https and wss, Clerk, R2 and Sentry', () => {
    expect(directive('connect-src')).toEqual([
      "'self'",
      'https://api.example.com',
      'wss://api.example.com',
      'https://happy-fox-12.clerk.accounts.dev',
      'https://*.protect.clerk.com:*',
      'https://*.r2.cloudflarestorage.com',
      'https://*.sentry.io',
    ])
  })

  it('forbids framing and plugins', () => {
    expect(directive('frame-ancestors')).toEqual(["'none'"])
    expect(directive('object-src')).toEqual(["'none'"])
    expect(directive('frame-src')).toEqual([
      'https://challenges.cloudflare.com',
      'https://*.protect.clerk.com',
    ])
  })

  it('works without Clerk', () => {
    const withoutClerk = buildContentSecurityPolicy({
      nonce: 'n',
      apiBaseUrl: 'http://localhost:8787',
    })
    expect(withoutClerk).toContain("script-src 'self' 'nonce-n' https://challenges.cloudflare.com")
    expect(withoutClerk).toContain('ws://localhost:8787')
    expect(withoutClerk).not.toContain('protect.clerk.com')
  })
})

describe('static pages', () => {
  it('collects only the inline scripts the browser runs', () => {
    const html = [
      '<script type="application/ld+json">{"a":1}</script>',
      '<script nonce="x">window.a=1</script>',
      '<script type="module" async src="/assets/index.js"></script>',
      '<script type="module">import("/x.js")</script>',
      '<script></script>',
    ].join('')
    expect(inlineScripts(html)).toEqual(['window.a=1', 'import("/x.js")'])
  })

  it('hashes a script body as CSP expects', async () => {
    // printf 'alert(1)' | openssl dgst -sha256 -binary | base64
    expect(await scriptHash('alert(1)')).toBe('sha256-bhHHL3z2vDgxUt0W3dWQOrprscmda2Y5pLsLg4GF+pI=')
  })

  it('allows the hashed scripts without a nonce', () => {
    const policy = buildContentSecurityPolicy({
      scriptHashes: ['sha256-abc'],
      apiBaseUrl: 'https://api.example.com',
    })
    expect(policy).toContain("script-src 'self' 'sha256-abc' https://challenges.cloudflare.com")
    expect(policy).not.toContain('nonce')
  })
})

describe('createNonce', () => {
  it('returns a different base64 value each time', () => {
    const a = createNonce()
    const b = createNonce()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/)
  })
})
