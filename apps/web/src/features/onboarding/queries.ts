import { useMutation, useQueryClient } from '@tanstack/react-query'
import { http } from '~/lib/api'
import type { Privacy } from '~/lib/api-types'
import { qk } from '~/lib/query'

/**
 * `PATCH /v1/me/privacy` with the photo visibility chosen on ONB-08 (07 section 10.2). Sets
 * `['me', 'privacy']` from the response (17 section 6.3).
 */
export function useSetPhotoVisibility() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (photoVisibility: Privacy['photo_visibility']) =>
      http.patch<Privacy>('/v1/me/privacy', { photo_visibility: photoVisibility }),
    meta: { handles: ['internal_error', 'service_unavailable', 'network_error'] },
    onSuccess: (privacy) => queryClient.setQueryData(qk.privacy(), privacy),
  })
}
