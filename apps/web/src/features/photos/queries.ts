import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { http, seg } from '~/lib/api'
import type { OwnPhoto, UploadTicket } from '~/lib/api-types'
import {
  isUploadError,
  type PrepareOptions,
  prepareImage,
  UploadError,
  uploadWithProgress,
} from '~/lib/image'
import { invalidateMe, qk, STALE } from '~/lib/query'
import { realtimeStatus } from '~/lib/realtime'

/**
 * Own photos (15 section 8, 08 section 5). Every change waits for the server (08 section 5.5
 * rule 4); cache effects follow 17 section 6.3: set or invalidate `['me', 'photos']`, then
 * invalidate `['me', 'profile']` and `['me']`.
 */

/**
 * Polling while a photo is `processing` and no live socket delivers `photo.updated` (08 section
 * 5.2 step 6): every 3 seconds for the first minute after the upload, then every 15 seconds.
 */
export const PHOTO_POLL_FAST_MS = 3_000
export const PHOTO_POLL_SLOW_MS = 15_000
const PHOTO_POLL_FAST_FOR_MS = 60_000
/** At most this many uploads run at the same time (08 section 5.2 rule 1). */
export const MAX_PARALLEL_UPLOADS = 2
/** Rounds of "ticket, PUT" before a slot shows "Upload failed" (08 section 5.2 rule 2). */
export const UPLOAD_ROUNDS = 3
/** Extra PUT attempts with the same URL after a network error (08 section 5.2 rule 2). */
const PUT_RETRIES = 2
const CONFIRM_RETRIES = 2

export function sortPhotos(photos: OwnPhoto[]): OwnPhoto[] {
  return [...photos].sort((a, b) => a.position - b.position)
}

/** A photo that counts against `photos_max` (08 section 5.1). */
export function countsTowardLimit(photo: OwnPhoto): boolean {
  return photo.status !== 'rejected' && photo.status !== 'failed'
}

/**
 * The refetch interval of `GET /v1/me/photos` (08 section 5.2 step 6), or false to stop: no
 * polling once nothing is `processing` or while the socket is open.
 */
export function photoPollInterval(
  photos: readonly OwnPhoto[] | undefined,
  socketOpen: boolean,
  now: number = Date.now(),
): number | false {
  if (socketOpen || !photos) return false
  const processing = photos.filter((photo) => photo.status === 'processing')
  if (processing.length === 0) return false
  const newest = Math.max(...processing.map((photo) => Date.parse(photo.created_at) || now))
  return now - newest < PHOTO_POLL_FAST_FOR_MS ? PHOTO_POLL_FAST_MS : PHOTO_POLL_SLOW_MS
}

function statusSignature(photos: readonly OwnPhoto[]): string {
  return photos.map((photo) => `${photo.id}:${photo.status}:${photo.is_primary}`).join('|')
}

/** The cache effect of every photo change (17 section 6.3). */
function invalidateAfterPhotoChange(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: qk.ownProfile() })
  void invalidateMe(queryClient)
}

/**
 * `GET /v1/me/photos`. The real-time `photo.updated` event invalidates it; without a live
 * socket it is polled while a photo is `processing` (`photoPollInterval`). When a
 * refetch shows a status change, the own profile and `Me` are invalidated as well (the
 * primary photo and the completeness may have changed).
 */
export function useOwnPhotos() {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: qk.photos(),
    queryFn: async ({ signal }) => {
      const previous = queryClient.getQueryData<OwnPhoto[]>(qk.photos())
      const photos = sortPhotos(await http.get<OwnPhoto[]>('/v1/me/photos', { signal }))
      if (previous && statusSignature(previous) !== statusSignature(photos)) {
        invalidateAfterPhotoChange(queryClient)
      }
      return photos
    },
    staleTime: STALE.none,
    refetchInterval: (query) =>
      photoPollInterval(query.state.data, realtimeStatus.get() === 'open'),
  })
}

// ---------------------------------------------------------------------------
// Upload (08 section 5.2)
// ---------------------------------------------------------------------------

export type UploadStage = 'preparing' | 'uploading' | 'confirming'

export type UploadPhotoInput = {
  /** The picked file; it is prepared (08 section 5.1) before anything is sent. */
  file: Blob
  /** Upload progress of the current `PUT`, 0 to 1. */
  onProgress?: (fraction: number) => void
  onStage?: (stage: UploadStage) => void
  /** Cancels the upload (08 section 5.2 rule 4). */
  signal?: AbortSignal
  /** Overrides of the preparation (tests). */
  prepare?: PrepareOptions
}

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new UploadError('aborted')
}

/**
 * Step 4: `PUT` with the exact headers, retried up to 2 times on a network error while the
 * URL has not expired. Resolves false when a new ticket is needed (08 section 5.2 rule 2).
 */
export async function putWithRetries(
  ticket: Pick<UploadTicket, 'upload_url' | 'headers' | 'expires_at'>,
  blob: Blob,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<boolean> {
  const expires = Date.parse(ticket.expires_at)
  for (let attempt = 0; attempt <= PUT_RETRIES; attempt += 1) {
    if (attempt > 0) {
      await wait(400 * attempt, signal)
      throwIfAborted(signal)
      if (Number.isFinite(expires) && Date.now() >= expires) return false
    }
    try {
      await uploadWithProgress(ticket.upload_url, blob, ticket.headers, onProgress, signal)
      return true
    } catch (error) {
      if (isUploadError(error) && error.kind === 'aborted') throw error
      // A refused or expired URL needs a new ticket; only network errors retry this URL.
      if (!isUploadError(error) || error.kind !== 'network') return false
    }
  }
  return false
}

function isRetryableNetworkError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'network_error'
  )
}

