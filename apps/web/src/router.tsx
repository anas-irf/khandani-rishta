import { QueryClientProvider } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'
import { createIsomorphicFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { DefaultCatchBoundary } from './components/DefaultCatchBoundary'
import { NotFound } from './components/NotFound'
import { apiBaseUrl } from './lib/api'
import { buildContentSecurityPolicy, createNonce } from './lib/csp'
import { clerkPublishableKey, isMockMode } from './lib/env'
import { createQueryClient } from './lib/query'
import { routeTree } from './routeTree.gen'

/**
 * The nonce for the inline scripts of server rendering (17 section 14). On the Worker a fresh one
 * is issued per response together with the Content-Security-Policy header; in the browser it is
 * read back from the rendered scripts. Development and mock mode run without the policy, since
 * Vite's dev client injects inline scripts of its own.
 */
const resolveCspNonce = createIsomorphicFn()
  .server((): string | undefined => {
    if (!import.meta.env.PROD || isMockMode) return undefined
    const nonce = createNonce()
    setResponseHeader(
      'Content-Security-Policy',
      buildContentSecurityPolicy({ nonce, apiBaseUrl, clerkPublishableKey }),
    )
    return nonce
  })
  .client((): string | undefined => {
    const script = document.querySelector<HTMLScriptElement>('script[nonce]')
    return script?.nonce || undefined
  })

export function getRouter() {
  const queryClient = createQueryClient()

  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    // TanStack Query owns caching; the router always asks it.
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: DefaultCatchBoundary,
    defaultNotFoundComponent: () => <NotFound />,
    scrollRestoration: true,
    ssr: { nonce: resolveCspNonce() },
    // biome-ignore lint/correctness/noComponentHookFactories: created once per router, it hands that router's QueryClient to the app.
    Wrap: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  })
}
