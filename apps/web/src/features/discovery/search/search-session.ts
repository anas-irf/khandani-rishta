import type { SearchFilters, SearchSort } from '~/lib/api-types'
import { createStore } from '~/lib/store'
import { DEFAULT_SORT } from '../search-params'

/**
 * The search form's filters and sort for the rest of the session, in memory only
 * (16 section 6.6, "Initial state"). `initialized` turns true once the form was filled for the
 * first time (from the preferences, a preset or a saved search), so the copy from the partner
 * preferences happens only on the first open. Kept per profile, so another member signing in
 * on the same tab starts fresh.
 */
export type SearchSession = {
  profileId: string | null
  initialized: boolean
  filters: SearchFilters
  sort: SearchSort
}

const EMPTY: SearchSession = {
  profileId: null,
  initialized: false,
  filters: {},
  sort: DEFAULT_SORT,
}

export const searchSessionStore = createStore<SearchSession>(EMPTY)

/** The session for this profile; a different profile starts from an empty, uninitialised form. */
export function sessionFor(profileId: string): SearchSession {
  const current = searchSessionStore.get()
  if (current.profileId === profileId) return current
  const fresh = { ...EMPTY, profileId }
  searchSessionStore.set(fresh)
  return fresh
}

export function saveSession(profileId: string, next: Omit<SearchSession, 'profileId'>) {
  searchSessionStore.set({ ...next, profileId })
}

/** Test helper: forget the session. */
export function resetSearchSession() {
  searchSessionStore.set(EMPTY)
}
