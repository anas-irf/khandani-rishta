import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { takeReturnPath } from '~/features/auth/return-path'
import { http } from '~/lib/api'
import type { ConsentDocument, Me } from '~/lib/api-types'
import { meQueryOptions } from '~/lib/me'
import { setMe } from '~/lib/query'

/**
 * Data of the gate screens (16 section 6.2). A response that returns `Me` replaces the cache;
 * `AuthGate` then routes by the returned gate (16 section 3.3). Deletion is shared with
 * SET-ACCOUNT and lives in `features/settings/queries.ts`.
 */

/**
 * Refetches `GET /v1/me` when the screen opens and, with `intervalMs`, again while it stays
 * visible (a suspension that ends, a profile that is approved, 16 section 6.2). The socket is
 * not connected under some gates, so the screens poll. Failures keep the cached `Me`.
 */
export function useGateRefresh(intervalMs: number | false = false) {
  useQuery({
    ...meQueryOptions(),
    refetchOnMount: 'always',
    refetchInterval: intervalMs,
  })
}

/**
 * `POST /v1/me/consents` with the documents still required. When the returned gate is `ok`,
 * the member goes back to the screen they were on (`takeReturnPath`, 16 section 3.4), otherwise
 * `AuthGate` sends them to the landing screen of the new gate.
 */
export function useAcceptConsents() {
  const queryClient = useQueryClient()
  const router = useRouter()
  return useMutation({
    mutationFn: (documents: ConsentDocument[]) => http.post<Me>('/v1/me/consents', { documents }),
    onSuccess: (me) => {
      const returnPath = takeReturnPath()
      setMe(queryClient, me)
      // Navigated in the same tick as the cache update: the router has the new location before
      // `AuthGate` re-renders, so it does not send the member to the gate home first.
      if (me.gate === 'ok' && returnPath) router.history.replace(returnPath)
    },
  })
}
