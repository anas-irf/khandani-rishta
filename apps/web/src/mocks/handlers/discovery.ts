import { HttpResponse, http } from 'msw'
import type {
  ApiFieldError,
  Home,
  LastActive,
  NudgeCode,
  ProfileCard,
  ProfileDetail,
  RecommendationsPage,
  RelaxationHint,
  SavedSearch,
  SearchBody,
  SearchFilters,
  SearchPage,
  SearchSort,
  Visit,
} from '~/lib/api-types'
import { db } from '../db'
import { cities, regionsByCountry } from '../fixtures/geography'
import { referenceBootstrap } from '../fixtures/reference'
import { apiError, apiUrl, newId, noContent, notFound, nowIso, paginate, readJson } from '../http'
import { gateErrorFor } from './account'

/**
 * 15 section 10: home, recommendations, search, saved searches, visitors. The mock keeps the
 * rules that the screens can observe (10 sections 8 to 10, 09 section 8): who is discoverable,
 * the filters of 10 section 9.2, sorts, `total_estimate`, the 10-minute refresh limit, the
 * saved search limit and private browsing. Ranking is simply `compat`, highest first.
 *
 * Tests and developers steer the situations that need a real backend through
 * `db.extra.discovery` (see `discoveryState()`): an exhausted pool with relaxation hints, a
 * refresh in progress, the visitors list.
 */

export type MockVisit = { profileId: string; last_viewed_at: string; view_count: number }

export type DiscoveryState = {
  /** `pool_exhausted` of `GET /v1/home` and `GET /v1/recommendations` (10 section 8.7). */
  poolExhausted: boolean
  relaxationHints: RelaxationHint[]
  /** Answers `is_refreshing: true` while set. */
  isRefreshing: boolean
  /** Reads that still answer `is_refreshing: true` after `POST /v1/recommendations/refresh`. */
  refreshingReads: number
  refreshedAt: string | null
  /** When the last refresh was accepted (epoch ms), for the 10-minute limit. */
  lastRefreshAt: number | null
  /** Who viewed the member (newest first). */
  visitors: MockVisit[]
  /** Whom the member viewed (newest first). */
  visited: MockVisit[]
}

const HOUR = 3_600_000
const DAY = 24 * HOUR
const REFRESH_INTERVAL_MS = 10 * 60_000
const SAVED_SEARCHES_MAX = 10
const ESTIMATE_CAP = 500

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * HOUR).toISOString()
}

function seedVisits(indexes: number[], hours: number[]): MockVisit[] {
  const ids = [...db.profiles.keys()]
  return indexes.flatMap((index, n) => {
    const profileId = ids[index]
    return profileId
      ? [{ profileId, last_viewed_at: hoursAgo(hours[n] ?? 24), view_count: (n % 3) + 1 }]
      : []
  })
}

/** This area's state in `db.extra.discovery`, created on first use (reset with the db). */
export function discoveryState(): DiscoveryState {
  let current = db.extra.discovery as DiscoveryState | undefined
  if (!current) {
    current = {
      poolExhausted: false,
      relaxationHints: [],
      isRefreshing: false,
      refreshingReads: 0,
      refreshedAt: hoursAgo(3),
      lastRefreshAt: null,
      visitors: seedVisits([6, 7, 8, 11, 12, 13, 14, 15], [2, 20, 30, 50, 100, 200, 300, 500]),
      visited: seedVisits([9, 10], [5, 40]),
    }
    db.extra.discovery = current
  }
  return current
}

/** Records a profile view of the member (09 section 8.1), newest first. */
export function recordVisit(profileId: string) {
  const state = discoveryState()
  const existing = state.visited.find((visit) => visit.profileId === profileId)
  if (existing) {
    const last = new Date(existing.last_viewed_at).getTime()
    if (Date.now() - last > 30 * 60_000) existing.view_count += 1
    existing.last_viewed_at = nowIso()
    state.visited = [existing, ...state.visited.filter((visit) => visit !== existing)]
    return
  }
  state.visited.unshift({ profileId, last_viewed_at: nowIso(), view_count: 1 })
}

// ---------------------------------------------------------------------------
// Who appears where
// ---------------------------------------------------------------------------

