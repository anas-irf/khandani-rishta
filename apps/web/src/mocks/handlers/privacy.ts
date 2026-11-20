import { HttpResponse, http } from 'msw'
import type { Privacy } from '~/lib/api-types'
import { db } from '../db'
import { apiError, apiUrl, readJson } from '../http'
import { currentMe, gateErrorFor } from './account'

const PRIVACY_KEYS = new Set<keyof Privacy>([
  'discovery_visibility',
  'interest_permission',
  'name_display',
  'photo_visibility',
  'caste_visibility',
  'income_visibility',
  'family_visibility',
  'career_details_visibility',
  'home_visibility',
  'area_visibility',
  'health_visibility',
  'show_last_active',
  'show_online_status',
  'record_my_visits',
  'send_read_receipts',
  'allow_photo_requests',
])

/** 15 section 7: privacy settings and the profile status changes. */
export const handlers = [
  http.get(apiUrl('/v1/me/privacy'), () => {
    const blocked = gateErrorFor('open')
    if (blocked) return blocked
    return HttpResponse.json(db.privacy)
  }),

  http.patch(apiUrl('/v1/me/privacy'), async ({ request }) => {
    const blocked = gateErrorFor('open')
    if (blocked) return blocked
    const body = await readJson<Partial<Privacy>>(request)
    const unknown = Object.keys(body).find((key) => !PRIVACY_KEYS.has(key as keyof Privacy))
    if (unknown) return apiError(400, 'bad_request', `Unknown field ${unknown}`)
    db.privacy = { ...db.privacy, ...body }
    return HttpResponse.json(db.privacy)
  }),

  http.post(apiUrl('/v1/me/profile/pause'), () => {
    const blocked = gateErrorFor('connected')
    if (blocked) return blocked
    if (db.me.profile.status !== 'active') {
      return apiError(409, 'invalid_state', 'Only an active profile can be paused', {
        details: { status: db.me.profile.status },
      })
    }
    db.me.profile.status = 'paused'
    db.ownProfile.status = 'paused'
    return HttpResponse.json(currentMe())
  }),

  http.post(apiUrl('/v1/me/profile/resume'), () => {
    const blocked = gateErrorFor('connected')
    if (blocked) return blocked
    if (db.me.profile.status !== 'paused') {
      return apiError(409, 'invalid_state', 'Only a paused profile can be resumed', {
        details: { status: db.me.profile.status },
      })
    }
    db.me.profile.status = 'active'
    db.ownProfile.status = 'active'
    return HttpResponse.json(currentMe())
  }),

  http.post(apiUrl('/v1/me/profile/close'), async ({ request }) => {
    const blocked = gateErrorFor('connected')
    if (blocked) return blocked
    const body = await readJson<{ reason?: string }>(request)
    if (!body.reason) {
      return apiError(400, 'validation_failed', 'Choose a reason', {
        fields: [{ field: 'reason', code: 'required', message: 'Choose a reason.' }],
      })
    }
    if (db.me.profile.status !== 'active' && db.me.profile.status !== 'paused') {
      return apiError(409, 'invalid_state', 'Cannot close', {
        details: { status: db.me.profile.status },
      })
    }
    db.me.profile.status = 'closed'
    db.ownProfile.status = 'closed'
    return HttpResponse.json(currentMe())
  }),

  http.post(apiUrl('/v1/me/profile/reopen'), () => {
    const blocked = gateErrorFor('connected')
    if (blocked) return blocked
    if (db.me.profile.status !== 'closed') {
      return apiError(409, 'invalid_state', 'Only a closed profile can be reopened', {
        details: { status: db.me.profile.status },
      })
    }
    db.me.profile.status = 'active'
    db.ownProfile.status = 'active'
    return HttpResponse.json(currentMe())
  }),
]
