import { HttpResponse, http } from 'msw'
import type { ApiFieldError, ProfileDetail, ReportBody, ShortlistEntry } from '~/lib/api-types'
import { todayInKarachi } from '~/lib/format'
import { db } from '../db'
import { referenceBootstrap } from '../fixtures/reference'
import { apiError, apiUrl, newId, noContent, notFound, nowIso, paginate, readJson } from '../http'
import { gateErrorFor } from './account'

/**
 * 15 section 13: shortlist, pass, block, photo access request and report. Limits and waiting
 * periods are the defaults of 03 section 8.
 */

const SHORTLIST_MAX = 200
const PHOTO_REQUESTS_PER_DAY = 10
const REPORTS_PER_DAY = 10
const PHOTO_ACCESS_RETRY_DAYS = 30
const DETAILS_MAX = 1000

type StoredReport = ReportBody & { id: string; status: 'open'; created_at: string }

type RelationsState = {
  reports: StoredReport[]
  /** Counters per Karachi day (`usage_counters`). */
  day: string
  photoRequestsToday: number
  reportsToday: number
}

/** This area's state in `db.extra` (reset with the db). */
function state(): RelationsState {
  const today = todayInKarachi()
  let current = db.extra.relations as RelationsState | undefined
  if (!current) {
    current = { reports: [], day: today, photoRequestsToday: 0, reportsToday: 0 }
    db.extra.relations = current
  }
  if (current.day !== today) {
    current.day = today
    current.photoRequestsToday = 0
    current.reportsToday = 0
  }
  return current
}

function nextMidnightKarachi(): string {
  // Karachi is UTC+5 all year: midnight there is 19:00 UTC of the previous day.
  const now = new Date()
  const reset = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 19, 0, 0),
  )
  if (reset.getTime() <= now.getTime()) reset.setUTCDate(reset.getUTCDate() + 1)
  return reset.toISOString()
}

function isBlocked(profileId: string): boolean {
  return db.blocks.some((entry) => entry.profile_id === profileId)
}

/** The other member as the caller may see them, or null (unknown, own, or blocked: 404). */
function visibleProfile(profileId: string): ProfileDetail | null {
  if (profileId === db.me.profile.id) return null
  if (isBlocked(profileId)) return null
  return db.profiles.get(profileId) ?? null
}

function setShortlistFlags(profile: ProfileDetail, shortlisted: boolean, note: string | null) {
  profile.card.relation.is_shortlisted = shortlisted
  profile.relation.is_shortlisted = shortlisted
  profile.relation.shortlist_note = shortlisted ? note : null
}

function removeShortlistEntry(profileId: string) {
  db.shortlist = db.shortlist.filter((entry) => entry.profile_id !== profileId)
  const profile = db.profiles.get(profileId)
  if (profile) setShortlistFlags(profile, false, null)
}

/** The effects of a block, in one step as 15 section 13 lists them. */
function applyBlock(profile: ProfileDetail) {
  const profileId = profile.card.id
  if (isBlocked(profileId)) return
  db.blocks.unshift({
    profile_id: profileId,
    display_name: profile.card.display_name,
    public_code: profile.card.public_code,
    created_at: nowIso(),
  })

  const now = nowIso()
  for (const connection of db.connections) {
    if (connection.other?.id === profileId && connection.status === 'active') {
      connection.status = 'ended'
      connection.ended_reason = 'blocked'
      connection.ended_by = 'me'
      connection.ended_at = now
    }
  }

  // 03 section 4.7: withdrawn when the blocker sent it, declined when the blocker received it.
  for (const interest of db.interests) {
    if (interest.profile?.id !== profileId || interest.status !== 'pending') continue
    interest.status = interest.direction === 'sent' ? 'withdrawn' : 'declined'
    interest.display_status = interest.direction === 'sent' ? 'withdrawn' : 'declined'
    interest.responded_at = now
  }

  // 09 section 6.5: granted becomes revoked, pending becomes denied, both directions.
  for (const entry of [...db.photoAccess.received, ...db.photoAccess.sent]) {
    if (entry.profile_id !== profileId) continue
    if (entry.status === 'granted') entry.status = 'revoked'
    if (entry.status === 'pending') entry.status = 'denied'
  }

  removeShortlistEntry(profileId)

  profile.card.relation.tier = 'member'
  profile.card.relation.connection_id = null
  profile.card.relation.interest_status = null
  profile.card.relation.interest_direction = null
  profile.relation.tier = 'member'
  profile.relation.connection_id = null
  profile.relation.interest = null
}

