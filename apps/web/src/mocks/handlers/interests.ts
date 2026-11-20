import { HttpResponse, http } from 'msw'
import type {
  Connection,
  Interest,
  InterestDisplayStatus,
  InterestStatus,
  ProfileDetail,
} from '~/lib/api-types'
import { db } from '../db'
import { makeConnection } from '../factories'
import { apiError, apiUrl, noContent, notFound, nowIso, paginate, readJson } from '../http'
import { gateErrorFor } from './account'
import {
  appendMessage,
  applyBlock,
  chatState,
  recomputeCounters,
  renderConnection,
} from './connections'

/**
 * 15 section 11: interests, with the checks of `POST /v1/interests` in their order, mutual
 * interest, the quiet decline of 11 section 3.5 (`display_status`, 15 section 4.7) and the
 * waiting periods of 11 section 4. Limits are the defaults of 03 section 8.
 */

export const INTEREST_LIMITS = {
  expiryDays: 21,
  pendingMax: 50,
  activeConnectionsMax: 30,
  messageMax: 300,
  cooldownAfterDeclineDays: 90,
  cooldownAfterExpiryDays: 30,
  cooldownAfterWithdrawDays: 7,
  cooldownAfterEndDays: 90,
} as const

const DAY_MS = 86_400_000

type InterestsState = {
  /** Declined interests the sender withdrew: shown to the sender as withdrawn (11 section 3.5). */
  withdrawnDeclined: Set<string>
  /** Profiles whose `interest_permission` refuses the member (09 section 7). */
  permission: Record<string, 'verified_only' | 'preference_match'>
  /** Profiles at their connection cap (accept answers `limit_reached` with `side = them`). */
  atCapacity: Set<string>
}

/** This area's state in `db.extra` (reset with the db). */
export function interestsState(): InterestsState {
  let state = db.extra.interests as InterestsState | undefined
  if (!state) {
    state = { withdrawnDeclined: new Set(), permission: {}, atCapacity: new Set() }
    db.extra.interests = state
  }
  return state
}

function isBlocked(profileId: string): boolean {
  return db.blocks.some((entry) => entry.profile_id === profileId)
}

/** The other profile when the member may still open it (09 section 2), else undefined. */
function openable(profileId: string | undefined): ProfileDetail | undefined {
  if (!profileId || profileId === db.me.profile.id || isBlocked(profileId)) return undefined
  if (chatState().unavailable.has(profileId)) return undefined
  return db.profiles.get(profileId)
}

function isPast(timestamp: string): boolean {
  return new Date(timestamp).getTime() <= Date.now()
}

/**
 * The interest as the member sees it (15 section 4.7): a sender never learns of a decline;
 * `seen` reaches the sender only with read receipts on both sides (09 section 9).
 */
export function renderInterest(interest: Interest): Interest {
  let status: InterestStatus = interest.status
  let display: InterestDisplayStatus
  const expired = isPast(interest.expires_at)
  if (interest.direction === 'sent') {
    if (status === 'declined') {
      if (interestsState().withdrawnDeclined.has(interest.id)) {
        status = 'withdrawn'
        display = 'withdrawn'
      } else if (!expired) {
        status = 'pending'
        display = 'no_response'
      } else {
        status = 'expired'
        display = 'closed'
      }
    } else if (status === 'pending' && expired) {
      status = 'expired'
      display = 'closed'
    } else {
      display = status === 'expired' ? 'closed' : status
    }
  } else if (status === 'pending' && expired) {
    status = 'expired'
    display = 'closed'
  } else {
    display = status === 'expired' ? 'closed' : status
  }
  const profile = openable(interest.profile?.id)
  return {
    ...interest,
    status,
    display_status: display,
    seen:
      interest.direction === 'sent'
        ? interest.seen && db.privacy.send_read_receipts
        : interest.seen,
    profile: profile ? profile.card : null,
  }
}

