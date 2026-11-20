import { describe, expect, it } from 'vitest'
import { ApiError, http } from '~/lib/api'
import type { OwnPhoto, UploadTicket, VerificationRequest, Verifications } from '~/lib/api-types'
import { todayInKarachi } from '~/lib/format'
import { uploadWithProgress } from '~/lib/image'
import { db } from '../db'
import { makeOwnPhoto } from '../factories'
import { photoMockState } from './photos'
import { selfieGestureFor } from './verifications'

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  }
  throw new Error('Expected the request to fail')
}

function seed(photos: OwnPhoto[]) {
  db.ownPhotos = photos
  db.ownProfile.photos = photos
}

async function uploadAndConfirm(size = 1000): Promise<OwnPhoto> {
  const ticket = await http.post<UploadTicket>('/v1/me/photos/uploads', {
    content_type: 'image/jpeg',
    size_bytes: size,
  })
  await uploadWithProgress(ticket.upload_url, new Blob([new Uint8Array(size)]), ticket.headers)
  return http.post<OwnPhoto>('/v1/me/photos', { upload_key: ticket.upload_key })
}

describe('photo handlers (15 section 8)', () => {
  it('issues a ticket for the mock storage, signed for the content type', async () => {
    const ticket = await http.post<UploadTicket>('/v1/me/photos/uploads', {
      content_type: 'image/webp',
      size_bytes: 2000,
    })
    expect(ticket.upload_key).toMatch(new RegExp(`^tmp/photos/${db.ownProfile.id}/`))
    expect(ticket.upload_url).toBe(`https://r2.mock.local/uploads/${ticket.upload_key}`)
    expect(ticket.headers).toEqual({ 'Content-Type': 'image/webp' })
    // A different Content-Type does not match the signature.
    await expect(
      uploadWithProgress(ticket.upload_url, new Blob(['x']), { 'Content-Type': 'image/jpeg' }),
    ).rejects.toMatchObject({ kind: 'http', status: 403 })
  })

  it('answers payload_too_large over 10 MB and limit_reached at photos_max', async () => {
    const tooLarge = await failure(
      http.post('/v1/me/photos/uploads', {
        content_type: 'image/jpeg',
        size_bytes: 10 * 1024 * 1024 + 1,
      }),
    )
    expect(tooLarge).toMatchObject({ status: 413, code: 'payload_too_large' })

    seed(Array.from({ length: 6 }, (_, index) => makeOwnPhoto({ position: index })))
    const limit = await failure(
      http.post('/v1/me/photos/uploads', { content_type: 'image/jpeg', size_bytes: 10 }),
    )
    expect(limit).toMatchObject({ status: 429, code: 'limit_reached' })
    expect(limit.details).toMatchObject({ limit: 6, used: 6 })
  })

  it('does not count rejected or failed photos against the limit', async () => {
    seed([
      ...Array.from({ length: 5 }, (_, index) => makeOwnPhoto({ position: index })),
      makeOwnPhoto({ position: 5, status: 'rejected', is_primary: false }),
    ])
    await expect(
      http.post('/v1/me/photos/uploads', { content_type: 'image/jpeg', size_bytes: 10 }),
    ).resolves.toBeTruthy()
  })

  it('confirms an upload as processing, once per key, and approves it later', async () => {
    seed([])
    db.me.profile.photo = null
    photoMockState().processingMs = 0
    const ticket = await http.post<UploadTicket>('/v1/me/photos/uploads', {
      content_type: 'image/jpeg',
      size_bytes: 100,
    })
    // Not uploaded yet: the object does not exist.
    expect(
      await failure(http.post('/v1/me/photos', { upload_key: ticket.upload_key })),
    ).toMatchObject({
      code: 'not_found',
    })
    await uploadWithProgress(ticket.upload_url, new Blob([new Uint8Array(100)]), ticket.headers)
    photoMockState().processingMs = 60_000
    const photo = await http.post<OwnPhoto>('/v1/me/photos', { upload_key: ticket.upload_key })
    expect(photo).toMatchObject({ status: 'processing', thumb_url: null, is_primary: false })
    const again = await http.post<OwnPhoto>('/v1/me/photos', { upload_key: ticket.upload_key })
    expect(again.id).toBe(photo.id)

    const job = photoMockState().jobs.get(photo.id)
    if (job) job.readyAt = Date.now() - 1
    const [settled] = await http.get<OwnPhoto[]>('/v1/me/photos')
    expect(settled).toMatchObject({ id: photo.id, status: 'approved', is_primary: true })
    // The profile and Me follow the list.
    expect(db.ownProfile.photos.map((entry) => entry.id)).toEqual([photo.id])
    expect((db.me.profile.photo as OwnPhoto | null)?.id).toBe(photo.id)
  })

  it('can turn a photo into pending_review or rejected', async () => {
    seed([makeOwnPhoto({ id: 'main', position: 0 })])
    photoMockState().processingMs = 0
    photoMockState().outcome = 'rejected'
    const photo = await uploadAndConfirm()
    const list = await http.get<OwnPhoto[]>('/v1/me/photos')
    expect(list.find((entry) => entry.id === photo.id)).toMatchObject({
      status: 'rejected',
      rejection_reason: 'low_quality',
      position: 1,
    })
  })

  it('makes only an approved photo primary and clears the photo-verified badge', async () => {
    seed([
      makeOwnPhoto({ id: 'a', position: 0, is_primary: true }),
      makeOwnPhoto({ id: 'b', position: 1, is_primary: false }),
      makeOwnPhoto({ id: 'c', position: 2, is_primary: false, status: 'pending_review' }),
    ])
    db.ownProfile.verification.photo_verified = true
    db.me.profile.badges = ['photo_verified']
    const refused = await failure(http.patch('/v1/me/photos/c', { is_primary: true }))
    expect(refused).toMatchObject({ status: 409, code: 'invalid_state' })

    const list = await http.patch<OwnPhoto[]>('/v1/me/photos/b', { is_primary: true })
    expect(list.filter((entry) => entry.is_primary).map((entry) => entry.id)).toEqual(['b'])
    expect(db.ownProfile.verification.photo_verified).toBe(false)
    expect(db.me.profile.badges).not.toContain('photo_verified')
  })

  it('reorders when every photo is listed once', async () => {
    seed([
      makeOwnPhoto({ id: 'a', position: 0, is_primary: true }),
      makeOwnPhoto({ id: 'b', position: 1, is_primary: false }),
    ])
    expect(await failure(http.put('/v1/me/photos/order', { photo_ids: ['a'] }))).toMatchObject({
      code: 'validation_failed',
    })
    const list = await http.put<OwnPhoto[]>('/v1/me/photos/order', { photo_ids: ['b', 'a'] })
    expect(list.map((entry) => [entry.id, entry.position, entry.is_primary])).toEqual([
      ['b', 0, false],
      ['a', 1, true],
    ])
  })

  it('promotes the next approved photo when the primary is deleted', async () => {
    seed([
      makeOwnPhoto({ id: 'a', position: 0, is_primary: true }),
      makeOwnPhoto({ id: 'b', position: 1, is_primary: false, status: 'rejected' }),
      makeOwnPhoto({ id: 'c', position: 2, is_primary: false }),
    ])
    await http.delete('/v1/me/photos/a')
    expect(db.ownPhotos.map((entry) => [entry.id, entry.is_primary])).toEqual([
      ['b', false],
      ['c', true],
    ])
    expect(db.me.profile.photo?.id).toBe('c')
    expect(await failure(http.delete('/v1/me/photos/a'))).toMatchObject({ code: 'not_found' })
  })
})

