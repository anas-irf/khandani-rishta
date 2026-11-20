import { describe, expect, it } from 'vitest'
import { ApiError, http } from '~/lib/api'
import type { ProfileDetail, SearchFilters, SearchSort } from '~/lib/api-types'
import { db } from '../db'
import { referenceBootstrap } from '../fixtures/reference'
import { discoveryState } from './discovery'
import { simulateProfileViewLimit } from './profiles'

function search(filters: SearchFilters, sort: SearchSort = 'best_match', cursor?: string) {
  return http.post('/v1/search', {
    filters,
    sort,
    limit: 50,
    ...(cursor ? { cursor } : {}),
  })
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  }
  throw new Error('Expected the request to fail')
}

function detailOf(id: string): ProfileDetail {
  const profile = db.profiles.get(id)
  if (!profile) throw new Error(`No profile ${id}`)
  return profile
}

const rank = new Map(referenceBootstrap.education_levels.map((level) => [level.code, level.rank]))

describe('GET /v1/home', () => {
  it('builds the rows from discoverable members only', async () => {
    const home = await http.get('/v1/home')
    expect(home.recommendations.length).toBe(10)
    for (const card of [...home.recommendations, ...home.new_members, ...home.nearby]) {
      expect(card.relation.tier).toBe('member')
    }
    const ids = [...home.recommendations, ...home.new_members, ...home.nearby].map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(home.nearby.every((card) => card.region_name === 'Punjab')).toBe(true)
    expect(home.pending_interests).toBe(2)
    expect(home.visitors_count_7d).toBeGreaterThan(0)
    expect(home.recent_visitors.length).toBeLessThanOrEqual(5)
    expect(home.nudges.length).toBeLessThanOrEqual(3)
    expect(home.nudges.map((nudge) => nudge.code)).toEqual([
      'verify_identity',
      'add_about_me',
      'add_contact_details',
    ])
  })

  it('leaves out passed and blocked members', async () => {
    const first = await http.get('/v1/home')
    const passed = first.recommendations[0]?.id ?? ''
    const blocked = first.recommendations[1]?.id ?? ''
    db.passes.add(passed)
    db.blocks.push({ profile_id: blocked, display_name: 'X', public_code: 'KR', created_at: '' })
    const home = await http.get('/v1/home')
    const ids = [...home.recommendations, ...home.new_members, ...home.nearby].map((c) => c.id)
    expect(ids).not.toContain(passed)
    expect(ids).not.toContain(blocked)
  })

  it('reports an exhausted pool with at most two hints, and private browsing', async () => {
    const state = discoveryState()
    state.poolExhausted = true
    state.relaxationHints = [
      { dimension: 'caste', extra_profiles: 12 },
      { dimension: 'location', extra_profiles: 3 },
      { dimension: 'sect', extra_profiles: 1 },
    ]
    db.privacy.record_my_visits = false
    const home = await http.get('/v1/home')
    expect(home.pool_exhausted).toBe(true)
    expect(home.relaxation_hints).toEqual([
      { dimension: 'caste', extra_profiles: 12 },
      { dimension: 'location', extra_profiles: 3 },
    ])
    expect(home.recent_visitors).toEqual([])
    expect(home.visitors_count_7d).toBe(0)
  })

  it('answers profile_not_active for a paused profile', async () => {
    db.me.profile.status = 'paused'
    const error = await failure(http.get('/v1/home'))
    expect(error.code).toBe('profile_not_active')
  })
})

describe('recommendations', () => {
  it('pages with refreshed_at, is_refreshing, pool_exhausted and relaxation_hints', async () => {
    const first = await http.get('/v1/recommendations', {
      query: { limit: 20 },
    })
    expect(first.items).toHaveLength(20)
    expect(first.next_cursor).toBe('20')
    expect(first.refreshed_at).not.toBeNull()
    expect(first.is_refreshing).toBe(false)
    expect(first.pool_exhausted).toBe(false)
    expect(first.relaxation_hints).toEqual([])
    const second = await http.get('/v1/recommendations', {
      query: { limit: 20, cursor: first.next_cursor },
    })
    expect(second.next_cursor).toBeNull()
    const compat = [...first.items, ...second.items].map((card) => card.compat ?? 0)
    expect(compat).toEqual([...compat].sort((a, b) => b - a))
  })

  it('accepts one refresh per 10 minutes and then reports the refresh in progress once', async () => {
    await http.post('/v1/recommendations/refresh')
    const error = await failure(http.post('/v1/recommendations/refresh'))
    expect(error.status).toBe(429)
    expect(error.code).toBe('rate_limited')
    expect(Number(error.details.retry_after_seconds)).toBeGreaterThan(0)

    const during = await http.get('/v1/recommendations')
    expect(during.is_refreshing).toBe(true)
    const after = await http.get('/v1/recommendations')
    expect(after.is_refreshing).toBe(false)
  })
})

