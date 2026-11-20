import {
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { InfiniteListQuery } from '~/components/common/InfiniteList'
import { http, seg } from '~/lib/api'
import type { Page, PhotoAccessEntry } from '~/lib/api-types'
import { invalidateMe, nextCursor, qk, removeFromPages, STALE } from '~/lib/query'

/**
 * Photo access requests, received and sent (15 section 13). The viewer's request itself
 * (`POST /v1/profiles/{id}/photo-access`) is `useRequestPhotoAccess` in `features/relations`.
 * Cache effects of grant, deny and revoke follow 17 section 6.3: `['photo-access', *]`,
 * `['profile', id]` and `['me']`.
 */

export type PhotoAccessBox = 'received' | 'sent'
export type PhotoAccessStatus = 'pending' | 'granted'

/** `GET /v1/me/photo-access?box=...&status=...`, `limit=20` (16 rule G6). */
export function usePhotoAccess(box: PhotoAccessBox, status: PhotoAccessStatus) {
  return useInfiniteQuery({
    queryKey: qk.photoAccess(box, status),
    queryFn: ({ pageParam, signal }) =>
      http.get<Page<PhotoAccessEntry>>('/v1/me/photo-access', {
        query: { box, status, limit: 20, cursor: pageParam },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => nextCursor(page),
    staleTime: STALE.list,
  })
}

/**
 * The "Sent" tab: the pending requests, then the approved ones listed under them (16 section
 * 6.16), as one list for `InfiniteList`. The second list is loaded after the first runs out.
 */
export function useSentPhotoAccess(): InfiniteListQuery<PhotoAccessEntry> {
  const pending = usePhotoAccess('sent', 'pending')
  const granted = usePhotoAccess('sent', 'granted')
  const both = pending.data && granted.data ? [pending.data, granted.data] : null

  return {
    data: both ? { pages: both.flatMap((data) => data.pages) } : undefined,
    isPending: pending.isPending || granted.isPending,
    isError: pending.isError || granted.isError,
    error: pending.error ?? granted.error,
    isFetching: pending.isFetching || granted.isFetching,
    isFetchingNextPage: pending.isFetchingNextPage || granted.isFetchingNextPage,
    isFetchNextPageError: pending.isFetchNextPageError || granted.isFetchNextPageError,
    hasNextPage: pending.hasNextPage || granted.hasNextPage,
    fetchNextPage: () => (pending.hasNextPage ? pending.fetchNextPage() : granted.fetchNextPage()),
    refetch: () => Promise.all([pending.refetch(), granted.refetch()]),
  }
}

function afterChange(queryClient: QueryClient, profileId: string) {
  void queryClient.invalidateQueries({ queryKey: qk.photoAccessAll() })
  void queryClient.invalidateQueries({ queryKey: qk.profile(profileId) })
  void invalidateMe(queryClient)
}

/** `invalid_state` and `not_found`: the request was answered or withdrawn elsewhere, refetch. */
function refetchAll(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: qk.photoAccessAll() })
  void invalidateMe(queryClient)
}

const STALE_REQUEST_CODES = ['invalid_state', 'not_found'] as const

export type DecideVariables = {
  entry: PhotoAccessEntry
  /** The name for the toast; "This member" when the profile is no longer available. */
  name: string
}

/**
 * `POST /v1/me/photo-access/{id}/grant`: the item leaves "Waiting" and shows under "Approved";
 * the toast names the member (16 section 6.16).
 */
export function useGrantPhotoAccess() {
  const queryClient = useQueryClient()
  const { t } = useTranslation('photo_requests')
  return useMutation({
    mutationFn: ({ entry }: DecideVariables) =>
      http.post(`/v1/me/photo-access/${seg(entry.id)}/grant`),
    meta: { handles: STALE_REQUEST_CODES },
    onSuccess: (_data, { entry, name }) => {
      removeFromPages<PhotoAccessEntry>(
        queryClient,
        qk.photoAccess('received', 'pending'),
        (item) => item.id === entry.id,
      )
      toast.success(t('approved_toast', { name }))
      afterChange(queryClient, entry.profile_id)
    },
    onError: () => refetchAll(queryClient),
  })
}

/** `POST /v1/me/photo-access/{id}/deny`: the item leaves the list; the requester is not told. */
export function useDenyPhotoAccess() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ entry }: DecideVariables) =>
      http.post(`/v1/me/photo-access/${seg(entry.id)}/deny`),
    meta: { handles: STALE_REQUEST_CODES },
    onSuccess: (_data, { entry }) => {
      removeFromPages<PhotoAccessEntry>(
        queryClient,
        qk.photoAccess('received', 'pending'),
        (item) => item.id === entry.id,
      )
      afterChange(queryClient, entry.profile_id)
    },
    onError: () => refetchAll(queryClient),
  })
}

/**
 * `DELETE /v1/me/photo-access/grants/{profile_id}`: works from the `profile_id` of the entry, so
 * a member that is no longer available can still lose access (15 section 13).
 */
export function useRevokePhotoAccess() {
  const queryClient = useQueryClient()
  const { t } = useTranslation('photo_requests')
  return useMutation({
    mutationFn: (entry: PhotoAccessEntry) =>
      http.delete(`/v1/me/photo-access/grants/${seg(entry.profile_id)}`),
    onSuccess: (_data, entry) => {
      removeFromPages<PhotoAccessEntry>(
        queryClient,
        qk.photoAccess('received', 'granted'),
        (item) => item.profile_id === entry.profile_id,
      )
      toast.success(t('access_removed'))
      afterChange(queryClient, entry.profile_id)
    },
  })
}