/**
 * The whole client side of 08 section 5.2: prepare, request an upload URL, `PUT` the file,
 * confirm. Throws `ImageError` for a file that fails the checks of 08 section 5.1, `ApiError`
 * for `payload_too_large`, `limit_reached` or `rate_limited`, and `UploadError` after three
 * failed rounds or when cancelled.
 */
export async function uploadOwnPhoto({
  file,
  onProgress,
  onStage,
  signal,
  prepare,
}: UploadPhotoInput): Promise<OwnPhoto> {
  onStage?.('preparing')
  const prepared = await prepareImage(file, prepare)
  throwIfAborted(signal)

  for (let round = 0; round < UPLOAD_ROUNDS; round += 1) {
    const ticket = await http.post<UploadTicket>(
      '/v1/me/photos/uploads',
      { content_type: prepared.blob.type, size_bytes: prepared.blob.size },
      { signal },
    )
    onStage?.('uploading')
    const uploaded = await putWithRetries(ticket, prepared.blob, onProgress, signal)
    throwIfAborted(signal)
    if (!uploaded) continue

    onStage?.('confirming')
    // Confirming the same key twice returns the same photo, so it is safe to repeat.
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await http.post<OwnPhoto>('/v1/me/photos', { upload_key: ticket.upload_key })
      } catch (error) {
        if (attempt >= CONFIRM_RETRIES || !isRetryableNetworkError(error)) throw error
        await wait(400 * (attempt + 1))
      }
    }
  }
  throw new UploadError('network')
}

/** Puts a confirmed photo into the cached list (17 section 6.3). */
function storeConfirmedPhoto(queryClient: QueryClient, photo: OwnPhoto) {
  const current = queryClient.getQueryData<OwnPhoto[]>(qk.photos())
  if (current) {
    const others = current.filter((entry) => entry.id !== photo.id)
    queryClient.setQueryData(qk.photos(), sortPhotos([...others, photo]))
  } else {
    void queryClient.invalidateQueries({ queryKey: qk.photos(), exact: true })
  }
  invalidateAfterPhotoChange(queryClient)
}

/**
 * One photo upload, from the picked file to the confirmed `OwnPhoto` (status `processing`).
 * The caller shows the errors on the slot, so the global handler stays silent for them.
 */
export function useUploadPhoto() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: uploadOwnPhoto,
    meta: {
      handles: [
        'limit_reached',
        'payload_too_large',
        'rate_limited',
        'not_found',
        'network_error',
        'internal_error',
        'service_unavailable',
      ],
    },
    onSuccess: (photo) => storeConfirmedPhoto(queryClient, photo),
  })
}

// ---------------------------------------------------------------------------
// Primary, order, delete (08 section 5.5)
// ---------------------------------------------------------------------------

/** "Make main photo": `PATCH /v1/me/photos/{id}` with `{ "is_primary": true }`. */
export function useMakePrimary() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (photoId: string) =>
      http.patch<OwnPhoto[]>(`/v1/me/photos/${seg(photoId)}`, { is_primary: true }),
    meta: { handles: ['invalid_state'] },
    onSuccess: (photos) => {
      queryClient.setQueryData(qk.photos(), sortPhotos(photos))
      invalidateAfterPhotoChange(queryClient)
    },
  })
}

/** Reorder: `PUT /v1/me/photos/order` listing every photo once. */
export function useReorderPhotos() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (photoIds: string[]) =>
      http.put<OwnPhoto[]>('/v1/me/photos/order', { photo_ids: photoIds }),
    // Any failure shows "Could not save the new order. Try again." (08 section 5.5).
    meta: {
      handles: [
        'bad_request',
        'not_found',
        'invalid_state',
        'rate_limited',
        'network_error',
        'internal_error',
        'service_unavailable',
      ],
    },
    onSuccess: (photos) => {
      queryClient.setQueryData(qk.photos(), sortPhotos(photos))
      invalidateAfterPhotoChange(queryClient)
    },
  })
}

/** "Remove": `DELETE /v1/me/photos/{id}`, then the list is refetched. */
export function useDeletePhoto() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (photoId: string) => http.delete(`/v1/me/photos/${seg(photoId)}`),
    onSuccess: async () => {
      invalidateAfterPhotoChange(queryClient)
      await queryClient.invalidateQueries({ queryKey: qk.photos(), exact: true })
    },
  })
}

/** Moves one id earlier (-1) or later (+1) in the list; unchanged at the ends. */
export function moveId(ids: readonly string[], id: string, delta: -1 | 1): string[] {
  const from = ids.indexOf(id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= ids.length) return [...ids]
  const next = [...ids]
  next.splice(from, 1)
  next.splice(to, 0, id)
  return next
}

/** Moves one id to the position of another (drag and drop). */
export function moveIdTo(ids: readonly string[], id: string, targetId: string): string[] {
  const from = ids.indexOf(id)
  const to = ids.indexOf(targetId)
  if (from < 0 || to < 0 || from === to) return [...ids]
  const next = [...ids]
  next.splice(from, 1)
  next.splice(to, 0, id)
  return next
}