describe('POST /v1/search', () => {
  it('applies the age, sect, city, education, photo and verified filters exactly', async () => {
    const ages = await search({ age_min: 30, age_max: 31 })
    expect(ages.items.length).toBeGreaterThan(0)
    expect(ages.items.every((card) => card.age >= 30 && card.age <= 31)).toBe(true)

    const shia = await search({ religion_codes: ['islam'], sect_codes: ['shia'] })
    expect(shia.items.length).toBeGreaterThan(0)
    expect(shia.items.every((card) => card.sect_code === 'shia')).toBe(true)

    const lahore = await search({ city_ids: [1001] })
    expect(lahore.items.length).toBeGreaterThan(0)
    expect(lahore.items.every((card) => card.city_name === 'Lahore')).toBe(true)

    const educated = await search({ education_min_rank: 6 })
    expect(educated.items.every((card) => (rank.get(card.education_level_code) ?? 0) >= 6)).toBe(
      true,
    )

    const withPhoto = await search({ has_photo: true })
    expect(withPhoto.items.every((card) => card.photo !== null)).toBe(true)

    const verified = await search({ verified_only: true })
    expect(verified.items.length).toBeGreaterThan(0)
    expect(
      verified.items.every(
        (card) => card.badges.includes('id_verified') || card.badges.includes('photo_verified'),
      ),
    ).toBe(true)

    const none = await search({ religion_codes: ['christianity'] })
    expect(none.items).toEqual([])
    expect(none.total_estimate).toBe(0)
  })

  it('combines country, region and city as one condition and filters marital status and mother tongue', async () => {
    const punjab = await search({ region_ids: [6] })
    expect(punjab.items.every((card) => card.region_name === 'Punjab')).toBe(true)
    const divorced = await search({ marital_statuses: ['divorced'] })
    expect(divorced.items.every((card) => card.marital_status === 'divorced')).toBe(true)
    const urdu = await search({ mother_tongue_codes: ['urdu'] })
    expect(urdu.items.every((card) => card.mother_tongue_code === 'urdu')).toBe(true)
  })

  it('never returns a relation or a passed member, but finds anyone openable by code', async () => {
    const all = await search({})
    expect(all.items.every((card) => card.relation.tier === 'member')).toBe(true)
    expect(all.total_estimate).toBe(all.items.length)

    const connection = [...db.profiles.values()].find((p) => p.relation.tier === 'connection')
    const code = connection?.card.public_code ?? ''
    const byCode = await search({ public_code: ` ${code.toLowerCase()} `, age_min: 80 })
    expect(byCode.items.map((card) => card.id)).toEqual([connection?.card.id])
  })

  it('sorts newest members first and pages with a cursor', async () => {
    const newest = await search({}, 'newest')
    const firstOld = newest.items.findIndex((card) => !card.badges.includes('new'))
    expect(newest.items.slice(firstOld).some((card) => card.badges.includes('new'))).toBe(false)

    const page = await http.post('/v1/search', {
      filters: {},
      sort: 'best_match',
      limit: 10,
    })
    expect(page.items).toHaveLength(10)
    expect(page.next_cursor).toBe('10')
    expect(page.total_estimate).toBeGreaterThan(10)
    const next = await http.post('/v1/search', {
      filters: {},
      sort: 'best_match',
      limit: 10,
      cursor: page.next_cursor,
    })
    expect(next.total_estimate).toBeNull()
    expect(next.items[0]?.id).not.toBe(page.items[0]?.id)
  })

  it('answers validation_failed and bad_request like the API', async () => {
    const invalid = await failure(search({ age_min: 40, age_max: 30 }))
    expect(invalid.code).toBe('validation_failed')
    expect(invalid.fields[0]?.field).toBe('filters.age_min')

    const range = await failure(search({ height_min_cm: 90 }))
    expect(range.fields[0]).toMatchObject({ field: 'filters.height_min_cm', code: 'out_of_range' })

    // A key the API does not know, built outside the call because the contract refuses it.
    const withUnknownKey = { age_min: 20, complexion: ['fair'] }
    const unknown = await failure(
      http.post('/v1/search', { filters: withUnknownKey, sort: 'best_match' }),
    )
    expect(unknown.code).toBe('bad_request')
  })
})

