import { queryOptions, useQuery } from '@tanstack/react-query'
import { http } from './api'
import type { Me } from './api-types'
import { qk, STALE } from './query'

/** `GET /v1/me`: the session bootstrap. Refetched on focus once 60 s old (16 section 3.3). */
export function meQueryOptions() {
  return queryOptions({
    queryKey: qk.me(),
    queryFn: ({ signal }) => http.get<Me>('/v1/me', { signal }),
    staleTime: STALE.me,
  })
}

export function useMe(options: { enabled?: boolean } = {}) {
  return useQuery({ ...meQueryOptions(), enabled: options.enabled ?? true })
}

/**
 * The cached `Me` inside `AuthGate`, which renders nothing until it is loaded. Re-renders when
 * `Me` changes (counters, gate, profile summary).
 */
export function useCurrentMe(): Me {
  const { data } = useQuery({ ...meQueryOptions(), enabled: false })
  if (!data) throw new Error('useCurrentMe() was called outside AuthGate')
  return data
}
