import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '~/lib/api'
import type { Preferences } from '~/lib/api-types'
import { qk, STALE } from '~/lib/query'

/**
 * Partner preferences (15 section 7). `GET` answers the stored row or the computed defaults of
 * 07 section 12. Saving sets `['me', 'preferences']` and invalidates `['home']`,
 * `['recommendations']` and every `['profile', *]` (17 section 6.3).
 */

export function usePreferences() {
  return useQuery({
    queryKey: qk.preferences(),
    queryFn: ({ signal }) => http.get<Preferences>('/v1/me/preferences', { signal }),
    staleTime: STALE.none,
    refetchOnMount: 'always',
  })
}

export function useSavePreferences() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (preferences: Preferences) =>
      http.put<Preferences>('/v1/me/preferences', preferences),
    meta: { handles: ['internal_error', 'service_unavailable', 'network_error'] },
    onSuccess: (preferences) => {
      queryClient.setQueryData(qk.preferences(), preferences)
      void queryClient.invalidateQueries({ queryKey: qk.home() })
      void queryClient.invalidateQueries({ queryKey: qk.recommendations() })
      void queryClient.invalidateQueries({ queryKey: qk.profileAll() })
    },
  })
}
