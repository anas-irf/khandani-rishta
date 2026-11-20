import type { ReactNode } from 'react'
import { Toaster } from '~/components/ui/sonner'
import { AuthProvider } from './session'

/**
 * Clerk (or the mock session) and toasts, for the sign-in page and the signed-in area only.
 * Routes split their components into separate chunks, so public pages never download Clerk or
 * load clerk-js (17 section 17: under 100 KB of JavaScript on the landing page). Clerk works
 * without server-rendered state here because these routes render in the browser only.
 */
export function SessionBoundary({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      {children}
      <Toaster />
    </AuthProvider>
  )
}
