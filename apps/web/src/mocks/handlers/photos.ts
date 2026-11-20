import { HttpResponse, http } from 'msw'
import type {
  OwnPhoto,
  OwnPhotoStatus,
  OwnProfile,
  UploadContentType,
  UploadTicket,
} from '~/lib/api-types'
import { db } from '../db'
import { placeholderPhotoUrl } from '../factories'
import { apiError, apiUrl, newId, noContent, notFound, nowIso, readJson } from '../http'
import { gateErrorFor } from './account'

/**
 * 15 section 8: own photos, with the direct upload to storage (08 section 5.2). The mock
 * storage lives at `MOCK_STORAGE_ORIGIN`; `PUT` there records the object so the confirmation
 * can check it exists. A confirmed photo is `processing` and turns into the outcome of
 * `photoMockState().outcome` once `processingMs` have passed (checked on every read, and by a
 * timer in development), as the `process_photo` job would.
 */

export const MOCK_STORAGE_ORIGIN = 'https://r2.mock.local'
const MAX_BYTES = 10 * 1024 * 1024
const CONTENT_TYPES: readonly UploadContentType[] = ['image/jpeg', 'image/png', 'image/webp']

export type StoredObject = {
  contentType: string
  declaredBytes: number
  uploadedBytes: number | null
}

export type PhotoMockState = {
  /** Delay between the confirmation and the end of processing. */
  processingMs: number
  /** What processing turns a photo into. */
  outcome: Exclude<OwnPhotoStatus, 'processing'>
  /** The rejection reason when `outcome` is `rejected`. */
  rejectionReason: NonNullable<OwnPhoto['rejection_reason']>
  /** Storage objects by key (photo and verification uploads share the bucket). */
  objects: Map<string, StoredObject>
  /** Processing deadline of each confirmed photo still `processing`. */
  jobs: Map<string, { readyAt: number }>
  /** Photo id of each confirmed upload key (a second confirmation returns the same photo). */
  confirmed: Map<string, string>
}

/** Mock-only settings and storage, kept in `db.extra` so `resetDb()` clears them. */
export function photoMockState(): PhotoMockState {
  const existing = db.extra.photos as PhotoMockState | undefined
  if (existing) return existing
  const state: PhotoMockState = {
    processingMs: 2000,
    outcome: 'approved',
    rejectionReason: 'low_quality',
    objects: new Map(),
    jobs: new Map(),
    confirmed: new Map(),
  }
  db.extra.photos = state
  return state
}

export function storageUrl(key: string): string {
  return `${MOCK_STORAGE_ORIGIN}/uploads/${key}`
}

/** A presigned-upload ticket for a key (15 section 8), valid for 10 minutes. */
export function uploadTicket(key: string, contentType: string, sizeBytes: number): UploadTicket {
  photoMockState().objects.set(key, {
    contentType,
    declaredBytes: sizeBytes,
    uploadedBytes: null,
  })
  return {
    upload_key: key,
    upload_url: storageUrl(key),
    headers: { 'Content-Type': contentType },
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  }
}

function sorted(photos: OwnPhoto[]): OwnPhoto[] {
  return [...photos].sort((a, b) => a.position - b.position)
}

function counted(photo: OwnPhoto): boolean {
  return photo.status !== 'rejected' && photo.status !== 'failed'
}

function clearPhotoVerified() {
  db.ownProfile.verification = { ...db.ownProfile.verification, photo_verified: false }
  db.me.profile.badges = db.me.profile.badges.filter((badge) => badge !== 'photo_verified')
  db.ownProfile.missing = db.ownProfile.missing.filter((item) => item !== 'photo_verified')
}

/**
 * Keeps `db.ownPhotos`, `db.ownProfile.photos` and `db.me.profile.photo` consistent, applies
 * the primary photo rules (03 section 4.4: only an approved photo is primary; when none is,
 * the approved photo with the lowest position becomes primary) and the photo items of the
 * `missing` list (08 section 6.2).
 */
