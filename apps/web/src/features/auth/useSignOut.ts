import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useCallback } from 'react'
import { stopRealtime } from '~/lib/realtime'
import { createStore, useStore } from '~/lib/store'
import { setTrackingSession } from '~/lib/track'
import { useAuthSession } from './session'

/**
 * True while a deliberate sign-out runs, so AuthGate does not send the member to the sign-in
 * page when the session ends: sign-out ends on the landing page (06 section 10.1).
 */
const signingOutStore = createStore(false)

export function useIsSigningOut(): boolean {
  return useStore(signingOutStore)
}

/**
 * Sign-out in the order of 06 section 10.1: close the WebSocket, sign out of Clerk, clear the
 * query cache, go to the landing page (replacing history so Back cannot return).
 */
export function useSignOut() {
  const session = useAuthSession()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  return useCallback(async () => {
    signingOutStore.set(true)
    try {
      stopRealtime()
      setTrackingSession(null)
      await session.signOut()
      queryClient.clear()
      await navigate({ to: '/', replace: true })
    } finally {
      signingOutStore.set(false)
    }
  }, [session, queryClient, navigate])
}
