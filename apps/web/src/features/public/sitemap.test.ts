import { describe, expect, it } from 'vitest'
import { PUBLIC_PAGE_PATHS } from './config'
import { buildSitemap } from './sitemap'

describe('buildSitemap', () => {
  it('lists every public page with an absolute URL from the given origin', () => {
    const xml = buildSitemap('https://example.org')

    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(xml).toContain('<loc>https://example.org/</loc>')
    for (const path of PUBLIC_PAGE_PATHS.filter((p) => p !== '/')) {
      expect(xml).toContain(`<loc>https://example.org${path}</loc>`)
    }
    expect(xml.match(/<loc>/g)).toHaveLength(10)
  })

  it('contains no signed-in or sign-in routes', () => {
    const xml = buildSitemap('https://example.org')
    for (const path of ['/home', '/me', '/sign-in', '/admin', '/profiles', '/settings']) {
      expect(xml).not.toContain(`example.org${path}`)
    }
  })

  it('ignores a trailing slash on the origin and escapes XML characters', () => {
    expect(buildSitemap('https://example.org/')).toContain('<loc>https://example.org/faq</loc>')
    expect(buildSitemap('http://a.test/?x=1&y=2')).toContain('&amp;')
  })
})