function isBlocked(profileId: string): boolean {
  return db.blocks.some((entry) => entry.profile_id === profileId)
}

/** Openable at all (09 section 2): exists, not blocked, not the member. */
export function openableProfile(profileId: string): ProfileDetail | null {
  if (profileId === db.me.profile.id || isBlocked(profileId)) return null
  return db.profiles.get(profileId) ?? null
}

/**
 * Discovery lists use only the tier `member` plus the exclusions of 10 section 3: no relation
 * (connection, pending interest), no pass, no block.
 */
function discoverable(): ProfileDetail[] {
  return [...db.profiles.values()].filter(
    (profile) =>
      profile.relation.tier === 'member' &&
      !db.passes.has(profile.card.id) &&
      !isBlocked(profile.card.id),
  )
}

const ACTIVITY_ORDER: (LastActive | null)[] = [
  'online',
  'today',
  'this_week',
  'this_month',
  'earlier',
  null,
]

function activityRank(value: LastActive | null): number {
  return ACTIVITY_ORDER.indexOf(value)
}

function byCompat(a: ProfileDetail, b: ProfileDetail): number {
  return (
    (b.card.compat ?? 0) - (a.card.compat ?? 0) ||
    activityRank(a.card.last_active) - activityRank(b.card.last_active) ||
    a.card.id.localeCompare(b.card.id)
  )
}

function isNew(profile: ProfileDetail): boolean {
  return profile.card.badges.includes('new')
}

function cards(profiles: ProfileDetail[]): ProfileCard[] {
  return profiles.map((profile) => structuredClone(profile.card))
}

function ranked(): ProfileDetail[] {
  return discoverable().sort(byCompat)
}

function visitsToItems(visits: MockVisit[]): Visit[] {
  return visits.flatMap((visit) => {
    const profile = openableProfile(visit.profileId)
    return profile
      ? [
          {
            profile: structuredClone(profile.card),
            last_viewed_at: visit.last_viewed_at,
            view_count: visit.view_count,
          },
        ]
      : []
  })
}

function within(iso: string, ms: number): boolean {
  return Date.now() - new Date(iso).getTime() <= ms
}

// ---------------------------------------------------------------------------
// Nudges (10 section 10.1)
// ---------------------------------------------------------------------------

function nudges(): Home['nudges'] {
  const own = db.ownProfile
  const pending = (kind: 'id_document' | 'selfie') =>
    db.verificationRequests.some((request) => request.kind === kind && request.status === 'pending')
  const hasApproved = db.ownPhotos.some((photo) => photo.status === 'approved')
  const rows: [NudgeCode, number, boolean][] = [
    [
      'add_photo',
      100,
      !db.ownPhotos.some((photo) =>
        ['approved', 'processing', 'pending_review'].includes(photo.status),
      ),
    ],
    ['verify_identity', 90, db.identity?.status !== 'verified' && !pending('id_document')],
    [
      'add_about_me',
      80,
      (own.lifestyle.about_me ?? '').length < 100 || own.text_status.about_me === 'rejected',
    ],
    ['set_preferences', 70, db.preferences === null],
    [
      'verify_photo',
      60,
      hasApproved && !db.me.profile.badges.includes('photo_verified') && !pending('selfie'),
    ],
    [
      'add_contact_details',
      50,
      own.contacts.phone_e164 === null && own.contacts.guardian_phone_e164 === null,
    ],
    ['complete_profile', 40, db.me.profile.completeness < 70],
  ]
  return rows
    .filter(([, , applies]) => applies)
    .slice(0, 3)
    .map(([code, priority]) => ({ code, priority }))
}

// ---------------------------------------------------------------------------
// Search (10 section 9)
// ---------------------------------------------------------------------------

const FILTER_KEYS = new Set<keyof SearchFilters>([
  'public_code',
  'age_min',
  'age_max',
  'height_min_cm',
  'height_max_cm',
  'marital_statuses',
  'children_acceptance',
  'religion_codes',
  'sect_codes',
  'caste_codes',
  'mother_tongue_codes',
  'country_codes',
  'region_ids',
  'city_ids',
  'education_min_rank',
  'employment_types',
  'profession_codes',
  'income_min_rank',
  'religiosity_levels',
  'hijab_types',
  'beard_types',
  'family_values',
  'family_types',
  'living_arrangements',
  'work_after_marriage_options',
  'smoking_options',
  'managed_by',
  'has_photo',
  'verified_only',
  'active_within_days',
  'joined_within_days',
])

