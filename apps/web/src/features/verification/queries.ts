import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { putWithRetries } from '~/features/photos/queries'
import { http, seg } from '~/lib/api'
import type { VerificationSubmitBody } from '~/lib/api-types'
import { UploadError } from '~/lib/image'
import { invalidateMe, qk, STALE } from '~/lib/query'

/**
 * Verification (15 section 9, 12). Submitting or cancelling invalidates `['me', 'identity']`,
 * `['me', 'verifications']`, `['me', 'profile']` and `['me']` (17 section 6.3).
 */

export type VerificationSlot = 'front' | 'back' | 'selfie'

/** `GET /v1/me/verifications`, on open and when returning from a sub-screen (16 6.21). */
export function useVerifications() {
  return useQuery({
    queryKey: qk.verifications(),
    queryFn: ({ signal }) => http.get('/v1/me/verifications', { signal }),
    staleTime: STALE.none,
    refetchOnMount: 'always',
  })
}

/** `GET /v1/me/verifications/selfie-challenge`: today's gesture (12 section 4.2). */
export function useSelfieChallenge() {
  return useQuery({
    queryKey: qk.selfieChallenge(),
    queryFn: ({ signal }) => http.get('/v1/me/verifications/selfie-challenge', { signal }),
    select: (data) => data.gesture,
    staleTime: STALE.none,
    refetchOnMount: 'always',
  })
}

function invalidateVerificationData(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: qk.identity() })
  void queryClient.invalidateQueries({ queryKey: qk.verifications() })
  void queryClient.invalidateQueries({ queryKey: qk.ownProfile() })
  void invalidateMe(queryClient)
}

/** Errors the verification screens show themselves (16 sections 6.22 and 6.23). */
const SCREEN_HANDLED = [
  'invalid_state',
  'already_exists',
  'payload_too_large',
  'network_error',
  'internal_error',
  'service_unavailable',
  'not_found',
] as const

export type UploadImageInput = {
  slot: VerificationSlot
  blob: Blob
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

/**
 * One upload round: `POST /v1/me/verifications/uploads` for the slot, then the `PUT` of the
 * file with the returned headers (12 sections 4.3 and 5.2). Resolves the `upload_key`.
 */
export async function uploadVerificationImage({
  slot,
  blob,
  onProgress,
  signal,
}: UploadImageInput): Promise<string> {
  const ticket = await http.post(
    '/v1/me/verifications/uploads',
    { slot, content_type: blob.type, size_bytes: blob.size },
    { signal },
  )
  const uploaded = await putWithRetries(ticket, blob, onProgress, signal)
  if (!uploaded) throw new UploadError('network')
  return ticket.upload_key
}

export function useUploadVerificationImage() {
  return useMutation({
    mutationFn: uploadVerificationImage,
    meta: { handles: SCREEN_HANDLED },
  })
}

/** `POST /v1/me/verifications` (15 section 9). */
export function useSubmitVerification() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: VerificationSubmitBody) => http.post('/v1/me/verifications', body),
    meta: { handles: SCREEN_HANDLED },
    onSuccess: () => invalidateVerificationData(queryClient),
  })
}

/** `DELETE /v1/me/verifications/{request_id}`: cancels a pending request. */
export function useCancelVerification() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (requestId: string) => http.delete(`/v1/me/verifications/${seg(requestId)}`),
    onSuccess: () => invalidateVerificationData(queryClient),
    onError: () => invalidateVerificationData(queryClient),
  })
}

/** Refetches the state after an `invalid_state` answer (16 section 6.23). */
export function useRefreshVerificationState() {
  const queryClient = useQueryClient()
  return () => invalidateVerificationData(queryClient)
}
