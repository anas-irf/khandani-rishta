import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, HeadContent, Scripts } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import type { ReactNode } from 'react'
import { DefaultCatchBoundary } from '~/components/DefaultCatchBoundary'
import { LocaleDirection } from '~/components/LocaleDirection'
import { NotFound } from '~/components/NotFound'
import { i18n } from '~/lib/i18n'
import appCss from '~/styles/app.css?url'

export type RouterContext = { queryClient: QueryClient }

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      { name: 'theme-color', content: '#6E1D34' },
      { title: i18n.t('public:meta.default_title') },
      { name: 'description', content: i18n.t('public:meta.default_description') },
      { property: 'og:site_name', content: 'Khandani Rishta' },
      { property: 'og:image', content: '/og-image.svg' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    ],
  }),
  errorComponent: DefaultCatchBoundary,
  notFoundComponent: () => <NotFound />,
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <head>
        <HeadContent />
      </head>
      <body>
        {/* Clerk and toasts live in SessionBoundary, inside the signed-in and sign-in routes. */}
        <LocaleDirection>{children}</LocaleDirection>
        {import.meta.env.DEV ? <TanStackRouterDevtools position="bottom-right" /> : null}
        <Scripts />
      </body>
    </html>
  )
}