function listBucket(status: InterestStatus): 'pending' | 'accepted' | 'closed' {
  if (status === 'pending') return 'pending'
  if (status === 'accepted') return 'accepted'
  return 'closed'
}

function activeConnectionCount(): number {
  return db.connections.filter((connection) => connection.status === 'active').length
}

function limitReached(limit: string, used: number, extra: Record<string, unknown> = {}) {
  return apiError(429, 'limit_reached', 'A limit has been reached.', {
    details: { limit, used, resets_at: null, ...extra },
  })
}

function nextMidnightKarachi(): string {
  // Karachi is UTC+5 all year: midnight there is 19:00 UTC.
  const now = new Date()
  const reset = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 19, 0, 0),
  )
  if (reset.getTime() <= now.getTime()) reset.setUTCDate(reset.getUTCDate() + 1)
  return reset.toISOString()
}

function dateAfter(timestamp: string | number, days: number): string {
  return new Date(new Date(timestamp).getTime() + days * DAY_MS).toISOString().slice(0, 10)
}

function withinDays(timestamp: string | null, days: number): boolean {
  if (!timestamp) return false
  return Date.now() < new Date(timestamp).getTime() + days * DAY_MS
}

/** The waiting periods of 11 section 4 that bind the member as the sender, or null. */
function cooldownFor(profileId: string): string | null {
  const dates: string[] = []
  for (const interest of db.interests) {
    if (interest.direction !== 'sent' || interest.profile?.id !== profileId) continue
    const withdrawnDeclined = interestsState().withdrawnDeclined.has(interest.id)
    if (interest.status === 'declined' && !withdrawnDeclined && interest.responded_at) {
      if (withinDays(interest.responded_at, INTEREST_LIMITS.cooldownAfterDeclineDays)) {
        dates.push(dateAfter(interest.responded_at, INTEREST_LIMITS.cooldownAfterDeclineDays))
      }
    }
    if (
      interest.status === 'expired' ||
      (interest.status === 'pending' && isPast(interest.expires_at))
    ) {
      if (withinDays(interest.expires_at, INTEREST_LIMITS.cooldownAfterExpiryDays)) {
        dates.push(dateAfter(interest.expires_at, INTEREST_LIMITS.cooldownAfterExpiryDays))
      }
    }
    if ((interest.status === 'withdrawn' || withdrawnDeclined) && interest.responded_at) {
      if (withinDays(interest.responded_at, INTEREST_LIMITS.cooldownAfterWithdrawDays)) {
        dates.push(dateAfter(interest.responded_at, INTEREST_LIMITS.cooldownAfterWithdrawDays))
      }
    }
  }
  for (const connection of db.connections) {
    if (connection.other?.id !== profileId || connection.status !== 'ended') continue
    if (withinDays(connection.ended_at, INTEREST_LIMITS.cooldownAfterEndDays)) {
      dates.push(dateAfter(connection.ended_at ?? nowIso(), INTEREST_LIMITS.cooldownAfterEndDays))
    }
  }
  return dates.sort().at(-1) ?? null
}

function containsContactInfo(text: string): boolean {
  return /(\+?\d[\d\s-]{6,}\d)|([\w.+-]+@[\w-]+\.[\w.]+)|(https?:\/\/|www\.)|(^|\s)@\w{3,}/i.test(
    text,
  )
}

function setRelationConnected(profile: ProfileDetail, connectionId: string) {
  profile.card.relation.tier = 'connection'
  profile.card.relation.connection_id = connectionId
  profile.card.relation.interest_status = null
  profile.card.relation.interest_direction = null
  profile.card.relation.can_send_interest = false
  profile.relation.tier = 'connection'
  profile.relation.connection_id = connectionId
  profile.relation.interest = null
  profile.relation.can_send_interest = false
  profile.relation.cannot_send_reason = 'already_connected'
  profile.locked = profile.locked.filter((group) => group !== 'photos')
}

