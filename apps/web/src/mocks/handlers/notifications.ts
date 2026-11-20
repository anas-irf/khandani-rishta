import { HttpResponse, http } from 'msw'
import { db } from '../db'
import { apiError, apiUrl, noContent, paginate, readJson } from '../http'
import { gateErrorFor } from './account'

/**
 * 15 section 14: the notification feed. Newest first, rows whose actor can no longer be opened
 * are left out (14 section 7.3 rule 3), and `Me.counters.unread_notifications` follows the
 * unread rows (14 section 8.1).
 */

function syncUnreadCounter() {
  db.me.counters.unread_notifications = db.notifications.filter((item) => !item.is_read).length
}

function isVisible(actorProfileId: string | null | undefined): boolean {
  if (!actorProfileId) return true
  return !db.blocks.some((entry) => entry.profile_id === actorProfileId)
}

export const handlers = [
  http.get(apiUrl('/v1/notifications'), ({ request }) => {
    const blocked = gateErrorFor('open')
    if (blocked) return blocked
    const items = db.notifications
      .filter((item) => isVisible(item.actor?.profile_id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
    return HttpResponse.json(paginate(items, request))
  }),

  http.post(apiUrl('/v1/notifications/read'), async ({ request }) => {
    const blocked = gateErrorFor('open')
    if (blocked) return blocked
    const body = await readJson<{ ids?: string[]; all?: boolean }>(request)
    if (body.all === true) {
      for (const item of db.notifications) item.is_read = true
    } else if (Array.isArray(body.ids) && body.ids.length > 0) {
      const ids = new Set(body.ids)
      for (const item of db.notifications) {
        if (ids.has(item.id)) item.is_read = true
      }
    } else {
      return apiError(400, 'validation_failed', 'Some fields need your attention.', {
        fields: [{ field: 'ids', code: 'required', message: 'Send ids or all.' }],
      })
    }
    syncUnreadCounter()
    return noContent()
  }),
]