const SORTS: readonly SearchSort[] = ['best_match', 'newest', 'recently_active']

/** Normalises a profile code: trim, upper case, no spaces (10 section 9.1). */
export function normalizeCode(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase()
}

function present<T>(value: T[] | undefined | null): value is T[] {
  return Array.isArray(value) && value.length > 0
}

function given(value: number | undefined | null): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function validateFilters(filters: SearchFilters): ApiFieldError[] {
  const errors: ApiFieldError[] = []
  const range = (key: keyof SearchFilters, min: number, max: number) => {
    const value = filters[key]
    if (given(value as number) && ((value as number) < min || (value as number) > max)) {
      errors.push({
        field: `filters.${key}`,
        code: 'out_of_range',
        message: `Must be between ${min} and ${max}.`,
      })
    }
  }
  range('age_min', 18, 80)
  range('age_max', 18, 80)
  range('height_min_cm', 122, 213)
  range('height_max_cm', 122, 213)
  if (given(filters.age_min) && given(filters.age_max) && filters.age_min > filters.age_max) {
    errors.push({
      field: 'filters.age_min',
      code: 'invalid',
      message: 'The minimum age must not be above the maximum.',
    })
  }
  if (
    given(filters.height_min_cm) &&
    given(filters.height_max_cm) &&
    filters.height_min_cm > filters.height_max_cm
  ) {
    errors.push({
      field: 'filters.height_min_cm',
      code: 'invalid',
      message: 'The minimum height must not be above the maximum.',
    })
  }
  if (given(filters.active_within_days) && ![1, 7, 30].includes(filters.active_within_days)) {
    errors.push({ field: 'filters.active_within_days', code: 'invalid', message: 'Invalid.' })
  }
  if (given(filters.joined_within_days) && ![7, 30].includes(filters.joined_within_days)) {
    errors.push({ field: 'filters.joined_within_days', code: 'invalid', message: 'Invalid.' })
  }
  return errors
}

const educationRank = new Map(
  referenceBootstrap.education_levels.map((level) => [level.code, level.rank]),
)
const incomeRank = new Map(referenceBootstrap.income_bands.map((band) => [band.code, band.rank]))
const casteName = new Map(referenceBootstrap.castes.map((caste) => [caste.code, caste.name]))
const cityName = new Map(cities.map((city) => [city.id, city.name]))
const regionName = new Map(
  Object.values(regionsByCountry).flatMap((regions) =>
    regions.map((region) => [region.id, region.name] as const),
  ),
)

const ACTIVE_WITHIN: Record<number, (LastActive | null)[]> = {
  1: ['online', 'today'],
  7: ['online', 'today', 'this_week'],
  30: ['online', 'today', 'this_week', 'this_month'],
}

