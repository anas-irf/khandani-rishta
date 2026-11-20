import { useSearch } from '@tanstack/react-router'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LimitDialog } from '~/components/common/LimitDialog'
import type { SavedSearch, SearchFilters, SearchSort } from '~/lib/api-types'
import { closeLimitDialog } from '~/lib/dialogs'
import { db } from '~/mocks/db'
import { makePreferences } from '~/mocks/factories'
import { apiError, apiUrl } from '~/mocks/http'
import { server } from '~/mocks/server'
import { renderWithProviders } from '~/test/render'
import { SearchScreen } from './SearchScreen'
import { resetSearchSession } from './search/search-session'
import { decodeSearchQuery, encodeSearchQuery } from './search-params'

function SearchFromUrl() {
  const search = useSearch({ strict: false }) as { q?: string; saved_search_id?: string }
  return (
    <>
      <SearchScreen q={search.q} savedSearchId={search.saved_search_id} />
      <LimitDialog />
    </>
  )
}

function renderSearch(path = '/search') {
  return renderWithProviders(() => <SearchFromUrl />, { me: db.me, path })
}

function currentQuery(router: ReturnType<typeof renderSearch>['router']) {
  return decodeSearchQuery((router.state.location.search as { q?: string }).q)
}

function pathWith(filters: SearchFilters, sort: SearchSort = 'best_match') {
  return `/search?q=${encodeSearchQuery({ filters, sort })}`
}

const ageFrom = () => screen.getByRole('combobox', { name: 'Age, from' })
const ageTo = () => screen.getByRole('combobox', { name: 'Age, to' })

beforeEach(() => {
  resetSearchSession()
  db.preferences = makePreferences({ age_min: 25, age_max: 32, sect_codes: ['sunni'] })
})

afterEach(() => closeLimitDialog())