describe('saved searches', () => {
  it('creates, lists newest first, renames, toggles and deletes', async () => {
    const first = await http.post('/v1/me/saved-searches', {
      name: 'Lahore',
      filters: { city_ids: [1001] },
      notify_new: false,
    })
    const second = await http.post('/v1/me/saved-searches', {
      name: 'Doctors',
      filters: { profession_codes: ['doctor'] },
      notify_new: true,
    })
    const list = await http.get('/v1/me/saved-searches')
    expect(list.items.map((item) => item.id)).toEqual([second.id, first.id])

    const renamed = await http.patch(`/v1/me/saved-searches/${first.id}`, {
      name: 'Lahore only',
      notify_new: true,
    })
    expect(renamed).toMatchObject({ name: 'Lahore only', notify_new: true })

    await http.delete(`/v1/me/saved-searches/${second.id}`)
    const after = await http.get('/v1/me/saved-searches')
    expect(after.items.map((item) => item.id)).toEqual([first.id])
    const missing = await failure(http.delete(`/v1/me/saved-searches/${second.id}`))
    expect(missing.code).toBe('not_found')
  })

  it('refuses an empty name and an eleventh saved search', async () => {
    const empty = await failure(
      http.post('/v1/me/saved-searches', { name: ' ', filters: {}, notify_new: false }),
    )
    expect(empty.fields[0]).toMatchObject({ field: 'name', code: 'required' })

    for (let index = 0; index < 10; index += 1) {
      await http.post('/v1/me/saved-searches', {
        name: `S${index}`,
        filters: {},
        notify_new: false,
      })
    }
    const limit = await failure(
      http.post('/v1/me/saved-searches', { name: 'One more', filters: {}, notify_new: false }),
    )
    expect(limit.status).toBe(429)
    expect(limit.code).toBe('limit_reached')
    expect(limit.details.limit).toBe(10)
  })
})

describe('visits', () => {
  it('lists visitors, or hides them while browsing privately', async () => {
    const visitors = await http.get('/v1/me/visitors')
    expect(visitors.items.length).toBeGreaterThan(0)
    expect(visitors.hidden_because_private).toBe(false)

    db.privacy.record_my_visits = false
    const hidden = await http.get('/v1/me/visitors')
    expect(hidden).toEqual({ items: [], next_cursor: null, hidden_because_private: true })

    // The member's own history still works (09 section 8.2).
    const visited = await http.get('/v1/me/visited')
    expect(visited.items.length).toBeGreaterThan(0)
  })

  it('records a profile view in the visited list, newest first', async () => {
    const id = [...db.profiles.values()].find((p) => p.relation.tier === 'member')?.card.id ?? ''
    await http.get(`/v1/profiles/${id}`)
    const visited = await http.get('/v1/me/visited')
    expect(visited.items[0]?.profile.id).toBe(id)
  })
})

describe('GET /v1/profiles/{id} and by-code', () => {
  const memberId = () =>
    [...db.profiles.values()].find((p) => p.relation.tier === 'member')?.card.id ?? ''

  it('answers 404 for an unknown, blocked or own profile', async () => {
    expect((await failure(http.get('/v1/profiles/nope'))).code).toBe('not_found')
    expect((await failure(http.get(`/v1/profiles/${db.me.profile.id}`))).code).toBe('not_found')
    const id = memberId()
    db.blocks.push({ profile_id: id, display_name: 'X', public_code: 'KR', created_at: '' })
    expect((await failure(http.get(`/v1/profiles/${id}`))).code).toBe('not_found')
  })

  it('returns the detail with the viewer state of shortlist and pass', async () => {
    const id = memberId()
    db.shortlist.push({ profile_id: id, profile: null, note: 'Ask about family', created_at: '' })
    db.passes.add(id)
    const detail = await http.get(`/v1/profiles/${id}`)
    expect(detail.relation).toMatchObject({
      is_shortlisted: true,
      shortlist_note: 'Ask about family',
      is_passed: true,
    })
  })

  it('simulates the daily view limit for new views only', async () => {
    const seen = memberId()
    await http.get(`/v1/profiles/${seen}`)
    simulateProfileViewLimit()
    await expect(http.get(`/v1/profiles/${seen}`)).resolves.toBeTruthy()
    const other = [...db.profiles.values()].filter((p) => p.relation.tier === 'member')[3]
    const error = await failure(http.get(`/v1/profiles/${other?.card.id}`))
    expect(error.status).toBe(429)
    expect(error.code).toBe('limit_reached')
  })

  it('lets a paused member open only connections and interest counterparts', async () => {
    db.me.profile.status = 'paused'
    const error = await failure(http.get(`/v1/profiles/${memberId()}`))
    expect(error.code).toBe('profile_not_active')
    const connection = [...db.profiles.values()].find((p) => p.relation.tier === 'connection')
    const detail = await http.get(`/v1/profiles/${connection?.card.id}`)
    expect(detail.relation.tier).toBe('connection')
  })

  it('resolves a profile code, normalised, and answers 404 for an unknown one', async () => {
    const profile = detailOf(memberId())
    const found = await http.get(`/v1/profiles/by-code/${profile.card.public_code.toLowerCase()}`)
    expect(found.profile_id).toBe(profile.card.id)
    expect((await failure(http.get('/v1/profiles/by-code/KR00000000'))).code).toBe('not_found')
  })
})