/** Search filters are exact: a null value never matches a filter on it (10 section 9.2). */
export function matchesFilters(profile: ProfileDetail, filters: SearchFilters): boolean {
  const { card } = profile
  const inSet = (values: string[] | undefined, value: string | null | undefined) =>
    !present(values) || (value != null && values.includes(value))

  if (given(filters.age_min) && card.age < filters.age_min) return false
  if (given(filters.age_max) && card.age > filters.age_max) return false
  if (given(filters.height_min_cm) && card.height_cm < filters.height_min_cm) return false
  if (given(filters.height_max_cm) && card.height_cm > filters.height_max_cm) return false
  if (!inSet(filters.marital_statuses, card.marital_status)) return false

  if (filters.children_acceptance && filters.children_acceptance !== 'any') {
    const status =
      profile.basics.children_status ?? (card.marital_status === 'never_married' ? 'none' : null)
    const allowed =
      filters.children_acceptance === 'none' ? ['none'] : ['none', 'not_living_with_me']
    if (status === null || !allowed.includes(status)) return false
  }

  if (!inSet(filters.religion_codes, card.religion_code)) return false
  if (!inSet(filters.sect_codes, card.sect_code)) return false
  if (present(filters.caste_codes)) {
    const names = filters.caste_codes.map((code) => casteName.get(code))
    if (!card.caste_label || !names.includes(card.caste_label)) return false
  }
  if (!inSet(filters.mother_tongue_codes, card.mother_tongue_code)) return false

  if (present(filters.country_codes) || present(filters.region_ids) || present(filters.city_ids)) {
    const byCountry = filters.country_codes?.includes(card.country_code) ?? false
    const byRegion = (filters.region_ids ?? []).some(
      (id) => regionName.get(id) === card.region_name,
    )
    const byCity = (filters.city_ids ?? []).some((id) => cityName.get(id) === card.city_name)
    if (!byCountry && !byRegion && !byCity) return false
  }

  if (
    given(filters.education_min_rank) &&
    (educationRank.get(card.education_level_code) ?? 0) < filters.education_min_rank
  ) {
    return false
  }
  if (!inSet(filters.employment_types, card.employment_type)) return false
  if (!inSet(filters.profession_codes, card.profession_code)) return false
  if (given(filters.income_min_rank)) {
    const code = profile.education_career.income_band_code
    if (!code || (incomeRank.get(code) ?? 0) < filters.income_min_rank) return false
  }

  const { lifestyle } = profile
  if (!inSet(filters.religiosity_levels, lifestyle.religiosity)) return false
  const viewerGender = db.me.profile.gender
  if (viewerGender === 'male' && !inSet(filters.hijab_types, lifestyle.hijab)) return false
  if (viewerGender === 'female' && !inSet(filters.beard_types, lifestyle.beard)) return false
  if (!inSet(filters.family_values, profile.family?.family_values)) return false
  if (!inSet(filters.family_types, profile.family?.family_type)) return false
  if (!inSet(filters.living_arrangements, lifestyle.living_arrangement)) return false
  if (!inSet(filters.work_after_marriage_options, lifestyle.work_after_marriage)) return false
  if (!inSet(filters.smoking_options, lifestyle.smoking)) return false
  if (!inSet(filters.managed_by, card.managed_by)) return false

  if (filters.has_photo === true && card.photo === null) return false
  if (
    filters.verified_only === true &&
    !card.badges.includes('id_verified') &&
    !card.badges.includes('photo_verified')
  ) {
    return false
  }
  if (given(filters.active_within_days)) {
    const allowed = ACTIVE_WITHIN[filters.active_within_days] ?? []
    if (!allowed.includes(card.last_active)) return false
  }
  // The mock knows only the `new` badge (joined within 7 days).
  if (given(filters.joined_within_days) && !isNew(profile)) return false
  return true
}

function sortProfiles(profiles: ProfileDetail[], sort: SearchSort): ProfileDetail[] {
  const list = [...profiles]
  if (sort === 'newest') {
    return list.sort(
      (a, b) => Number(isNew(b)) - Number(isNew(a)) || b.card.id.localeCompare(a.card.id),
    )
  }
  if (sort === 'recently_active') {
    return list.sort(
      (a, b) =>
        activityRank(a.card.last_active) - activityRank(b.card.last_active) ||
        b.card.id.localeCompare(a.card.id),
    )
  }
  return list.sort(byCompat)
}

