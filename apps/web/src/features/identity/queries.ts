import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http, isApiError } from '~/lib/api'
import type { IdentityBody } from '~/lib/api-types'
import { invalidateMe, qk, STALE } from '~/lib/query'

/**
 * The identity document number (15 section 7, 12 section 3). The number itself is never
 * returned: only `IdentitySummary` with `number_masked`.
 */

/** `GET /v1/me/identity`: the summary, or null when no number was added yet. */
export function useIdentity() {
  return useQuery({
    queryKey: qk.identity(),
    queryFn: async ({ signal }) => {
      try {
        return (await http.get('/v1/me/identity', { signal })) ?? null
      } catch (error) {
        if (isApiError(error) && error.code === 'not_found') return null
        throw error
      }
    },
    staleTime: STALE.none,
    refetchOnMount: 'always',
  })
}

/**
 * `PUT /v1/me/identity`. The form handles `identity_already_registered` and `invalid_state`
 * itself (07 section 13.4). Invalidates `['me', 'identity']`, `['me', 'verifications']`,
 * `['me', 'profile']` and `['me']` (17 section 6.3).
 */
export function useSaveIdentity() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: IdentityBody) => http.put('/v1/me/identity', body),
    meta: {
      handles: [
        'identity_already_registered',
        'invalid_state',
        'internal_error',
        'service_unavailable',
        'network_error',
      ],
    },
    onSuccess: (summary) => {
      queryClient.setQueryData(qk.identity(), summary)
      void queryClient.invalidateQueries({ queryKey: qk.identity() })
      void queryClient.invalidateQueries({ queryKey: qk.verifications() })
      void queryClient.invalidateQueries({ queryKey: qk.ownProfile() })
      void invalidateMe(queryClient)
    },
  })
}
