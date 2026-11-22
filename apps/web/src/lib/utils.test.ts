import { describe, expect, it } from 'vitest'
import { directionOf } from './i18n'
import { isPublicPagePath, securityHeaders } from './security-headers'
import { badgeCount, cn, fromSlug, initialsOf, safeRedirectPath, toSlug } from './utils'

describe('slugs (17 section 3.3)', () => {
  it('converts step and section keys both ways', () => {
    expect(toSlug('education_career')).toBe('education-career')
    expect(fromSlug('account-for')).toBe('account_for')
  })
})

describe('badgeCount (16 section 2.4)', () => {
  it.each([
    [0, ''],
    [-1, ''],
    [7, '7'],
    [99, '99'],
    [100, '99+'],
  ])('%i -> "%s"', (count, text) => {
    expect(badgeCount(count)).toBe(text)
  })
})

describe('safeRedirectPath (17 section 14)', () => {
  it.each([
    ['/chats/abc?x=1', '/chats/abc?x=1'],
    ['/', '/'],
    ['//evil.example', undefined],
    ['/\\evil.example', undefined],
    ['https://evil.example', undefined],
    ['javascript:alert(1)', undefined],
    [undefined, undefined],
    [42, undefined],
  ])('%s -> %s', (value, expected) => {
    expect(safeRedirectPath(value)).toBe(expected)
  })
})

describe('cn', () => {
  it('merges conflicting Tailwind classes', () => {
    expect(cn('px-2', false, 'px-4')).toBe('px-4')
  })

  it.each([
    ['text-body-md text-muted-foreground', 'text-body-md text-muted-foreground'],
    ['text-body-md text-caption', 'text-caption'],
    ['text-foreground text-primary', 'text-primary'],
    ['rounded-card rounded-pill', 'rounded-pill'],
    ['shadow-menu shadow-none', 'shadow-none'],
    ['min-h-touch min-h-touch-lg', 'min-h-touch-lg'],
    ['max-w-column max-w-form', 'max-w-form'],
    ['band-page band-sand', 'band-sand'],
  ])('knows the design tokens: "%s" -> "%s"', (input, expected) => {
    expect(cn(input)).toBe(expected)
  })
})

describe('initialsOf (DESIGN.md 6.8)', () => {
  it.each([
    ['Muhammad Abdul Rehman S.', 'MS'],
    ['Ayesha K.', 'AK'],
    ['A. K.', 'AK'],
    ['Ayesha', 'A'],
    ['KR7F3K2QX9', 'K'],
    ['', ''],
    [null, ''],
  ])('%s -> "%s"', (name, initials) => {
    expect(initialsOf(name)).toBe(initials)
  })
})

describe('directionOf (17 section 12)', () => {
  it('is right-to-left for Urdu only', () => {
    expect(directionOf('ur')).toBe('rtl')
    expect(directionOf('en')).toBe('ltr')
  })
})

describe('security headers (17 sections 13 and 14)', () => {
  it('marks signed-in routes noindex and leaves public pages indexable', () => {
    expect(securityHeaders('/home')['X-Robots-Tag']).toBe('noindex')
    expect(securityHeaders('/faq')['X-Robots-Tag']).toBeUndefined()
    expect(isPublicPagePath('/.well-known/assetlinks.json')).toBe(true)
  })

  it('always sends the baseline headers', () => {
    expect(securityHeaders('/')).toMatchObject({
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Content-Type-Options': 'nosniff',
      'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
    })
  })
})

describe('scrubUrl (17 section 14)', () => {
  it('drops query strings and fragments before reporting', async () => {
    const { scrubUrl } = await import('./monitoring')
    expect(scrubUrl('https://api.example.com/v1/search?q=abc#x')).toBe(
      'https://api.example.com/v1/search',
    )
    expect(scrubUrl('/home')).toBe('/home')
  })
})