export function syncPhotos(photos: OwnPhoto[] = db.ownPhotos) {
  let list = sorted(photos)
  const approved = list.filter((photo) => photo.status === 'approved')
  const before = db.ownPhotos.find((photo) => photo.is_primary)?.id ?? null
  let primary = list.find((photo) => photo.is_primary && photo.status === 'approved') ?? null
  if (!primary) primary = approved[0] ?? null
  list = list.map((photo) => ({ ...photo, is_primary: photo.id === primary?.id }))

  db.ownPhotos = list
  db.ownProfile.photos = list
  db.me.profile.photo = list.find((photo) => photo.is_primary) ?? null
  if (before && before !== (primary?.id ?? null)) clearPhotoVerified()

  const missing: OwnProfile['missing'] = db.ownProfile.missing.filter(
    (item) => item !== 'photo' && item !== 'more_photos',
  )
  if (approved.length === 0) missing.unshift('photo')
  else if (approved.length < 3) missing.push('more_photos')
  db.ownProfile.missing = missing
}

/** Finishes processing of every photo whose deadline has passed. */
export function settlePhotos(now = Date.now()) {
  const state = photoMockState()
  let changed = false
  const photos = db.ownPhotos.map((photo) => {
    const job = state.jobs.get(photo.id)
    if (photo.status !== 'processing' || !job || job.readyAt > now) return photo
    changed = true
    state.jobs.delete(photo.id)
    const outcome = state.outcome
    const url =
      outcome === 'failed'
        ? null
        : placeholderPhotoUrl(`me ${photo.position + 1}`, 30 + photo.position * 45)
    return {
      ...photo,
      status: outcome,
      rejection_reason: outcome === 'rejected' ? state.rejectionReason : null,
      thumb_url: url,
      medium_url: url,
      large_url: url,
    }
  })
  if (changed) syncPhotos(photos)
}

function photoList() {
  settlePhotos()
  return HttpResponse.json(sorted(db.ownPhotos))
}

function limitReached() {
  const max = db.me.config.photos_max
  return apiError(429, 'limit_reached', `At most ${max} photos`, {
    details: { limit: max, used: db.ownPhotos.filter(counted).length, resets_at: null },
  })
}

