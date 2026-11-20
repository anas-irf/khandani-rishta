import {
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { http, seg } from '~/lib/api'
import type { SearchFilters, ShortlistEntry } from '~/lib/api-types'
import { nextCursor, qk, removeFromPages, STALE } from '~/lib/query'
import { cleanFilters, type SearchState, searchBody } from './search-params'

/**
 * Discovery data (15 section 10): home, recommendations, search, saved searches, shortlist and
 * visits. Keys and stale times from 17 section 6.2; cache effects from 17 section 6.3.
 */

export function useHome() {
  return useQuery({
    queryKey: qk.home(),
    queryFn: ({ signal }) => http.get('/v1/home', { signal }),
    staleTime: STALE.home,
  })
}

export function useRecommendations() {
  return useInfiniteQuery({
    queryKey: qk.recommendations(),
    queryFn: ({ pageParam, signal }) =>
      http.get('/v1/recommendations', {
        query: { limit: 20, cursor: pageParam },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
    staleTime: STALE.list,
  })
}

/**
 * `POST /v1/recommendations/refresh` (202). The screen shows its refreshing banner and refetches
 * on its own schedule (16 section 6.5); `rate_limited` is answered with the screen's own toast.
 */
export function useRefreshRecommendations() {
  return useMutation({
    mutationFn: () => http.post('/v1/recommendations/refresh'),
    meta: { handles: ['rate_limited'] },
  })
}

/** `POST /v1/search`, infinite. Disabled until the member runs a search (`state` not null). */
export function useSearch(state: SearchState | null) {
  const filters = cleanFilters(state?.filters ?? {})
  const sort = state?.sort ?? 'best_match'
  return useInfiniteQuery({
    queryKey: qk.search(filters, sort),
    queryFn: ({ pageParam }) => http.post('/v1/search', searchBody({ filters, sort }, pageParam)),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
    enabled: state !== null,
    staleTime: STALE.list,
    // Search shows `validation_failed` on the form and `rate_limited` as a toast (16 section 6.6).
    meta: { handles: ['validation_failed'] },
  })
}

export function useSavedSearches() {
  return useQuery({
    queryKey: qk.savedSearches(),
    queryFn: ({ signal }) => http.get('/v1/me/saved-searches', { signal }),
    select: (page) => page.items,
    staleTime: STALE.savedSearches,
  })
}

function invalidateSavedSearches(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: qk.savedSearches() })
}

export type SaveSearchBody = { name: string; filters: SearchFilters; notify_new: boolean }

export function useCreateSavedSearch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: SaveSearchBody) =>
      http.post('/v1/me/saved-searches', {
        ...body,
        filters: cleanFilters(body.filters),
      }),
    meta: { limitText: 'discovery:saved.limit', handles: ['validation_failed'] },
    onSuccess: () => invalidateSavedSearches(queryClient),
  })
}

export function useUpdateSavedSearch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; notify_new?: boolean }) =>
      http.patch(`/v1/me/saved-searches/${seg(id)}`, body),
    meta: { handles: ['validation_failed'] },
    onSuccess: () => invalidateSavedSearches(queryClient),
  })
}

export function useDeleteSavedSearch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => http.delete(`/v1/me/saved-searches/${seg(id)}`),
    onSuccess: () => invalidateSavedSearches(queryClient),
  })
}

/** `GET /v1/profiles/by-code/{public_code}` for "Find" on `APP-SEARCH` (an action, not cached). */
export function useFindProfileCode() {
  return useMutation({
    mutationFn: (code: string) => http.get(`/v1/profiles/by-code/${seg(code)}`),
    meta: { handles: ['not_found'] },
  })
}

// ---------------------------------------------------------------------------
// Shortlist and visits
// ---------------------------------------------------------------------------

export function useShortlist() {
  return useInfiniteQuery({
    queryKey: qk.shortlist(),
    queryFn: ({ pageParam, signal }) =>
      http.get('/v1/shortlist', {
        query: { limit: 20, cursor: pageParam },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
    staleTime: STALE.list,
  })
}

/**
 * "Remove" on `APP-SHORTLIST` (16 section 6.13): optimistic, the row leaves the list at once and
 * comes back on error. Works with `profile_id` alone, so a "No longer available" row can go.
 */
export function useRemoveFromShortlist() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (entry: ShortlistEntry) => http.delete(`/v1/shortlist/${seg(entry.profile_id)}`),
    onMutate: async (entry) => {
      await queryClient.cancelQueries({ queryKey: qk.shortlist() })
      const previous = queryClient.getQueriesData({ queryKey: qk.shortlist() })
      removeFromPages<ShortlistEntry>(
        queryClient,
        qk.shortlist(),
        (item) => item.profile_id === entry.profile_id,
      )
      return { previous }
    },
    onError: (_error, _entry, context) => {
      for (const [key, data] of context?.previous ?? []) queryClient.setQueryData(key, data)
    },
    onSuccess: (_data, entry) => {
      queryClient.setQueryData<{ relation: { is_shortlisted: boolean } }>(
        qk.profile(entry.profile_id),
        (detail) =>
          detail ? { ...detail, relation: { ...detail.relation, is_shortlisted: false } } : detail,
      )
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.shortlist() }),
  })
}

/** "Undo" of the remove toast and "Edit note": `PUT /v1/shortlist/{profile_id}` with the note. */
export function usePutShortlistNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ profileId, note }: { profileId: string; note: string | null }) =>
      http.put(`/v1/shortlist/${seg(profileId)}`, note ? { note } : {}),
    meta: { limitText: 'shared:shortlist.full' },
    onSuccess: (_data, { profileId, note }) => {
      queryClient.setQueryData<{
        relation: { is_shortlisted: boolean; shortlist_note: string | null }
      }>(qk.profile(profileId), (detail) =>
        detail
          ? {
              ...detail,
              relation: { ...detail.relation, is_shortlisted: true, shortlist_note: note },
            }
          : detail,
      )
      return queryClient.invalidateQueries({ queryKey: qk.shortlist() })
    },
  })
}

export function useVisitors() {
  return useInfiniteQuery({
    queryKey: qk.visitors(),
    queryFn: ({ pageParam, signal }) =>
      http.get('/v1/me/visitors', {
        query: { limit: 20, cursor: pageParam },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
    staleTime: STALE.list,
  })
}

export function useVisited() {
  return useInfiniteQuery({
    queryKey: qk.visited(),
    queryFn: ({ pageParam, signal }) =>
      http.get('/v1/me/visited', {
        query: { limit: 20, cursor: pageParam },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
    staleTime: STALE.list,
  })
}
