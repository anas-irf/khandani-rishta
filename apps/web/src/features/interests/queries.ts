import {
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { http, isApiError, seg } from '~/lib/api'
import type { Interest, InterestBox, InterestListStatus } from '~/lib/api-types'
import { showLimitDialog } from '~/lib/dialogs'
import { invalidateMe, nextCursor, qk, STALE, updateInPages } from '~/lib/query'

/**
 * Interests (15 section 11). Cache effects follow 17 section 6.3; nothing here is optimistic
 * (16 rule G7: sending, accepting, declining and withdrawing wait for the server).
 */

export function useInterests(box: InterestBox, status: InterestListStatus) {
  return useInfiniteQuery({
    queryKey: qk.interests(box, status),
    queryFn: ({ pageParam, signal }) =>
      http.get('/v1/interests', {
        query: { box, status, limit: 20, cursor: pageParam },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
    staleTime: STALE.list,
  })
}

function invalidateAfterInterestChange(queryClient: QueryClient, profileId: string | undefined) {
  void queryClient.invalidateQueries({ queryKey: qk.interestsAll() })
  void invalidateMe(queryClient)
  if (profileId) void queryClient.invalidateQueries({ queryKey: qk.profile(profileId) })
}

export type SendInterestVariables = { receiver_profile_id: string; message?: string }

/**
 * `POST /v1/interests`. The screen decides how to show `not_permitted_by_member`,
 * `cooldown_active`, `interest_already_pending` and `already_connected`, so they are listed in
 * `handles`; pass your own `limitText` key through `options.limitText` for the daily limit text.
 */
export function useSendInterest(options: { limitText?: string } = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: SendInterestVariables) =>
      http.post('/v1/interests', {
        receiver_profile_id: body.receiver_profile_id,
        ...(body.message ? { message: body.message } : {}),
      }),
    meta: {
      handles: [
        'not_permitted_by_member',
        'cooldown_active',
        'interest_already_pending',
        'already_connected',
        'validation_failed',
      ],
      limitText: options.limitText,
    },
    onSuccess: (result, variables) => {
      void queryClient.invalidateQueries({ queryKey: qk.interestsSent() })
      void queryClient.invalidateQueries({ queryKey: qk.profile(variables.receiver_profile_id) })
      void invalidateMe(queryClient)
      if (result.connection) {
        void queryClient.invalidateQueries({ queryKey: qk.connectionsAll() })
        void queryClient.invalidateQueries({ queryKey: qk.interestsAll() })
      }
    },
  })
}

/**
 * The limit dialog text for accepting (16 section 6.9): the connection cap is full on the
 * member's side (`you`) or on the sender's side (`them`).
 */
export function acceptLimitText(side: unknown): string | null {
  if (side === 'you') return 'interests:limit.accept_you'
  if (side === 'them') return 'interests:limit.accept_them'
  return null
}

/**
 * Accept: invalidate interests, connections, Me and the profile; the screen opens the chat.
 * `limit_reached` opens the limit dialog with the text for `details.side` (16 section 6.9).
 * Pass `handles` for the codes the screen handles itself (for example `invalid_state`).
 */
export function useAcceptInterest(options: { limitText?: string; handles?: string[] } = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (interest: { id: string; profileId?: string }) =>
      http.post(`/v1/interests/${seg(interest.id)}/accept`),
    meta: { limitText: options.limitText, handles: ['limit_reached', ...(options.handles ?? [])] },
    onSuccess: (result, interest) => {
      queryClient.setQueryData(qk.connection(result.connection.id), result.connection)
      void queryClient.invalidateQueries({ queryKey: qk.connectionsAll() })
      invalidateAfterInterestChange(queryClient, interest.profileId)
    },
    onError: (error) => {
      if (!isApiError(error) || error.code !== 'limit_reached') return
      showLimitDialog({
        textKey: acceptLimitText(error.details.side) ?? options.limitText ?? null,
        details: error.details,
      })
    },
  })
}

export function useDeclineInterest(options: { handles?: string[] } = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (interest: { id: string; profileId?: string; alsoBlock?: boolean }) =>
      http.post(
        `/v1/interests/${seg(interest.id)}/decline`,
        interest.alsoBlock ? { also_block: true } : {},
      ),
    meta: options.handles ? { handles: options.handles } : undefined,
    onSuccess: (_result, interest) => {
      invalidateAfterInterestChange(queryClient, interest.profileId)
      if (interest.alsoBlock) {
        void queryClient.invalidateQueries({ queryKey: qk.blocks() })
        void queryClient.invalidateQueries({ queryKey: qk.home() })
        void queryClient.invalidateQueries({ queryKey: qk.recommendations() })
      }
    },
  })
}

export function useWithdrawInterest(options: { handles?: string[] } = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (interest: { id: string; profileId?: string }) =>
      http.post(`/v1/interests/${seg(interest.id)}/withdraw`),
    meta: options.handles ? { handles: options.handles } : undefined,
    onSuccess: (_result, interest) =>
      invalidateAfterInterestChange(queryClient, interest.profileId),
  })
}

/**
 * Marks received interests as seen (`POST /v1/interests/seen`). Fire and forget: failures are
 * ignored (16 section 6.9). On success the dots disappear from the cached lists.
 */
export function useMarkInterestsSeen() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (interestIds: string[]) =>
      http.post('/v1/interests/seen', { interest_ids: interestIds }),
    meta: {
      handles: [
        'internal_error',
        'service_unavailable',
        'network_error',
        'bad_request',
        'not_found',
        'invalid_state',
        'rate_limited',
        'forbidden',
      ],
    },
    onSuccess: (_result, interestIds) => {
      const seen = new Set(interestIds)
      updateInPages<Interest>(queryClient, qk.interestsAll(), (interest) =>
        seen.has(interest.id) ? { ...interest, seen: true } : interest,
      )
    },
  })
}
