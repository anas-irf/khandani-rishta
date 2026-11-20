import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http, seg } from '~/lib/api'
import type { SectionBodies } from '~/lib/api-types'
import type { OnboardingStep } from '~/lib/gate'
import { invalidateMe, qk, STALE, setMe } from '~/lib/query'

/**
 * Own profile and onboarding (15 section 7). Cache effects follow 17 section 6.3:
 * a section save sets `['me', 'profile']` and invalidates `['me']`, `['home']` and
 * `['recommendations']`; continue, complete and resubmit set `['me']` from the response.
 */

export type EditableSection = Exclude<keyof SectionBodies, 'contacts'>

/** `GET /v1/me/profile`. Never served stale: forms are always filled from a fresh copy (08 2). */
export function useOwnProfile() {
  return useQuery({
    queryKey: qk.ownProfile(),
    queryFn: ({ signal }) => http.get('/v1/me/profile', { signal }),
    staleTime: STALE.none,
    refetchOnMount: 'always',
  })
}

/** `PUT /v1/me/profile/sections/{section}` with the whole section. */
export function useSaveSection<S extends EditableSection>(section: S) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: SectionBodies[S]) =>
      http.put(`/v1/me/profile/sections/${seg(section)}`, body),
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

/** `POST /v1/me/onboarding/continue`: marks the current step done and returns `Me`. */
export function useOnboardingContinue() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (step: OnboardingStep) => http.post('/v1/me/onboarding/continue', { step }),
    meta: { handles: ['invalid_state', 'internal_error', 'service_unavailable', 'network_error'] },
    onSuccess: (me) => setMe(queryClient, me),
  })
}

/** `POST /v1/me/onboarding/complete` (no body): returns `Me` with the new gate. */
export function useOnboardingComplete() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => http.post('/v1/me/onboarding/complete'),
    meta: { handles: ['invalid_state', 'internal_error', 'service_unavailable', 'network_error'] },
    onSuccess: (me) => setMe(queryClient, me),
  })
}

/** `POST /v1/me/profile/resubmit` (no body): a `changes_requested` profile goes back to review. */
export function useResubmitProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => http.post('/v1/me/profile/resubmit'),
    meta: { handles: ['invalid_state'] },
    onSuccess: (me) => setMe(queryClient, me),
  })
}

/** `GET /v1/me/profile/preview?as=...`: always refetched when the preview opens (08 4.2). */
export function useProfilePreview(as: 'member' | 'connection') {
  return useQuery({
    queryKey: qk.ownProfilePreview(as),
    queryFn: ({ signal }) => http.get('/v1/me/profile/preview', { query: { as }, signal }),
    staleTime: STALE.none,
    refetchOnMount: 'always',
  })
}