describe('verification handlers (15 section 9)', () => {
  async function verificationKey(slot: 'front' | 'back' | 'selfie') {
    const ticket = await http.post<UploadTicket>('/v1/me/verifications/uploads', {
      slot,
      content_type: 'image/jpeg',
      size_bytes: 500,
    })
    expect(ticket.upload_key).toMatch(new RegExp(`^verification/${db.ownProfile.id}/`))
    await uploadWithProgress(ticket.upload_url, new Blob([new Uint8Array(500)]), ticket.headers)
    return ticket.upload_key
  }

  it('derives the gesture from the profile id and the date', async () => {
    const { gesture } = await http.get<{ gesture: string }>('/v1/me/verifications/selfie-challenge')
    expect(gesture).toBe(await selfieGestureFor(db.ownProfile.id, todayInKarachi()))
    expect(await selfieGestureFor('x', '2026-11-20')).toBe(
      await selfieGestureFor('x', '2026-11-20'),
    )
  })

  it('accepts a selfie once, refuses a wrong gesture and requires an approved photo', async () => {
    const { gesture } = await http.get<{ gesture: string }>('/v1/me/verifications/selfie-challenge')
    const others = ['peace_sign', 'thumbs_up', 'open_palm', 'hand_on_head']
    const yesterday = await selfieGestureFor(
      db.ownProfile.id,
      todayInKarachi(new Date(Date.now() - 86_400_000)),
    )
    const wrong = others.find((entry) => entry !== gesture && entry !== yesterday) ?? 'x'
    const mismatch = await failure(
      http.post('/v1/me/verifications', {
        kind: 'selfie',
        selfie_key: await verificationKey('selfie'),
        gesture: wrong,
      }),
    )
    expect(mismatch.fields).toEqual([
      expect.objectContaining({ field: 'gesture', code: 'mismatch' }),
    ])

    const created = await http.post<VerificationRequest>('/v1/me/verifications', {
      kind: 'selfie',
      selfie_key: await verificationKey('selfie'),
      gesture,
    })
    expect(created).toMatchObject({ kind: 'selfie', status: 'pending' })
    const twice = await failure(
      http.post('/v1/me/verifications', {
        kind: 'selfie',
        selfie_key: await verificationKey('selfie'),
        gesture,
      }),
    )
    expect(twice).toMatchObject({ status: 409, code: 'already_exists' })

    db.ownPhotos = []
    db.verificationRequests = []
    const noPhoto = await failure(
      http.post('/v1/me/verifications', { kind: 'selfie', selfie_key: 'x', gesture }),
    )
    expect(noPhoto).toMatchObject({ status: 409, code: 'invalid_state' })
  })

  it('checks the identity, the back of the card, and cancels back to unverified', async () => {
    const { gesture } = await http.get<{ gesture: string }>('/v1/me/verifications/selfie-challenge')
    const front = await verificationKey('front')
    const selfie = await verificationKey('selfie')
    const noBack = await failure(
      http.post('/v1/me/verifications', {
        kind: 'id_document',
        front_key: front,
        back_key: null,
        selfie_key: selfie,
        gesture,
      }),
    )
    expect(noBack.fields).toEqual([
      expect.objectContaining({ field: 'back_key', code: 'required' }),
    ])

    const request = await http.post<VerificationRequest>('/v1/me/verifications', {
      kind: 'id_document',
      front_key: front,
      back_key: await verificationKey('back'),
      selfie_key: selfie,
      gesture,
    })
    const state = await http.get<Verifications>('/v1/me/verifications')
    expect(state.identity?.status).toBe('pending')
    expect(state.requests[0]?.id).toBe(request.id)

    await http.delete(`/v1/me/verifications/${request.id}`)
    const after = await http.get<Verifications>('/v1/me/verifications')
    expect(after.identity?.status).toBe('unverified')
    expect(after.requests[0]?.status).toBe('cancelled')

    db.identity = null
    const missing = await failure(
      http.post('/v1/me/verifications', {
        kind: 'id_document',
        front_key: front,
        back_key: null,
        selfie_key: selfie,
        gesture,
      }),
    )
    expect(missing).toMatchObject({ status: 409, code: 'invalid_state' })
  })

  it('refuses a submission from a closed profile', async () => {
    db.me.profile.status = 'closed'
    const closed = await failure(
      http.post('/v1/me/verifications', { kind: 'selfie', selfie_key: 'x', gesture: 'x' }),
    )
    expect(closed).toMatchObject({ status: 403, code: 'profile_not_active' })
  })
})