function setRelationMember(profile: ProfileDetail | undefined, retryAfter: string | null) {
  if (!profile) return
  profile.card.relation.tier = 'member'
  profile.card.relation.interest_status = null
  profile.card.relation.interest_direction = null
  profile.card.relation.can_send_interest = retryAfter === null
  profile.relation.tier = 'member'
  profile.relation.interest = null
  profile.relation.can_send_interest = retryAfter === null
  profile.relation.cannot_send_reason = retryAfter === null ? null : 'cooldown'
  profile.relation.can_send_interest_after = retryAfter
}

/**
 * The accept procedure of 11 section 3.3 (also used for a mutual interest): checks, then the
 * connection with its `connected` system message. Returns the error response or the
 * connection.
 */
function acceptInterest(interest: Interest): Response | Connection {
  const profile = openable(interest.profile?.id)
  if (!profile) {
    interest.status = 'expired'
    return apiError(409, 'invalid_state', 'This interest can no longer be accepted.', {
      details: { status: 'expired' },
    })
  }
  const used = activeConnectionCount()
  if (used >= INTEREST_LIMITS.activeConnectionsMax) {
    return limitReached('limits.active_connections_max', used, { side: 'you' })
  }
  if (interestsState().atCapacity.has(profile.card.id)) {
    return limitReached('limits.active_connections_max', INTEREST_LIMITS.activeConnectionsMax, {
      side: 'them',
    })
  }
  const now = nowIso()
  const connection = makeConnection({
    id: crypto.randomUUID(),
    status: 'active',
    stage: 'chatting',
    created_at: now,
    other: profile.card,
    last_message_at: null,
    last_message_preview: null,
    unread_count: 0,
  })
  db.connections.push(connection)
  interest.status = 'accepted'
  interest.responded_at = now
  interest.connection_id = connection.id
  setRelationConnected(profile, connection.id)
  connection.other = profile.card
  appendMessage(connection, {
    sender: 'system',
    kind: 'system',
    system_event: 'connected',
    system_data: { actor_profile_id: db.me.profile.id },
    created_at: now,
  })
  recomputeCounters()
  return connection
}

function findInterest(id: string, direction?: 'sent' | 'received'): Interest | undefined {
  return db.interests.find(
    (interest) => interest.id === id && (!direction || interest.direction === direction),
  )
}

