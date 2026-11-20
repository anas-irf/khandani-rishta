import { HttpResponse, http } from 'msw'
import type {
  FieldErrorCode,
  IdentitySummary,
  SelfieGesture,
  VerificationKind,
  VerificationRequest,
  Verifications,
} from '~/lib/api-types'
import { todayInKarachi } from '~/lib/format'
import { db } from '../db'
import { apiError, apiUrl, newId, noContent, notFound, nowIso, readJson } from '../http'
import { gateErrorFor } from './account'
import { photoMockState, uploadTicket } from './photos'

/**
 * 15 section 9: verification state, the daily selfie gesture, upload slots, submit and
 * cancel (rules of 12 sections 3.6, 4 and 5). Uploads go to the same mock storage as photos
 * (`handlers/photos.ts` answers the `PUT`).
 */

const GESTURES: readonly SelfieGesture[] = ['peace_sign', 'thumbs_up', 'open_palm', 'hand_on_head']
const SLOTS = ['front', 'back', 'selfie'] as const
const CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 10 * 1024 * 1024

/**
 * The gesture of 12 section 4.2: `gestures[SHA-256(profile_id + ":" + day)[0] mod 4]`, with
 * `day` the date in Asia/Karachi as YYYY-MM-DD.
 */
export async function selfieGestureFor(profileId: string, day: string): Promise<SelfieGesture> {
  const data = new TextEncoder().encode(`${profileId}:${day}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data))
  return GESTURES[(digest[0] ?? 0) % GESTURES.length] ?? 'peace_sign'
}

/** Today's and yesterday's gesture: a submission may use either (12 section 4.2). */
async function acceptedGestures(): Promise<SelfieGesture[]> {
  const now = Date.now()
  return Promise.all([
    selfieGestureFor(db.ownProfile.id, todayInKarachi(new Date(now))),
    selfieGestureFor(db.ownProfile.id, todayInKarachi(new Date(now - 86_400_000))),
  ])
}

function verificationState(): Verifications {
  const { verification } = db.ownProfile
  return {
    phone_verified: verification.phone_verified,
    photo_verified: verification.photo_verified,
    id_verified: verification.id_verified,
    identity: db.identity,
    requests: [...db.verificationRequests]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 10),
  }
}

function setIdentity(identity: IdentitySummary | null) {
  db.identity = identity
  db.ownProfile.identity = identity
}

function setPending(kind: VerificationKind, pending: boolean) {
  db.ownProfile.verification = {
    ...db.ownProfile.verification,
    pending: { ...db.ownProfile.verification.pending, [kind]: pending },
  }
}

function fieldError(field: string, code: FieldErrorCode, message: string) {
  return apiError(400, 'validation_failed', 'Some fields need your attention.', {
    fields: [{ field, code, message }],
  })
}

/** A key the caller uploaded under `verification/{profile_id}/` (12 section 4.3). */
function uploadedKey(key: unknown): boolean {
  if (typeof key !== 'string' || !key.startsWith(`verification/${db.ownProfile.id}/`)) return false
  const object = photoMockState().objects.get(key)
  return Boolean(object && object.uploadedBytes !== null)
}

function hasApprovedPhoto(): boolean {
  return db.ownPhotos.some((photo) => photo.status === 'approved')
}

type SubmitBody = {
  kind?: string
  front_key?: string | null
  back_key?: string | null
  selfie_key?: string | null
  gesture?: string
}

export const handlers = [
  http.get(apiUrl('/v1/me/verifications'), () => {
    const blocked = gateErrorFor('open')
    if (blocked) return blocked
    return HttpResponse.json(verificationState())
  }),

  http.get(apiUrl('/v1/me/verifications/selfie-challenge'), async () => {
    const blocked = gateErrorFor('open')
    if (blocked) return blocked
    const gesture = await selfieGestureFor(db.ownProfile.id, todayInKarachi())
    return HttpResponse.json({ gesture })
  }),

  http.post(apiUrl('/v1/me/verifications/uploads'), async ({ request }) => {
    const blocked = gateErrorFor('open')
    if (blocked) return blocked
    const body = await readJson<{ slot?: string; content_type?: string; size_bytes?: number }>(
      request,
    )
    if (!body.slot || !(SLOTS as readonly string[]).includes(body.slot)) {
      return fieldError('slot', 'invalid', 'Choose front, back or selfie.')
    }
    if (!body.content_type || !CONTENT_TYPES.includes(body.content_type)) {
      return fieldError('content_type', 'invalid', 'Use JPEG, PNG or WebP.')
    }
    if (typeof body.size_bytes !== 'number' || body.size_bytes <= 0) {
      return fieldError('size_bytes', 'invalid', 'Enter the file size.')
    }
    if (body.size_bytes > MAX_BYTES) {
      return apiError(413, 'payload_too_large', 'The file is larger than 10 MB', {
        details: { max_bytes: MAX_BYTES },
      })
    }
    const key = `verification/${db.ownProfile.id}/${newId()}`
    return HttpResponse.json(uploadTicket(key, body.content_type, body.size_bytes))
  }),

  http.post(apiUrl('/v1/me/verifications'), async ({ request }) => {
    const blocked = gateErrorFor('open')
    if (blocked) return blocked
    // A closed profile can view but not submit (03 section 5).
    if (db.me.profile.status === 'closed') {
      return apiError(403, 'profile_not_active', 'Profile not active', {
        details: { status: 'closed' },
      })
    }
    const body = await readJson<SubmitBody>(request)
    if (body.kind !== 'selfie' && body.kind !== 'id_document') {
      return fieldError('kind', 'invalid', 'Choose id_document or selfie.')
    }
    const kind: VerificationKind = body.kind
    const pending = db.verificationRequests.some(
      (entry) => entry.kind === kind && entry.status === 'pending',
    )

    if (kind === 'selfie') {
      if (!hasApprovedPhoto()) {
        return apiError(409, 'invalid_state', 'An approved photo is needed first', {
          details: { status: 'no_approved_photo' },
        })
      }
      if (pending) return apiError(409, 'already_exists', 'A selfie request is pending')
    } else {
      const identity = db.identity
      if (!identity || (identity.status !== 'unverified' && identity.status !== 'rejected')) {
        return apiError(409, 'invalid_state', 'The identity number is missing or not open', {
          details: { status: identity?.status ?? null },
        })
      }
      if (pending) return apiError(409, 'already_exists', 'An identity request is pending')
      if (!uploadedKey(body.front_key)) {
        return fieldError('front_key', 'invalid', 'Upload the front of the document.')
      }
      if (identity.document_type !== 'passport') {
        if (!body.back_key)
          return fieldError('back_key', 'required', 'Upload the back of the card.')
        if (!uploadedKey(body.back_key)) {
          return fieldError('back_key', 'invalid', 'Upload the back of the card.')
        }
      }
    }
    if (!uploadedKey(body.selfie_key)) {
      return fieldError('selfie_key', 'invalid', 'Upload the selfie.')
    }
    const gestures = await acceptedGestures()
    if (!body.gesture || !gestures.includes(body.gesture as SelfieGesture)) {
      return fieldError('gesture', 'mismatch', 'The requested gesture has changed.')
    }

    const created: VerificationRequest = {
      id: newId(),
      kind,
      status: 'pending',
      rejection_reason: null,
      created_at: nowIso(),
      reviewed_at: null,
    }
    db.verificationRequests = [created, ...db.verificationRequests]
    setPending(kind, true)
    if (kind === 'id_document' && db.identity) setIdentity({ ...db.identity, status: 'pending' })
    return HttpResponse.json(created, { status: 201 })
  }),

  http.delete(apiUrl('/v1/me/verifications/:requestId'), ({ params }) => {
    const blocked = gateErrorFor('open')
    if (blocked) return blocked
    const request = db.verificationRequests.find((entry) => entry.id === params.requestId)
    if (!request) return notFound()
    if (request.status !== 'pending') {
      return apiError(409, 'invalid_state', 'Only a pending request can be cancelled', {
        details: { status: request.status },
      })
    }
    db.verificationRequests = db.verificationRequests.map((entry) =>
      entry.id === request.id ? { ...entry, status: 'cancelled' } : entry,
    )
    setPending(request.kind, false)
    // Cancelling sets the identity back to `unverified` (12 section 5.4).
    if (request.kind === 'id_document' && db.identity) {
      setIdentity({ ...db.identity, status: 'unverified' })
    }
    return noContent()
  }),
]
