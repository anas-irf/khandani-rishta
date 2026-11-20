import { HttpResponse, http } from 'msw'
import type { ProfileDetail } from '~/lib/api-types'
import { todayInKarachi } from '~/lib/format'
import { db } from '../db'
import { apiError, apiUrl, notFound } from '../http'
import { gateErrorFor } from './account'
import { normalizeCode, openableProfile, recordVisit } from './discovery'

/**
 * 15 section 10: another member's profile and the profile code lookup. Visibility follows
 * 09 section 2 as far as the mock knows it: unknown ids, the member's own id and blocked
 * members answer `404 not_found`. A paused or closed member may open only connections and
 * interest counterparts (`profile_not_active` otherwise, 15 section 10).
 *
 * `simulateProfileViewLimit()` makes every new profile view of the day answer `limit_reached`
 * (09 section 8.1), so the dialog of 16 section 6.7 can be exercised.
 */

export type ProfilesState = {
  /** Karachi day the views below belong to. */
  day: string
  /** Profiles viewed today; reopening one never counts against the limit. */
  viewedToday: string[]
  /** When true, a new view of the day answers `429 limit_reached`. */
  viewLimitReached: boolean
}

const PROFILE_VIEWS_PER_DAY = 50

export function profilesState(): ProfilesState {
  const today = todayInKarachi()
  let current = db.extra.profiles as ProfilesState | undefined
  if (!current) {
    current = { day: today, viewedToday: [], viewLimitReached: false }
    db.extra.profiles = current
  }
  if (current.day !== today) {
    current.day = today
    current.viewedToday = []
  }
  return current
}

/** Test and development hook: the daily profile view limit is used up. */
export function simulateProfileViewLimit(reached = true) {
  profilesState().viewLimitReached = reached
}

function nextMidnightKarachi(): string {
  const now = new Date()
  const reset = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 19, 0, 0),
  )
  if (reset.getTime() <= now.getTime()) reset.setUTCDate(reset.getUTCDate() + 1)
  return reset.toISOString()
}

/** The detail with the viewer's current shortlist and pass state. */
function withViewerState(profile: ProfileDetail): ProfileDetail {
  const detail = structuredClone(profile)
  const entry = db.shortlist.find((item) => item.profile_id === profile.card.id)
  detail.relation.is_shortlisted = Boolean(entry)
  detail.relation.shortlist_note = entry?.note ?? null
  detail.card.relation.is_shortlisted = Boolean(entry)
  detail.relation.is_passed = db.passes.has(profile.card.id)
  return detail
}

export const handlers = [
  // Before `/v1/profiles/:profileId` so the literal segment wins.
  http.get(apiUrl('/v1/profiles/by-code/:code'), ({ params }) => {
    const blocked = gateErrorFor('browse')
    if (blocked) return blocked
    const code = normalizeCode(String(params.code))
    const profile = [...db.profiles.values()].find((item) => item.card.public_code === code)
    if (!profile || !openableProfile(profile.card.id)) return notFound()
    return HttpResponse.json({ profile_id: profile.card.id })
  }),

  http.get(apiUrl('/v1/profiles/:profileId'), ({ params }) => {
    const blocked = gateErrorFor('connected')
    if (blocked) return blocked
    const profile = openableProfile(String(params.profileId))
    if (!profile) return notFound()

    const tier = profile.relation.tier
    const related =
      tier === 'connection' || tier === 'interest_from_owner' || tier === 'interest_to_owner'
    const status = db.me.profile.status
    if (status !== 'active' && !related) {
      return apiError(403, 'profile_not_active', 'Profile not active', { details: { status } })
    }

    // 09 section 8.1: connections are not counted; a profile already viewed today is free.
    if (tier !== 'connection') {
      const state = profilesState()
      const id = profile.card.id
      if (!state.viewedToday.includes(id)) {
        if (state.viewLimitReached) {
          return apiError(429, 'limit_reached', 'Daily profile view limit reached.', {
            details: {
              limit: 'limits.profile_views_per_day',
              used: PROFILE_VIEWS_PER_DAY,
              resets_at: nextMidnightKarachi(),
            },
          })
        }
        state.viewedToday.push(id)
      }
      recordVisit(id)
    }
    return HttpResponse.json(withViewerState(profile))
  }),
]
