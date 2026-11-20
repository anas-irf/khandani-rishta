import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http, seg } from '~/lib/api'
import type { Home, Interest, ProfileCard, ShortlistEntry, Visit } from '~/lib/api-types'
import { invalidateMe, qk, removeFromPages, STALE, updateInPages } from '~/lib/query'

/**
 * Another member's profile (15 section 10). `['profile', id]` is fresh for 60 seconds
 * (17 section 6.2); the photo viewer accepts a copy up to 60 minutes old (16 section 6.8).
 */
export function useProfile(profileId: string, options: { staleTime?: number } = {}) {
  return useQuery({
    queryKey: qk.profile(profileId),
    queryFn: ({ signal }) => http.get(`/v1/profiles/${seg(profileId)}`, { signal }),
    staleTime: options.staleTime ?? STALE.list,
    // The screen answers these itself (16 section 6.7, "Errors on load").
    meta: { handles: ['not_found', 'limit_reached'] },
  })
}

/** `GET /v1/profiles/by-code/{public_code}` for the shared link `/p/$publicCode`. */
export function useProfileByCode(publicCode: string) {
  return useQuery({
    queryKey: qk.profileByCode(publicCode),
    queryFn: ({ signal }) => http.get(`/v1/profiles/by-code/${seg(publicCode)}`, { signal }),
    staleTime: STALE.list,
    meta: { handles: ['not_found'] },
  })
}

/**
 * "Let {name} see my photos" (16 section 6.7): `PUT /v1/me/photo-access/grants/{profile_id}`.
 * Invalidates `['photo-access', *]`, `['profile', id]` and `['me']` (17 section 6.3).
 */
export function useGrantPhotosTo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (profileId: string) => http.put(`/v1/me/photo-access/grants/${seg(profileId)}`),
    onSuccess: (_data, profileId) => {
      void queryClient.invalidateQueries({ queryKey: qk.photoAccessAll() })
      void queryClient.invalidateQueries({ queryKey: qk.profile(profileId) })
      void invalidateMe(queryClient)
    },
  })
}

/**
 * After `not_found` for a profile: the member leaves the cached lists (16 section 1.3). Discovery
 * lists drop the card; the shortlist keeps the entry as "No longer available" (16 section 6.13).
 */
export function forgetProfile(queryClient: QueryClient, profileId: string) {
  const without = (cards: ProfileCard[]) => cards.filter((card) => card.id !== profileId)
  queryClient.setQueryData<Home>(qk.home(), (home) =>
    home
      ? {
          ...home,
          recommendations: without(home.recommendations),
          new_members: without(home.new_members),
          nearby: without(home.nearby),
          recent_visitors: without(home.recent_visitors),
        }
      : home,
  )
  removeFromPages<ProfileCard>(queryClient, qk.recommendations(), (card) => card.id === profileId)
  removeFromPages<ProfileCard>(queryClient, qk.searchAll(), (card) => card.id === profileId)
  removeFromPages<Visit>(queryClient, qk.visitors(), (visit) => visit.profile.id === profileId)
  removeFromPages<Visit>(queryClient, qk.visited(), (visit) => visit.profile.id === profileId)
  removeFromPages<Interest>(
    queryClient,
    qk.interestsAll(),
    (interest) => interest.profile?.id === profileId,
  )
  updateInPages<ShortlistEntry>(queryClient, qk.shortlist(), (entry) =>
    entry.profile_id === profileId ? { ...entry, profile: null } : entry,
  )
}
