import { createFileRoute } from '@tanstack/react-router'
import { buildSitemap } from '~/features/public/sitemap'

/** `/sitemap.xml`: the public pages only, with absolute URLs from the request origin (17 section 13). */
export const Route = createFileRoute('/sitemap.xml')({
  server: {
    handlers: {
      GET: ({ request }) =>
        new Response(buildSitemap(new URL(request.url).origin), {
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
          },
        }),
    },
  },
})
