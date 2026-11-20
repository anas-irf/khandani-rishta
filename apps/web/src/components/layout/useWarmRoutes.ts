import { useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'

/**
 * Screens a member reaches from the shell. Their code is split by route (17 section 17), and
 * fetched here once the first screen is up, so later navigations never wait for code: while a
 * route's code loads, the router replaces the signed-in layout with its pending state, which
 * would remount the shell.
 */
const WARM_ROUTE_IDS = [
  '/_authed/_app/home',
  '/_authed/_app/search',
  '/_authed/_app/interests',
  '/_authed/_app/chats',
  '/_authed/_app/chats/',
  '/_authed/_app/chats/$connectionId/',
  '/_authed/_app/chats/$connectionId/details',
  '/_authed/_app/me/',
  '/_authed/_app/matches',
  '/_authed/_app/profiles/$profileId/',
  '/_authed/_app/profiles/$profileId/photos',
  '/_authed/_app/notifications',
  '/_authed/_app/shortlist',
  '/_authed/_app/visitors',
  '/_authed/_app/photo-requests',
  '/_authed/_app/settings/',
]

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
  cancelIdleCallback?: (handle: number) => void
}

export function useWarmRoutes(enabled: boolean) {
  const router = useRouter()

  useEffect(() => {
    if (!enabled) return
    const target = window as IdleWindow
    const warm = () => {
      for (const id of WARM_ROUTE_IDS) {
        const route = router.routesById[id as keyof typeof router.routesById]
        if (route) void router.loadRouteChunk(route)?.catch(() => undefined)
      }
    }
    if (target.requestIdleCallback) {
      const handle = target.requestIdleCallback(warm, { timeout: 3000 })
      return () => target.cancelIdleCallback?.(handle)
    }
    const timer = window.setTimeout(warm, 1500)
    return () => window.clearTimeout(timer)
  }, [enabled, router])
}
