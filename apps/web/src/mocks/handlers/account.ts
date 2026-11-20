import { HttpResponse, http } from 'msw'
import type { ConsentDocument, DeletionBody, Gate, Me, PatchMeBody } from '~/lib/api-types'
import { db } from '../db'
import { apiError, apiUrl, noContent, readJson } from '../http'

/**
 * The gate of 03 section 5.1, evaluated top to bottom, from the mock's user and profile state.
 * Handlers that change status call it before returning `Me`.
 */
export function computeGate(me: Me): Gate {
  if (me.user.status === 'banned') return 'banned'
  if (me.user.status === 'suspended') return 'suspended'
  if (me.user.status === 'deletion_scheduled') return 'deletion_scheduled'
  if (me.profile.status !== 'draft' && me.consents_required.some(isVersioned)) {
    return 'consent_required'
  }
  if (me.profile.status === 'draft') return 'onboarding'
  if (me.profile.status === 'changes_requested') return 'changes_requested'
  if (me.profile.status === 'pending_review') return 'pending_review'
  return 'ok'
}

function isVersioned(document: ConsentDocument) {
  return document === 'terms' || document === 'privacy' || document === 'community_guidelines'
}

/** The current Me with the gate recomputed. */
export function currentMe(): Me {
  db.me.gate = computeGate(db.me)
  return db.me
}

/** Answers 403 with the gate error when the mock user may not use a product route. */
export function gateErrorFor(level: 'open' | 'connected' | 'engage' | 'browse') {
  const me = currentMe()
  if (me.gate === 'banned') return apiError(403, 'account_banned', 'Account banned')
  if (me.gate === 'suspended') return apiError(403, 'account_suspended', 'Account suspended')
  if (me.gate === 'deletion_scheduled') {
    return apiError(403, 'account_deletion_scheduled', 'Deletion scheduled')
  }
  if (level === 'open') return null
  if (me.gate === 'consent_required') return apiError(403, 'consent_required', 'Consent required')
  if (me.gate === 'onboarding') return apiError(403, 'onboarding_required', 'Onboarding required')
  const status = me.profile.status
  const allowed =
    level === 'connected'
      ? ['active', 'paused', 'closed']
      : level === 'engage'
        ? ['active', 'paused']
        : ['active']
  if (!allowed.includes(status)) {
    return apiError(403, 'profile_not_active', 'Profile not active', { details: { status } })
  }
  return null
}

/** 15 section 6: account. */
export const handlers = [
  http.get(apiUrl('/v1/me'), () => HttpResponse.json(currentMe())),

  http.patch(apiUrl('/v1/me'), async ({ request }) => {
    const body = await readJson<PatchMeBody>(request)
    if (body.locale) db.me.user.locale = body.locale
    if (body.timezone) db.me.user.timezone = body.timezone
    return HttpResponse.json(currentMe())
  }),

  http.post(apiUrl('/v1/me/consents'), async ({ request }) => {
    const body = await readJson<{ documents: ConsentDocument[] }>(request)
    db.me.consents_required = db.me.consents_required.filter(
      (document) => !body.documents?.includes(document),
    )
    return HttpResponse.json(currentMe())
  }),

  http.post(apiUrl('/v1/me/deletion'), async ({ request }) => {
    const body = await readJson<DeletionBody>(request)
    if (body.confirm !== 'DELETE') {
      return apiError(400, 'validation_failed', 'Type DELETE to confirm', {
        fields: [{ field: 'confirm', code: 'mismatch', message: 'Type DELETE to confirm.' }],
      })
    }
    if (db.me.user.purge_after) return apiError(409, 'invalid_state', 'Already scheduled')
    const purge = new Date(Date.now() + db.me.config.deletion_grace_days * 86_400_000)
    db.me.user.purge_after = purge.toISOString()
    if (db.me.user.status === 'active') db.me.user.status = 'deletion_scheduled'
    return HttpResponse.json(currentMe())
  }),

  http.delete(apiUrl('/v1/me/deletion'), () => {
    if (!db.me.user.purge_after) return apiError(409, 'invalid_state', 'Nothing scheduled')
    db.me.user.purge_after = null
    if (db.me.user.status === 'deletion_scheduled') db.me.user.status = 'active'
    return HttpResponse.json(currentMe())
  }),

  http.post(apiUrl('/v1/me/exports'), () => {
    const last = db.extra.exportRequestedAt as number | undefined
    if (last && Date.now() - last < 86_400_000) {
      return apiError(429, 'limit_reached', 'One export per day', {
        details: { limit: 1, used: 1, resets_at: new Date(last + 86_400_000).toISOString() },
      })
    }
    db.extra.exportRequestedAt = Date.now()
    return HttpResponse.json({ status: 'queued' }, { status: 202 })
  }),

  http.get(apiUrl('/v1/me/exports/latest'), () => {
    const last = db.extra.exportRequestedAt as number | undefined
    if (!last) return apiError(404, 'not_found', 'No export')
    const ready = Date.now() - last > 5_000
    return HttpResponse.json({
      status: ready ? 'ready' : 'queued',
      download_url: ready ? 'https://example.com/export.zip' : null,
      expires_at: ready ? new Date(last + 7 * 86_400_000).toISOString() : null,
    })
  }),

  http.post(apiUrl('/v1/me/devices'), () => noContent()),
  http.delete(apiUrl('/v1/me/devices/:token'), () => noContent()),

  http.get(apiUrl('/v1/me/notification-preferences'), () => {
    const blocked = gateErrorFor('open')
    if (blocked) return blocked
    return HttpResponse.json(db.notificationPreferences)
  }),

  http.put(apiUrl('/v1/me/notification-preferences'), async ({ request }) => {
    const blocked = gateErrorFor('open')
    if (blocked) return blocked
    db.notificationPreferences = await readJson(request)
    return HttpResponse.json(db.notificationPreferences)
  }),

  http.post(apiUrl('/v1/events'), () => noContent()),
]