describe('APP-SEARCH initial state', () => {
  it('fills the form from the partner preferences without searching', async () => {
    let searches = 0
    server.use(
      http.post(apiUrl('/v1/search'), () => {
        searches += 1
        return HttpResponse.json({ items: [], next_cursor: null, total_estimate: 0 })
      }),
    )
    renderSearch()
    await waitFor(() => expect(ageFrom()).toHaveValue('25'))
    expect(ageTo()).toHaveValue('32')
    expect(screen.getByRole('button', { name: 'Islam', pressed: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sunni', pressed: true })).toBeInTheDocument()
    expect(screen.getByText('Set your filters, then tap Search.')).toBeInTheDocument()
    expect(searches).toBe(0)
  })

  it('runs the search on "Search", puts it in the URL and shows the count', async () => {
    const user = userEvent.setup()
    let body: unknown = null
    server.use(
      http.post(apiUrl('/v1/search'), async ({ request }) => {
        body = await request.json()
        return undefined
      }),
    )
    const { router } = renderSearch()
    await waitFor(() => expect(ageFrom()).toHaveValue('25'))
    await user.click(screen.getByRole('button', { name: 'Search' }))

    const results = await screen.findByRole('region', { name: 'Search results' })
    expect(await within(results).findByText(/^\d+ profiles?$/)).toBeInTheDocument()
    expect(within(results).getAllByRole('article').length).toBeGreaterThan(0)
    const expected = {
      age_min: 25,
      age_max: 32,
      marital_statuses: ['never_married'],
      religion_codes: ['islam'],
      sect_codes: ['sunni'],
      country_codes: ['PK'],
    }
    expect(currentQuery(router)).toEqual({ filters: expected, sort: 'best_match' })
    expect(body).toEqual({ filters: expected, sort: 'best_match', limit: 20 })
  })

  it('keeps the form for the rest of the session instead of copying the preferences again', async () => {
    const user = userEvent.setup()
    const first = renderSearch()
    await waitFor(() => expect(ageFrom()).toHaveValue('25'))
    await user.selectOptions(ageFrom(), '30')
    first.unmount()
    renderSearch()
    await waitFor(() => expect(ageFrom()).toHaveValue('30'))
  })

  it('runs a preset from the URL at once and replaces the form', async () => {
    renderSearch(pathWith({ joined_within_days: 7 }, 'newest'))
    const results = await screen.findByRole('region', { name: 'Search results' })
    expect(await within(results).findByText(/profiles?$/)).toBeInTheDocument()
    expect(ageFrom()).toHaveValue('')
    expect(screen.getByRole('combobox', { name: 'Joined', hidden: true })).toHaveValue('7')
    expect(within(results).getByRole('combobox', { name: 'Sort' })).toHaveValue('newest')
  })
})

describe('APP-SEARCH form actions', () => {
  it('"Reset" clears every control without searching, "Use my preferences" copies them back', async () => {
    const user = userEvent.setup()
    renderSearch()
    await waitFor(() => expect(ageFrom()).toHaveValue('25'))
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(ageFrom()).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Islam', pressed: false })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Search results' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Use my preferences' }))
    expect(ageFrom()).toHaveValue('25')
  })

  it('offers married only to a female viewer, and beard for her, never hijab', async () => {
    renderSearch()
    await waitFor(() => expect(ageFrom()).toHaveValue('25'))
    expect(
      screen.getByRole('button', { name: 'Married (seeking another marriage)' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Faith/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Hijab')).toBeNull()
  })

  it('shows the count of active filters in a collapsed group heading', async () => {
    const user = userEvent.setup()
    renderSearch()
    await waitFor(() => expect(ageFrom()).toHaveValue('25'))
    const profileGroup = screen.getByRole('button', { name: /^Profile/ })
    await user.click(profileGroup)
    await user.click(screen.getByRole('switch', { name: 'With a photo only' }))
    expect(profileGroup).toHaveTextContent('1 active')
  })
})

describe('APP-SEARCH results', () => {
  it('removes a filter from its chip and searches again', async () => {
    const user = userEvent.setup()
    const { router } = renderSearch(pathWith({ age_min: 30, age_max: 31, has_photo: true }))
    const chips = await screen.findByRole('list', { name: 'Active filters' })
    expect(within(chips).getByText('Age: 30 - 31')).toBeInTheDocument()
    await user.click(within(chips).getByRole('button', { name: 'Remove filter: Age: 30 - 31' }))
    await waitFor(() =>
      expect(currentQuery(router)).toEqual({ filters: { has_photo: true }, sort: 'best_match' }),
    )
    expect(screen.getByRole('button', { name: 'Filters (1)' })).toBeInTheDocument()
  })

  it('changing the sort searches again from the first page', async () => {
    const user = userEvent.setup()
    const { router } = renderSearch(pathWith({ has_photo: true }))
    const sort = await screen.findByRole('combobox', { name: 'Sort' })
    await user.selectOptions(sort, 'recently_active')
    await waitFor(() => expect(currentQuery(router)?.sort).toBe('recently_active'))
  })

  it('shows "More than 500 profiles" when there is no estimate', async () => {
    server.use(
      http.post(apiUrl('/v1/search'), () =>
        HttpResponse.json({ items: [], next_cursor: null, total_estimate: null }),
      ),
    )
    renderSearch(pathWith({ has_photo: true }))
    expect(await screen.findByText('More than 500 profiles')).toBeInTheDocument()
  })

  it('shows the empty state with "Edit filters"', async () => {
    renderSearch(pathWith({ religion_codes: ['christianity'] }))
    expect(await screen.findByText('No profiles match these filters.')).toBeInTheDocument()
    expect(screen.getByText('Try removing a filter.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit filters' })).toBeInTheDocument()
  })

  it('shows validation_failed under the control', async () => {
    server.use(
      http.post(apiUrl('/v1/search'), () =>
        apiError(400, 'validation_failed', 'Fix', {
          fields: [{ field: 'filters.age_min', code: 'out_of_range', message: 'Range' }],
        }),
      ),
    )
    renderSearch(pathWith({ age_min: 30 }))
    expect(await screen.findByText('This value is out of range.')).toBeInTheDocument()
  })

  it('answers rate_limited with the toast of 16 section 1.3', async () => {
    server.use(
      http.post(apiUrl('/v1/search'), () =>
        apiError(429, 'rate_limited', 'Slow', { details: { retry_after_seconds: 12 } }),
      ),
    )
    renderSearch(pathWith({ has_photo: true }))
    expect(
      await screen.findByText('You are going a little fast. Please try again in 12 seconds.'),
    ).toBeInTheDocument()
  })
})

describe('APP-SEARCH saved searches', () => {
  const saved = (overrides: Partial<SavedSearch> = {}): SavedSearch => ({
    id: 'saved-1',
    name: 'Lahore doctors',
    filters: { city_ids: [1001], profession_codes: ['doctor'] },
    notify_new: false,
    created_at: '2026-11-19T10:00:00Z',
    ...overrides,
  })

  it('saves the search with a default name and the notify switch', async () => {
    const user = userEvent.setup()
    let body: unknown = null
    server.use(
      http.post(apiUrl('/v1/me/saved-searches'), async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(saved(), { status: 201 })
      }),
    )
    renderSearch(pathWith({ has_photo: true }))
    await user.click(await screen.findByRole('button', { name: 'Save this search' }))
    const dialog = await screen.findByRole('dialog')
    const name = within(dialog).getByRole('textbox', { name: 'Name' })
    expect((name as HTMLInputElement).value).toMatch(/^Search /)
    await user.clear(name)
    await user.type(name, 'With photos')
    await user.click(
      within(dialog).getByRole('switch', { name: 'Notify me about new members who match' }),
    )
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Search saved.')).toBeInTheDocument()
    expect(body).toEqual({ name: 'With photos', filters: { has_photo: true }, notify_new: true })
  })

  it('explains the limit of 10 saved searches', async () => {
    const user = userEvent.setup()
    db.savedSearches = Array.from({ length: 10 }, (_, index) =>
      saved({ id: `s${index}`, name: `S${index}` }),
    )
    renderSearch(pathWith({ has_photo: true }))
    await user.click(await screen.findByRole('button', { name: 'Save this search' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(
      await screen.findByText('You can keep up to 10 saved searches. Remove one first.'),
    ).toBeInTheDocument()
  })

  it('runs a saved search from its chip', async () => {
    const user = userEvent.setup()
    db.savedSearches = [saved()]
    const { router } = renderSearch()
    await user.click(await screen.findByRole('button', { name: 'Lahore doctors' }))
    await waitFor(() =>
      expect(currentQuery(router)).toEqual({
        filters: { city_ids: [1001], profession_codes: ['doctor'] },
        sort: 'best_match',
      }),
    )
  })

  it('renames, toggles the notification and removes after a confirmation', async () => {
    const user = userEvent.setup()
    db.savedSearches = [saved()]
    renderSearch()
    const menu = await screen.findByRole('button', { name: 'Options for Lahore doctors' })

    await user.click(menu)
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }))
    const dialog = await screen.findByRole('dialog')
    const field = within(dialog).getByRole('textbox', { name: 'Name' })
    await user.clear(field)
    await user.type(field, 'Doctors in Lahore')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('button', { name: 'Doctors in Lahore' })).toBeInTheDocument()
    expect(db.savedSearches[0]?.name).toBe('Doctors in Lahore')

    await user.click(screen.getByRole('button', { name: 'Options for Doctors in Lahore' }))
    await user.click(
      await screen.findByRole('menuitemcheckbox', { name: 'Notify me about new members' }),
    )
    await waitFor(() => expect(db.savedSearches[0]?.notify_new).toBe(true))

    await user.click(screen.getByRole('button', { name: 'Options for Doctors in Lahore' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Remove' }))
    const confirm = await screen.findByRole('alertdialog')
    expect(within(confirm).getByText('Remove this saved search?')).toBeInTheDocument()
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(db.savedSearches).toEqual([]))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Doctors in Lahore' })).toBeNull(),
    )
  })

  it('loads and runs saved_search_id', async () => {
    db.savedSearches = [saved()]
    const { router } = renderSearch('/search?saved_search_id=saved-1')
    await waitFor(() =>
      expect(currentQuery(router)?.filters).toEqual({
        city_ids: [1001],
        profession_codes: ['doctor'],
      }),
    )
    expect(await screen.findByRole('region', { name: 'Search results' })).toBeInTheDocument()
  })

  it('shows the empty form when saved_search_id no longer exists', async () => {
    const { router } = renderSearch('/search?saved_search_id=gone')
    await waitFor(() =>
      expect(
        (router.state.location.search as { saved_search_id?: string }).saved_search_id,
      ).toBeUndefined(),
    )
    expect(ageFrom()).toHaveValue('')
    expect(screen.queryByRole('region', { name: 'Search results' })).toBeNull()
  })
})

describe('APP-SEARCH profile code', () => {
  it('checks the format before asking the API', async () => {
    const user = userEvent.setup()
    renderSearch()
    await user.type(await screen.findByRole('textbox', { name: 'Profile code' }), 'KR123')
    await user.click(screen.getByRole('button', { name: 'Find' }))
    expect(await screen.findByText('A profile code looks like KR7F3K2QX9.')).toBeInTheDocument()
  })

  it('says when no profile with the code is available', async () => {
    const user = userEvent.setup()
    renderSearch()
    await user.type(await screen.findByRole('textbox', { name: 'Profile code' }), 'kr00000000')
    await user.click(screen.getByRole('button', { name: 'Find' }))
    expect(
      await screen.findByText('No profile with this code is available to you.'),
    ).toBeInTheDocument()
  })

  it('opens the profile of a code, trimmed and in capitals', async () => {
    const user = userEvent.setup()
    const member = [...db.profiles.values()].find((p) => p.relation.tier === 'member')
    const { router } = renderSearch()
    await user.type(
      await screen.findByRole('textbox', { name: 'Profile code' }),
      ` ${member?.card.public_code.toLowerCase()} `,
    )
    await user.click(screen.getByRole('button', { name: 'Find' }))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/profiles/${member?.card.id}`))
  })
})

describe('APP-SEARCH status', () => {
  it('shows the status panel for a paused profile', async () => {
    db.me.profile.status = 'paused'
    renderSearch()
    expect(await screen.findByText('The profile is paused')).toBeInTheDocument()
  })
})
