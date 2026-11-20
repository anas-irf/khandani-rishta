import { createFileRoute, redirect } from '@tanstack/react-router'
import { getIsSignedIn } from '~/features/auth/server'
import { HomePage } from '~/features/public/HomePage'
import { organizationJsonLd, pageHead } from '~/features/public/seo'

export const Route = createFileRoute('/_public/')({
  // A signed-in visitor goes straight to the app, without a flash of the landing page
  // (17 section 4.4). This is the only server-side auth check.
  beforeLoad: async () => {
    const { signedIn } = await getIsSignedIn()
    if (signedIn) throw redirect({ to: '/home' })
  },
  head: () => pageHead('home', { jsonLd: organizationJsonLd() }),
  component: HomePage,
})