function pageFromBody<T>(items: T[], cursor: string | undefined, limit: number | undefined) {
  const size = Math.min(Math.max(Number(limit ?? 20) || 20, 1), 50)
  const offset = Number(cursor ?? 0) || 0
  const slice = items.slice(offset, offset + size)
  return {
    items: slice,
    next_cursor: offset + size < items.length ? String(offset + size) : null,
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const handlers = [
  http.get(apiUrl('/v1/home'), () => {
    const blocked = gateErrorFor('browse')
    if (blocked) return blocked
    const state = discoveryState()
    const all = ranked()
    const recommendations = all.slice(0, 10)
    const taken = new Set(recommendations.map((profile) => profile.card.id))
    const newMembers = all.filter((profile) => isNew(profile) && !taken.has(profile.card.id))
    for (const profile of newMembers.slice(0, 10)) taken.add(profile.card.id)

    const ownCity = db.ownProfile.location.city?.name ?? null
    const ownRegion = db.ownProfile.location.city?.region_name ?? null
    const rest = all.filter((profile) => !taken.has(profile.card.id))
    const sameCity = ownCity ? rest.filter((profile) => profile.card.city_name === ownCity) : []
    const sameRegion =
      sameCity.length < 10 && ownRegion
        ? rest.filter(
            (profile) =>
              profile.card.city_name !== ownCity && profile.card.region_name === ownRegion,
          )
        : []

    const privateBrowsing = !db.privacy.record_my_visits
    const recentVisits = privateBrowsing
      ? []
      : visitsToItems(state.visitors).filter((visit) => within(visit.last_viewed_at, 7 * DAY))

    const home: Home = {
      recommendations: cards(recommendations),
      new_members: cards(newMembers.slice(0, 10)),
      nearby: cards([...sameCity, ...sameRegion].slice(0, 10)),
      recent_visitors: recentVisits.slice(0, 5).map((visit) => visit.profile),
      visitors_count_7d: recentVisits.length,
      pending_interests: db.interests.filter(
        (interest) =>
          interest.direction === 'received' &&
          interest.status === 'pending' &&
          interest.profile !== null &&
          !isBlocked(interest.profile.id),
      ).length,
      completeness: db.me.profile.completeness,
      nudges: nudges(),
      pool_exhausted: state.poolExhausted,
      relaxation_hints: state.poolExhausted ? state.relaxationHints.slice(0, 2) : [],
    }
    return HttpResponse.json(home)
  }),

  http.get(apiUrl('/v1/recommendations'), ({ request }) => {
    const blocked = gateErrorFor('browse')
    if (blocked) return blocked
    const state = discoveryState()
    let isRefreshing = state.isRefreshing
    if (state.refreshingReads > 0) {
      state.refreshingReads -= 1
      isRefreshing = true
    }
    const page: RecommendationsPage = {
      ...paginate(cards(ranked()), request),
      refreshed_at: state.refreshedAt,
      is_refreshing: isRefreshing,
      pool_exhausted: state.poolExhausted,
      relaxation_hints: state.poolExhausted ? state.relaxationHints.slice(0, 2) : [],
    }
    return HttpResponse.json(page)
  }),

  http.post(apiUrl('/v1/recommendations/refresh'), () => {
    const blocked = gateErrorFor('browse')
    if (blocked) return blocked
    const state = discoveryState()
    const now = Date.now()
    if (state.lastRefreshAt !== null && now - state.lastRefreshAt < REFRESH_INTERVAL_MS) {
      const retry = Math.ceil((REFRESH_INTERVAL_MS - (now - state.lastRefreshAt)) / 1000)
      return apiError(429, 'rate_limited', 'Recommendations were refreshed recently.', {
        details: { retry_after_seconds: retry },
      })
    }
    state.lastRefreshAt = now
    state.refreshingReads = 1
    state.refreshedAt = new Date(now).toISOString()
    return new HttpResponse(null, { status: 202 })
  }),

  http.post(apiUrl('/v1/search'), async ({ request }) => {
    const blocked = gateErrorFor('browse')
    if (blocked) return blocked
    const body = await readJson<Partial<SearchBody>>(request)
    const filters: SearchFilters = body.filters ?? {}
    const unknown = Object.keys(filters).find((key) => !FILTER_KEYS.has(key as keyof SearchFilters))
    if (unknown) return apiError(400, 'bad_request', `Unknown filter ${unknown}`)
    const sort = body.sort ?? 'best_match'
    if (!SORTS.includes(sort)) return apiError(400, 'bad_request', `Unknown sort ${sort}`)
    const errors = validateFilters(filters)
    if (errors.length > 0) {
      return apiError(400, 'validation_failed', 'Some fields need your attention.', {
        fields: errors,
      })
    }

    // A profile code ignores every other filter and the exclusions E4 to E7 (10 section 9.1).
    let matches: ProfileDetail[]
    if (typeof filters.public_code === 'string' && filters.public_code.trim()) {
      const code = normalizeCode(filters.public_code)
      matches = [...db.profiles.values()].filter(
        (profile) => profile.card.public_code === code && openableProfile(profile.card.id),
      )
    } else {
      matches = sortProfiles(
        discoverable().filter((profile) => matchesFilters(profile, filters)),
        sort,
      )
    }

    const page = pageFromBody(cards(matches), body.cursor, body.limit)
    const result: SearchPage = {
      ...page,
      total_estimate: body.cursor ? null : matches.length <= ESTIMATE_CAP ? matches.length : null,
    }
    return HttpResponse.json(result)
  }),

  // ---- Saved searches ----------------------------------------------------------------------

  http.get(apiUrl('/v1/me/saved-searches'), () => {
    const blocked = gateErrorFor('browse')
    if (blocked) return blocked
    return HttpResponse.json({ items: db.savedSearches, next_cursor: null })
  }),

  http.post(apiUrl('/v1/me/saved-searches'), async ({ request }) => {
    const blocked = gateErrorFor('browse')
    if (blocked) return blocked
    const body = await readJson<Partial<SavedSearch>>(request)
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (name.length < 1 || name.length > 60) {
      return apiError(400, 'validation_failed', 'Some fields need your attention.', {
        fields: [
          {
            field: 'name',
            code: name.length < 1 ? 'required' : 'too_long',
            message: 'Between 1 and 60 characters.',
          },
        ],
      })
    }
    if (db.savedSearches.length >= SAVED_SEARCHES_MAX) {
      return apiError(429, 'limit_reached', 'You can keep up to 10 saved searches.', {
        details: { limit: SAVED_SEARCHES_MAX, used: db.savedSearches.length, resets_at: null },
      })
    }
    const saved: SavedSearch = {
      id: newId(),
      name,
      filters: body.filters ?? {},
      notify_new: body.notify_new === true,
      created_at: nowIso(),
    }
    db.savedSearches.unshift(saved)
    return HttpResponse.json(saved, { status: 201 })
  }),

  http.patch(apiUrl('/v1/me/saved-searches/:id'), async ({ params, request }) => {
    const blocked = gateErrorFor('browse')
    if (blocked) return blocked
    const saved = db.savedSearches.find((entry) => entry.id === params.id)
    if (!saved) return notFound()
    const body = await readJson<{ name?: string; notify_new?: boolean }>(request)
    const unknown = Object.keys(body).find((key) => key !== 'name' && key !== 'notify_new')
    if (unknown) return apiError(400, 'bad_request', `Unknown field ${unknown}`)
    if (body.name !== undefined) {
      const name = body.name.trim()
      if (name.length < 1 || name.length > 60) {
        return apiError(400, 'validation_failed', 'Some fields need your attention.', {
          fields: [
            {
              field: 'name',
              code: name.length < 1 ? 'required' : 'too_long',
              message: 'Between 1 and 60 characters.',
            },
          ],
        })
      }
      saved.name = name
    }
    if (typeof body.notify_new === 'boolean') saved.notify_new = body.notify_new
    return HttpResponse.json(saved)
  }),

  http.delete(apiUrl('/v1/me/saved-searches/:id'), ({ params }) => {
    const blocked = gateErrorFor('browse')
    if (blocked) return blocked
    const before = db.savedSearches.length
    db.savedSearches = db.savedSearches.filter((entry) => entry.id !== params.id)
    if (db.savedSearches.length === before) return notFound()
    return noContent()
  }),

  // ---- Visits (09 section 8) ------------------------------------------------------------------

  http.get(apiUrl('/v1/me/visitors'), ({ request }) => {
    const blocked = gateErrorFor('browse')
    if (blocked) return blocked
    if (!db.privacy.record_my_visits) {
      return HttpResponse.json({ items: [], next_cursor: null, hidden_because_private: true })
    }
    const items = visitsToItems(discoveryState().visitors).filter((visit) =>
      within(visit.last_viewed_at, 30 * DAY),
    )
    return HttpResponse.json({ ...paginate(items, request), hidden_because_private: false })
  }),

  http.get(apiUrl('/v1/me/visited'), ({ request }) => {
    const blocked = gateErrorFor('browse')
    if (blocked) return blocked
    const items = visitsToItems(discoveryState().visited).filter((visit) =>
      within(visit.last_viewed_at, 30 * DAY),
    )
    return HttpResponse.json(paginate(items, request))
  }),
]