export const handlers = [
  http.post(apiUrl('/v1/me/photos/uploads'), async ({ request }) => {
    const blocked = gateErrorFor('open')
    if (blocked) return blocked
    settlePhotos()
    const body = await readJson<{ content_type?: string; size_bytes?: number }>(request)
    if (!body.content_type || !CONTENT_TYPES.includes(body.content_type as UploadContentType)) {
      return apiError(400, 'validation_failed', 'Some fields need your attention.', {
        fields: [{ field: 'content_type', code: 'invalid', message: 'Use JPEG, PNG or WebP.' }],
      })
    }
    if (typeof body.size_bytes !== 'number' || body.size_bytes <= 0) {
      return apiError(400, 'validation_failed', 'Some fields need your attention.', {
        fields: [{ field: 'size_bytes', code: 'invalid', message: 'Enter the file size.' }],
      })
    }
    if (body.size_bytes > MAX_BYTES) {
      return apiError(413, 'payload_too_large', 'The file is larger than 10 MB', {
        details: { max_bytes: MAX_BYTES },
      })
    }
    if (db.ownPhotos.filter(counted).length >= db.me.config.photos_max) return limitReached()
    const key = `tmp/photos/${db.ownProfile.id}/${newId()}`
    return HttpResponse.json(uploadTicket(key, body.content_type, body.size_bytes))
  }),

  // The storage bucket: presigned PUT signed for the Content-Type (08 section 5.2).
  http.put(`${MOCK_STORAGE_ORIGIN}/uploads/*`, async ({ request }) => {
    const key = decodeURIComponent(new URL(request.url).pathname.replace(/^\/uploads\//, ''))
    const object = photoMockState().objects.get(key)
    if (!object || request.headers.get('content-type') !== object.contentType) {
      return new HttpResponse('SignatureDoesNotMatch', { status: 403 })
    }
    const body = await request.arrayBuffer()
    object.uploadedBytes = body.byteLength
    return new HttpResponse(null, { status: 200 })
  }),

  http.post(apiUrl('/v1/me/photos'), async ({ request }) => {
    const blocked = gateErrorFor('open')
    if (blocked) return blocked
    settlePhotos()
    const state = photoMockState()
    const body = await readJson<{ upload_key?: string }>(request)
    const key = body.upload_key ?? ''
    if (!key.startsWith(`tmp/photos/${db.ownProfile.id}/`)) return notFound()
    const object = state.objects.get(key)
    if (!object || object.uploadedBytes === null) return notFound()

    // Confirming the same key again returns the existing photo (08 section 5.2 rule 3).
    const previousId = state.confirmed.get(key)
    const previous = previousId ? db.ownPhotos.find((photo) => photo.id === previousId) : null
    if (previous) return HttpResponse.json(previous, { status: 200 })

    if (object.uploadedBytes > MAX_BYTES) {
      state.objects.delete(key)
      return apiError(413, 'payload_too_large', 'The file is larger than 10 MB', {
        details: { max_bytes: MAX_BYTES },
      })
    }
    if (db.ownPhotos.filter(counted).length >= db.me.config.photos_max) return limitReached()

    const position = db.ownPhotos.reduce((max, photo) => Math.max(max, photo.position), -1) + 1
    const photo: OwnPhoto = {
      id: newId(),
      status: 'processing',
      rejection_reason: null,
      is_primary: false,
      position,
      thumb_url: null,
      medium_url: null,
      large_url: null,
      created_at: nowIso(),
    }
    state.jobs.set(photo.id, { readyAt: Date.now() + state.processingMs })
    state.confirmed.set(key, photo.id)
    syncPhotos([...db.ownPhotos, photo])
    // The job finishes even when nobody asks (development); reads settle it too.
    if (state.processingMs > 0) setTimeout(() => settlePhotos(), state.processingMs + 10)
    return HttpResponse.json(photo, { status: 201 })
  }),

  http.get(apiUrl('/v1/me/photos'), () => {
    const blocked = gateErrorFor('open')
    if (blocked) return blocked
    return photoList()
  }),

  http.patch(apiUrl('/v1/me/photos/:photoId'), async ({ params, request }) => {
    const blocked = gateErrorFor('open')
    if (blocked) return blocked
    settlePhotos()
    const body = await readJson<{ is_primary?: boolean }>(request)
    const photo = db.ownPhotos.find((entry) => entry.id === params.photoId)
    if (!photo) return notFound()
    if (body.is_primary !== true) {
      return apiError(400, 'validation_failed', 'Some fields need your attention.', {
        fields: [{ field: 'is_primary', code: 'invalid', message: 'Only true is accepted.' }],
      })
    }
    if (photo.status !== 'approved') {
      return apiError(409, 'invalid_state', 'Only an approved photo can be the main photo', {
        details: { status: photo.status },
      })
    }
    syncPhotos(db.ownPhotos.map((entry) => ({ ...entry, is_primary: entry.id === photo.id })))
    return photoList()
  }),

  http.put(apiUrl('/v1/me/photos/order'), async ({ request }) => {
    const blocked = gateErrorFor('open')
    if (blocked) return blocked
    settlePhotos()
    const body = await readJson<{ photo_ids?: string[] }>(request)
    const ids = body.photo_ids ?? []
    const known = new Set(db.ownPhotos.map((photo) => photo.id))
    const valid =
      ids.length === known.size &&
      new Set(ids).size === ids.length &&
      ids.every((id) => known.has(id))
    if (!valid) {
      return apiError(400, 'validation_failed', 'Some fields need your attention.', {
        fields: [
          { field: 'photo_ids', code: 'invalid', message: 'List every photo exactly once.' },
        ],
      })
    }
    syncPhotos(db.ownPhotos.map((photo) => ({ ...photo, position: ids.indexOf(photo.id) })))
    return photoList()
  }),

  http.delete(apiUrl('/v1/me/photos/:photoId'), ({ params }) => {
    const blocked = gateErrorFor('open')
    if (blocked) return blocked
    settlePhotos()
    const photo = db.ownPhotos.find((entry) => entry.id === params.photoId)
    if (!photo) return notFound()
    photoMockState().jobs.delete(photo.id)
    syncPhotos(db.ownPhotos.filter((entry) => entry.id !== photo.id))
    return noContent()
  }),
]
