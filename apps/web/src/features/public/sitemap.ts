import { PUBLIC_PAGE_PATHS } from './config'

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/**
 * `sitemap.xml` for the public pages only (17 section 13). URLs are absolute and built from the
 * origin of the request, so the same build serves staging and production.
 */
export function buildSitemap(origin: string): string {
  const base = origin.replace(/\/+$/, '')
  const urls = PUBLIC_PAGE_PATHS.map((path) => {
    const loc = escapeXml(path === '/' ? `${base}/` : `${base}${path}`)
    return `  <url>\n    <loc>${loc}</loc>\n  </url>`
  })
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
}
