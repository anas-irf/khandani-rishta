import { useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate, useRouter, useRouterState } from '@tanstack/react-router'
import { type ReactNode, useEffect, useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { GlobalDialogs } from '~/components/common/GlobalDialogs'
import { setUnauthenticatedHandler } from '~/lib/api'
import type { Gate, Me } from '~/lib/api-types'
import { resolveRedirect } from '~/lib/gate'
import { setLanguage } from '~/lib/i18n'
import { useMe } from '~/lib/me'
import { qk } from '~/lib/query'
import { startRealtime, stopRealtime } from '~/lib/realtime'
import { useReferenceQuery } from '~/lib/reference'
import { setTrackingSession } from '~/lib/track'
import { FullScreenError } from './FullScreenError'
import { rememberReturnPath } from './return-path'
import { Splash } from './Splash'
import { useAuthSession } from './session'
import { useIsSigningOut } from './useSignOut'

/**
 * The guard around every signed-in route (17 section 4.1). It waits for Clerk, then `Me`,
 * then the reference data, and replaces the URL whenever the gate does not allow it.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const session = useAuthSession()
  // During a navigation useLocation() is already the next location while the screen below is
  // still the previous one. The gate is checked against the location of what is rendered, so a
  // screen the gate refuses never renders, not even for one frame.
  const location = useLocation()
  const renderedPath = useRouterState({
    select: (state) => (state.resolvedLocation ?? state.location).pathname,
  })
  const signedIn = session.isLoaded && session.isSignedIn
  const signingOut = useIsSigningOut()
  const me = useMe({ enabled: signedIn })
  const reference = useReferenceQuery({ enabled: signedIn })

  useUnauthenticatedHandler()
  useSessionServices(signedIn ? me.data : undefined)
  useGateTransitions(me.data, location.pathname)

  if (!session.isLoaded) return <Splash />
  if (!session.isSignedIn) {
    // A deliberate sign-out ends on the landing page; while the sign-in page loads, this layout
    // is still mounted with the pending location.
    if (signingOut || location.pathname.startsWith('/sign-in')) return <Splash />
    return <RedirectToSignIn returnTo={location.href} />
  }
  if (me.isPending) return <Splash />
  if (me.isError) return <FullScreenError error={me.error} onRetry={() => void me.refetch()} />
  if (!reference.data) {
    if (reference.isError) {
      return <FullScreenError error={reference.error} onRetry={() => void reference.refetch()} />
    }
    return <Splash />
  }

  const target = resolveRedirect(me.data, renderedPath)
  if (target) {
    // A navigation to an allowed screen is already under way: wait for it.
    if (
      location.pathname !== renderedPath &&
      resolveRedirect(me.data, location.pathname) === null
    ) {
      return <Splash />
    }
    return <Redirect to={target} />
  }

  return (
    <>
      {children}
      <GlobalDialogs />
    </>
  )
}

/**
 * Replaces the URL once per target. TanStack's `<Navigate>` navigates again whenever its props
 * object changes, and this layout re-renders while the next route loads, which would start the
 * navigation over and over.
 */
function Redirect({ to }: { to: string }) {
  const navigate = useNavigate()
  const router = useRouter()
  const queryClient = useQueryClient()
  useLayoutEffect(() => {
    // A screen that changes the gate starts its own navigation right after (ONB-11 goes to
    // ONB-DONE): give it one task, and leave the URL alone if it is heading somewhere allowed.
    const timer = window.setTimeout(() => {
      const me = queryClient.getQueryData<Me>(qk.me())
      const heading = router.state.location.pathname
      if (me && resolveRedirect(me, heading) === null) return
      void navigate({ to, replace: true })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [to, navigate, router, queryClient])
  return <Splash />
}

/** A signed-out visitor goes to sign-in and comes back here afterwards (17 section 4.4). */
function RedirectToSignIn({ returnTo }: { returnTo: string }) {
  const navigate = useNavigate()
  const target = useRef(returnTo)
  useLayoutEffect(() => {
    void navigate({
      to: '/sign-in/$',
      params: { _splat: '' },
      search: { redirect_url: target.current },
      replace: true,
    })
  }, [navigate])
  return <Splash />
}

/** `401` twice: sign out locally and return here after signing in (17 section 4.4). */
function useUnauthenticatedHandler() {
  const session = useAuthSession()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const router = useRouter()

  useEffect(() => {
    let handling = false
    setUnauthenticatedHandler(() => {
      if (handling) return
      handling = true
      const returnTo = router.state.location.href
      stopRealtime()
      void session
        .signOut()
        .catch(() => undefined)
        .finally(() => {
          queryClient.clear()
          void navigate({
            to: '/sign-in/$',
            params: { _splat: '' },
            search: { redirect_url: returnTo },
            replace: true,
          })
        })
    })
    return () => setUnauthenticatedHandler(null)
  }, [session, queryClient, navigate, router])
}

const NO_SOCKET_GATES: ReadonlySet<Gate> = new Set(['banned', 'suspended', 'deletion_scheduled'])

/** Language, client events and the real-time connection follow the session (17 sections 6.5, 7, 12). */
function useSessionServices(me: Me | undefined) {
  const session = useAuthSession()
  const queryClient = useQueryClient()
  const router = useRouter()
  const locale = me?.user.locale
  const socketAllowed = me ? !NO_SOCKET_GATES.has(me.gate) : false
  const hasMe = me !== undefined

  useEffect(() => {
    if (locale) void setLanguage(locale)
  }, [locale])

  useEffect(() => {
    if (!hasMe) return
    setTrackingSession(() => session.getToken())
    return () => setTrackingSession(null)
  }, [hasMe, session])

  useEffect(() => {
    if (!socketAllowed) return
    return startRealtime({
      queryClient,
      getToken: () => session.getToken(),
      // Links in live toasts open in the app instead of reloading the page.
      navigate: (href) => router.history.push(href),
    })
  }, [socketAllowed, queryClient, session, router])
}

/** What a gate change looks like to the member (16 section 3.4). */
function useGateTransitions(me: Me | undefined, pathname: string) {
  const { t } = useTranslation()
  const previous = useRef<Gate | null>(null)
  const lastPath = useRef(pathname)

  useEffect(() => {
    const gate = me?.gate ?? null
    const before = previous.current
    previous.current = gate
    if (!gate || !before || before === gate) return
    if (before === 'pending_review' && gate === 'ok') {
      toast.success(t('toast.approved_live'))
    }
    if (before === 'ok' && gate === 'consent_required') {
      rememberReturnPath(lastPath.current)
    }
  }, [me?.gate, t])

  useEffect(() => {
    if (me?.gate === 'ok') lastPath.current = pathname
  }, [pathname, me?.gate])
}
