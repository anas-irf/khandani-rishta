import { HttpResponse, http } from 'msw'
import type { PhotoAccessEntry } from '~/lib/api-types'
import { db } from '../db'
import { apiError, apiUrl, newId, noContent, notFound, nowIso, paginate } from '../http'
import { gateErrorFor } from './account'

/**
 * 15 section 13: the owner's side of photo access (`/v1/me/photo-access`). The viewer's request
 * (`POST /v1/profiles/{id}/photo-access`) lives in relations.ts. `Me.counters.pending_photo_requests`
 * follows the pending received rows (14 section 8.1).
 */

function syncPendingCounter() {
  db.me.counters.pending_photo_requests = db.photoAccess.received.filter(
    (entry) => entry.status === 'pending',
  ).length
}

function receivedEntry(id: string): PhotoAccessEntry | undefined {
  return db.photoAccess.received.find((entry) => entry.id === id)
}

function decide(id: string, status: 'granted' | 'denied') {
  const blocked = gateErrorFor('engage')
  if (blocked) return blocked
  const entry = receivedEntry(id)
  if (!entry) return notFound()
  if (entry.status !== 'pending') {
    return apiError(409, 'invalid_state', 'This request has already been answered.', {
      details: { status: entry.status },
    })
  }
  entry.status = status
  syncPendingCounter()
  return noContent()
}

export const handlers = [
  http.get(apiUrl('/v1/me/photo-access'), ({ request }) => {
    const blocked = gateErrorFor('engage')
    if (blocked) return blocked
    const url = new URL(request.url)
    const box = url.searchParams.get('box') === 'sent' ? 'sent' : 'received'
    const status = url.searchParams.get('status') ?? 'pending'
    const items = db.photoAccess[box]
      .filter((entry) => entry.status === status)
      .filter((entry) => !db.blocks.some((block) => block.profile_id === entry.profile_id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
    return HttpResponse.json(paginate(items, request))
  }),

  http.post(apiUrl('/v1/me/photo-access/:id/grant'), ({ params }) =>
    decide(String(params.id), 'granted'),
  ),

  http.post(apiUrl('/v1/me/photo-access/:id/deny'), ({ params }) =>
    decide(String(params.id), 'denied'),
  ),

  // Grant without a request (09 section 6.3).
  http.put(apiUrl('/v1/me/photo-access/grants/:profileId'), ({ params }) => {
    const blocked = gateErrorFor('engage')
    if (blocked) return blocked
    const profileId = String(params.profileId)
    const profile = db.profiles.get(profileId)
    if (!profile || db.blocks.some((entry) => entry.profile_id === profileId)) return notFound()
    const existing = db.photoAccess.received.find((entry) => entry.profile_id === profileId)
    if (existing) {
      existing.status = 'granted'
      existing.profile = profile.card
    } else {
      db.photoAccess.received.unshift({
        id: newId(),
        profile_id: profileId,
        status: 'granted',
        created_at: nowIso(),
        profile: profile.card,
      })
    }
    syncPendingCounter()
    return noContent()
  }),

  http.delete(apiUrl('/v1/me/photo-access/grants/:profileId'), ({ params }) => {
    const blocked = gateErrorFor('engage')
    if (blocked) return blocked
    const profileId = String(params.profileId)
    const entry = db.photoAccess.received.find(
      (item) => item.profile_id === profileId && item.status === 'granted',
    )
    if (!entry) return notFound()
    entry.status = 'revoked'
    syncPendingCounter()
    return noContent()
  }),
]
