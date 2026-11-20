import { type InfiniteData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '~/lib/api'
import type { Connection, ContactsSection, Page } from '~/lib/api-types'
import { invalidateMe, qk, STALE } from '~/lib/query'

/**
 * Data of the own-profile screens that the shared feature hooks do not cover: the privacy
 * settings shown on `ME-PROFILE` and `ME-PHOTOS`, and the contact details of `SET-CONTACTS`.
 */

/** `GET /v1/me/privacy` (17 section 6.2: `['me', 'privacy']`, never stale). */
export function usePrivacy() {
  return useQuery({
    queryKey: qk.privacy(),
    queryFn: ({ signal }) => http.get('/v1/me/privacy', { signal }),
    staleTime: STALE.none,
  })
}

/**
 * `PUT /v1/me/profile/sections/contacts` with the whole `ContactsSection` (08 section 3).
 * Cache effect of a section save (17 section 6.3): set `['me', 'profile']` from the response,
 * invalidate `['me']`, `['home']` and `['recommendations']`.
 */
export function useSaveContacts() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: ContactsSection) => http.put('/v1/me/profile/sections/contacts', body),
    // The form shows network and server failures inline with "Try again" (08 section 2.5).
    meta: { handles: ['internal_error', 'service_unavailable', 'network_error'] },
    onSuccess: (profile) => {
      queryClient.setQueryData(qk.ownProfile(), profile)
      void invalidateMe(queryClient)
      void queryClient.invalidateQueries({ queryKey: qk.home() })
      void queryClient.invalidateQueries({ queryKey: qk.recommendations() })
    },
  })
}

type ConnectionsData = InfiniteData<Page<Connection>, string | undefined>

/**
 * Whether the member shares contact details with any connection, from the connection lists
 * already in the cache (08 section 3.6 reads it from `my_contact_share` on that list).
 */
export function useHasActiveContactShare(): boolean {
  const queryClient = useQueryClient()
  const lists = queryClient.getQueriesData<ConnectionsData>({ queryKey: qk.connectionsAll() })
  return lists.some(([, data]) =>
    data?.pages?.some((page) =>
      page.items?.some((connection) => connection.my_contact_share?.status === 'active'),
    ),
  )
}