export const handlers = [
  http.get(apiUrl('/v1/interests'), ({ request }) => {
    const blocked = gateErrorFor('engage')
    if (blocked) return blocked
    const url = new URL(request.url)
    const box = url.searchParams.get('box')
    const status = url.searchParams.get('status') ?? 'pending'
    if (box !== 'received' && box !== 'sent') {
      return apiError(400, 'bad_request', 'box must be received or sent')
    }
    if (!['pending', 'accepted', 'closed'].includes(status)) {
      return apiError(400, 'bad_request', 'Unknown status')
    }
    const items = db.interests
      .filter((interest) => interest.direction === box)
      .map(renderInterest)
      .filter((interest) => listBucket(interest.status) === status)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    return HttpResponse.json(paginate(items, request))
  }),

  http.post(apiUrl('/v1/interests/seen'), async ({ request }) => {
    const blocked = gateErrorFor('engage')
    if (blocked) return blocked
    const body = await readJson<{ interest_ids?: unknown }>(request)
    if (!Array.isArray(body.interest_ids)) {
      return apiError(400, 'bad_request', 'interest_ids must be a list')
    }
    const ids = new Set(body.interest_ids.map(String))
    for (const interest of db.interests) {
      if (interest.direction === 'received' && ids.has(interest.id)) interest.seen = true
    }
    return noContent()
  }),

  http.get(apiUrl('/v1/interests/:interestId'), ({ params }) => {
    const blocked = gateErrorFor('engage')
    if (blocked) return blocked
    const interest = findInterest(String(params.interestId))
    if (!interest) return notFound()
    return HttpResponse.json(renderInterest(interest))
  }),

  http.post(apiUrl('/v1/interests'), async ({ request }) => {
    const blocked = gateErrorFor('browse')
    if (blocked) return blocked
    const body = await readJson<{ receiver_profile_id?: unknown; message?: unknown }>(request)
    for (const key of Object.keys(body)) {
      if (key !== 'receiver_profile_id' && key !== 'message') {
        return apiError(400, 'bad_request', `Unknown key ${key}`)
      }
    }
    const receiverId = typeof body.receiver_profile_id === 'string' ? body.receiver_profile_id : ''

    // 1. The receiver is active and may be opened by the caller.
    const profile = openable(receiverId)
    if (!profile) return notFound()

    // 2. No active connection.
    const connected = db.connections.find(
      (connection) => connection.status === 'active' && connection.other?.id === receiverId,
    )
    if (connected) {
      return apiError(409, 'already_connected', 'You are already connected.', {
        details: { connection_id: connected.id },
      })
    }

    // 3. No pending interest from the caller (a hidden decline still counts, 11 section 3.5).
    const pending = db.interests.find(
      (interest) =>
        interest.direction === 'sent' &&
        interest.profile?.id === receiverId &&
        renderInterest(interest).status === 'pending',
    )
    if (pending) {
      return apiError(409, 'interest_already_pending', 'An interest is already pending.', {
        details: { interest_id: pending.id },
      })
    }

    // 4. No waiting period applies.
    const retryAfter = cooldownFor(receiverId)
    if (retryAfter) {
      return apiError(409, 'cooldown_active', 'Please wait before sending again.', {
        details: { retry_after_date: retryAfter },
      })
    }

    // Mutual interest: accept theirs instead; checks 5, 6 and 8 are skipped (11 section 2.3).
    const theirs = db.interests.find(
      (interest) =>
        interest.direction === 'received' &&
        interest.profile?.id === receiverId &&
        renderInterest(interest).status === 'pending',
    )
    if (theirs) {
      const used = activeConnectionCount()
      if (used >= INTEREST_LIMITS.activeConnectionsMax) {
        return limitReached('limits.active_connections_max', used, { side: 'you' })
      }
      const result = acceptInterest(theirs)
      if (result instanceof Response) return result
      return HttpResponse.json(
        { interest: renderInterest(theirs), connection: renderConnection(result) },
        { status: 201 },
      )
    }

    // 5. The receiver's interest_permission.
    const permission = interestsState().permission[receiverId]
    if (permission) {
      return apiError(409, 'not_permitted_by_member', 'Not permitted by this member.', {
        details: { reason: permission },
      })
    }

    // 6. Pending sent interests.
    const pendingSent = db.interests.filter(
      (interest) => interest.direction === 'sent' && renderInterest(interest).status === 'pending',
    ).length
    if (pendingSent >= INTEREST_LIMITS.pendingMax) {
      return limitReached('limits.pending_interests_max', pendingSent)
    }

    // 7. Active connections.
    const activeConnections = activeConnectionCount()
    if (activeConnections >= INTEREST_LIMITS.activeConnectionsMax) {
      return limitReached('limits.active_connections_max', activeConnections, { side: 'you' })
    }

    // 8. The daily limit.
    const usage = db.me.usage
    if (usage.interests_sent_today >= usage.interests_per_day) {
      return limitReached('limits.interests_per_day', usage.interests_sent_today, {
        resets_at: nextMidnightKarachi(),
      })
    }

    // 9. Text rules for the message (13 section 3).
    const message = typeof body.message === 'string' ? body.message.trim() : ''
    if (message.length > INTEREST_LIMITS.messageMax) {
      return apiError(400, 'validation_failed', 'Some fields need your attention.', {
        fields: [{ field: 'message', code: 'too_long', message: 'At most 300 characters.' }],
      })
    }
    if (message && containsContactInfo(message)) {
      return apiError(400, 'validation_failed', 'Some fields need your attention.', {
        fields: [
          {
            field: 'message',
            code: 'contains_contact_info',
            message: 'Please remove phone numbers, email addresses and links.',
          },
        ],
      })
    }

    const now = nowIso()
    const interest: Interest = {
      id: crypto.randomUUID(),
      direction: 'sent',
      status: 'pending',
      display_status: 'pending',
      message: message || null,
      compat_score: profile.card.compat,
      seen: false,
      created_at: now,
      responded_at: null,
      expires_at: new Date(Date.now() + INTEREST_LIMITS.expiryDays * DAY_MS).toISOString(),
      connection_id: null,
      profile: profile.card,
    }
    db.interests.push(interest)
    usage.interests_sent_today += 1
    profile.card.relation.tier = 'interest_to_owner'
    profile.card.relation.interest_status = 'pending'
    profile.card.relation.interest_direction = 'sent'
    profile.card.relation.can_send_interest = false
    profile.relation.tier = 'interest_to_owner'
    profile.relation.can_send_interest = false
    profile.relation.cannot_send_reason = 'already_pending'
    profile.relation.interest = {
      id: interest.id,
      direction: 'sent',
      status: 'pending',
      message: interest.message,
      created_at: interest.created_at,
      expires_at: interest.expires_at,
    }
    return HttpResponse.json(
      { interest: renderInterest(interest), connection: null },
      { status: 201 },
    )
  }),

  http.post(apiUrl('/v1/interests/:interestId/accept'), ({ params }) => {
    const blocked = gateErrorFor('engage')
    if (blocked) return blocked
    const interest = findInterest(String(params.interestId), 'received')
    if (!interest) return notFound()
    const shown = renderInterest(interest)
    if (shown.status !== 'pending') {
      return apiError(409, 'invalid_state', 'This interest is no longer pending.', {
        details: { status: shown.status },
      })
    }
    const result = acceptInterest(interest)
    if (result instanceof Response) return result
    return HttpResponse.json({
      interest: renderInterest(interest),
      connection: renderConnection(result),
    })
  }),

  http.post(apiUrl('/v1/interests/:interestId/decline'), async ({ params, request }) => {
    const blocked = gateErrorFor('engage')
    if (blocked) return blocked
    const interest = findInterest(String(params.interestId), 'received')
    if (!interest) return notFound()
    const shown = renderInterest(interest)
    if (shown.status !== 'pending') {
      return apiError(409, 'invalid_state', 'This interest is no longer pending.', {
        details: { status: shown.status },
      })
    }
    const body = await readJson<{ also_block?: unknown }>(request)
    interest.status = 'declined'
    interest.responded_at = nowIso()
    const profile = interest.profile ? db.profiles.get(interest.profile.id) : undefined
    setRelationMember(profile, null)
    if (body.also_block === true && interest.profile) applyBlock(interest.profile.id)
    recomputeCounters()
    return HttpResponse.json(renderInterest(interest))
  }),

  http.post(apiUrl('/v1/interests/:interestId/withdraw'), ({ params }) => {
    const blocked = gateErrorFor('engage')
    if (blocked) return blocked
    const interest = findInterest(String(params.interestId), 'sent')
    if (!interest) return notFound()
    const shown = renderInterest(interest)
    if (shown.status !== 'pending') {
      return apiError(409, 'invalid_state', 'This interest is no longer pending.', {
        details: { status: shown.status },
      })
    }
    const now = nowIso()
    if (interest.status === 'declined') {
      // A hidden decline: success, and the row stays declined (11 section 3.5 rule 2).
      interestsState().withdrawnDeclined.add(interest.id)
    } else {
      interest.status = 'withdrawn'
      interest.responded_at = now
    }
    const profile = interest.profile ? db.profiles.get(interest.profile.id) : undefined
    setRelationMember(profile, dateAfter(now, INTEREST_LIMITS.cooldownAfterWithdrawDays))
    recomputeCounters()
    return HttpResponse.json(renderInterest(interest))
  }),
]