const REPORT_REASONS = new Set(
  (referenceBootstrap.options.report_reason ?? []).map((option) => option.code),
)

export const handlers = [
  // ---- Shortlist -------------------------------------------------------------------------

  http.get(apiUrl('/v1/shortlist'), ({ request }) => {
    const blocked = gateErrorFor('browse')
    if (blocked) return blocked
    const items: ShortlistEntry[] = db.shortlist.map((entry) => ({
      ...entry,
      profile: visibleProfile(entry.profile_id)?.card ?? null,
    }))
    return HttpResponse.json(paginate(items, request))
  }),

  http.put(apiUrl('/v1/shortlist/:profileId'), async ({ params, request }) => {
    const blocked = gateErrorFor('browse')
    if (blocked) return blocked
    const profileId = String(params.profileId)
    const profile = visibleProfile(profileId)
    if (!profile) return notFound()
    const body = await readJson<{ note?: string | null }>(request)
    const note = typeof body.note === 'string' ? body.note : null
    if (note && note.length > 300) {
      return apiError(400, 'validation_failed', 'Some fields need your attention.', {
        fields: [{ field: 'note', code: 'too_long', message: 'At most 300 characters.' }],
      })
    }
    const existing = db.shortlist.find((entry) => entry.profile_id === profileId)
    if (existing) {
      if (body.note !== undefined) existing.note = note
    } else {
      if (db.shortlist.length >= SHORTLIST_MAX) {
        return apiError(429, 'limit_reached', 'Your shortlist is full.', {
          details: { limit: SHORTLIST_MAX, used: db.shortlist.length, resets_at: null },
        })
      }
      db.shortlist.unshift({ profile_id: profileId, profile: null, note, created_at: nowIso() })
    }
    const entry = db.shortlist.find((item) => item.profile_id === profileId)
    setShortlistFlags(profile, true, entry?.note ?? null)
    return noContent()
  }),

  http.delete(apiUrl('/v1/shortlist/:profileId'), ({ params }) => {
    const blocked = gateErrorFor('browse')
    if (blocked) return blocked
    removeShortlistEntry(String(params.profileId))
    return noContent()
  }),

  // ---- Pass ------------------------------------------------------------------------------

  http.put(apiUrl('/v1/passes/:profileId'), ({ params }) => {
    const blocked = gateErrorFor('browse')
    if (blocked) return blocked
    const profileId = String(params.profileId)
    const profile = visibleProfile(profileId)
    if (!profile) return notFound()
    db.passes.add(profileId)
    profile.relation.is_passed = true
    removeShortlistEntry(profileId)
    return noContent()
  }),

  http.delete(apiUrl('/v1/passes/:profileId'), ({ params }) => {
    const blocked = gateErrorFor('browse')
    if (blocked) return blocked
    const profileId = String(params.profileId)
    db.passes.delete(profileId)
    const profile = db.profiles.get(profileId)
    if (profile) profile.relation.is_passed = false
    return noContent()
  }),

  // ---- Blocks ----------------------------------------------------------------------------

  http.get(apiUrl('/v1/blocks'), ({ request }) => {
    const blocked = gateErrorFor('connected')
    if (blocked) return blocked
    return HttpResponse.json(paginate(db.blocks, request))
  }),

  http.put(apiUrl('/v1/blocks/:profileId'), ({ params }) => {
    const blocked = gateErrorFor('connected')
    if (blocked) return blocked
    const profileId = String(params.profileId)
    if (isBlocked(profileId)) return noContent()
    const profile = visibleProfile(profileId)
    if (!profile) return notFound()
    applyBlock(profile)
    return noContent()
  }),

  http.delete(apiUrl('/v1/blocks/:profileId'), ({ params }) => {
    const blocked = gateErrorFor('connected')
    if (blocked) return blocked
    const profileId = String(params.profileId)
    if (!isBlocked(profileId)) return notFound()
    // Only the block is removed; nothing else is restored (15 section 13).
    db.blocks = db.blocks.filter((entry) => entry.profile_id !== profileId)
    return noContent()
  }),

  // ---- Photo access request (09 section 6.3) ----------------------------------------------

  http.post(apiUrl('/v1/profiles/:profileId/photo-access'), ({ params }) => {
    const blocked = gateErrorFor('browse')
    if (blocked) return blocked
    const profileId = String(params.profileId)
    const profile = visibleProfile(profileId)
    if (!profile) return notFound()

    const blurred = profile.photos.length > 0 && profile.photos.every((photo) => photo.is_blurred)
    if (!blurred || profile.relation.photo_access === 'visible') {
      return apiError(409, 'invalid_state', 'You can already see the photos.', {
        details: { status: 'visible' },
      })
    }
    if (profile.relation.photo_access === 'requests_off') {
      return apiError(409, 'not_permitted_by_member', 'This member is not accepting requests.', {
        details: { reason: 'requests_off' },
      })
    }
    const previous = db.photoAccess.sent.find((entry) => entry.profile_id === profileId)
    if (previous?.status === 'pending') {
      return apiError(409, 'already_exists', 'A request is already pending.')
    }
    if (previous && (previous.status === 'denied' || previous.status === 'revoked')) {
      const retry = new Date(
        new Date(previous.created_at).getTime() + PHOTO_ACCESS_RETRY_DAYS * 86_400_000,
      )
      if (retry.getTime() > Date.now()) {
        return apiError(409, 'cooldown_active', 'Please wait before asking again.', {
          details: { retry_after_date: retry.toISOString().slice(0, 10) },
        })
      }
    }
    const counters = state()
    if (counters.photoRequestsToday >= PHOTO_REQUESTS_PER_DAY) {
      return apiError(429, 'limit_reached', 'Daily photo request limit reached.', {
        details: {
          limit: PHOTO_REQUESTS_PER_DAY,
          used: counters.photoRequestsToday,
          resets_at: nextMidnightKarachi(),
        },
      })
    }

    counters.photoRequestsToday += 1
    const now = nowIso()
    if (previous) {
      previous.status = 'pending'
      previous.created_at = now
      previous.profile = profile.card
    } else {
      db.photoAccess.sent.unshift({
        id: newId(),
        profile_id: profileId,
        status: 'pending',
        created_at: now,
        profile: profile.card,
      })
    }
    profile.relation.photo_access = 'requested'
    return HttpResponse.json({ status: 'pending' }, { status: 201 })
  }),

  // ---- Reports (13 section 6.4) ------------------------------------------------------------

  http.post(apiUrl('/v1/reports'), async ({ request }) => {
    const blocked = gateErrorFor('connected')
    if (blocked) return blocked
    const body = await readJson<Partial<ReportBody>>(request)

    const fields: ApiFieldError[] = []
    if (!body.reason) {
      fields.push({ field: 'reason', code: 'required', message: 'Choose a reason.' })
    } else if (!REPORT_REASONS.has(body.reason)) {
      fields.push({ field: 'reason', code: 'unknown_code', message: 'Unknown reason.' })
    }
    if (typeof body.details === 'string' && body.details.length > DETAILS_MAX) {
      fields.push({ field: 'details', code: 'too_long', message: 'At most 1,000 characters.' })
    }
    if (!['profile', 'photo', 'message'].includes(body.subject_type ?? '')) {
      fields.push({ field: 'subject_type', code: 'invalid', message: 'Unknown subject.' })
    }
    if (fields.length > 0) {
      return apiError(400, 'validation_failed', 'Some fields need your attention.', { fields })
    }

    const profile = visibleProfile(body.target_profile_id ?? '')
    if (!profile) return notFound()
    if (body.subject_type === 'photo') {
      if (!profile.photos.some((photo) => photo.id === body.photo_id)) return notFound()
    }
    if (body.subject_type === 'message') {
      const connection = db.connections.find((item) => item.other?.id === profile.card.id)
      const messages = connection ? (db.messages.get(connection.id) ?? []) : []
      const message = messages.find((item) => item.id === body.message_id)
      if (message?.sender !== 'them') return notFound()
    }

    const counters = state()
    const duplicate = counters.reports.find(
      (report) =>
        report.target_profile_id === body.target_profile_id &&
        report.subject_type === body.subject_type &&
        (report.photo_id ?? null) === (body.photo_id ?? null) &&
        (report.message_id ?? null) === (body.message_id ?? null),
    )
    if (duplicate) {
      if (body.also_block) applyBlock(profile)
      return HttpResponse.json({ id: duplicate.id }, { status: 201 })
    }
    if (counters.reportsToday >= REPORTS_PER_DAY) {
      return apiError(429, 'limit_reached', 'Daily report limit reached.', {
        details: {
          limit: REPORTS_PER_DAY,
          used: counters.reportsToday,
          resets_at: nextMidnightKarachi(),
        },
      })
    }

    counters.reportsToday += 1
    const report: StoredReport = {
      ...(body as ReportBody),
      id: newId(),
      status: 'open',
      created_at: nowIso(),
    }
    counters.reports.push(report)
    if (body.also_block) applyBlock(profile)
    return HttpResponse.json({ id: report.id }, { status: 201 })
  }),
]
