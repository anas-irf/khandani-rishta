import { z } from 'zod'
import type { Gender, Preferences, SearchBody, SearchFilters, SearchSort } from '~/lib/api-types'

/**
 * Pure helpers of `APP-SEARCH` (16 section 6.6, 17 section 3.3): the `SearchFilters` schema, the
 * bookmarkable `q` parameter (URL-safe base64 JSON of `{ filters, sort }`), the copy from the
 * partner preferences and the profile code rule.
 */

export const SEARCH_SORTS = [
  'best_match',
  'newest',
  'recently_active',
] as const satisfies readonly SearchSort[]

export const DEFAULT_SORT: SearchSort = 'best_match'

export type SearchState = { filters: SearchFilters; sort: SearchSort }

const codes = z.array(z.string().min(1)).max(50)
const ids = z.array(z.number().int()).max(50)

/** The keys of `SearchFilters` (15 section 4.8). Unknown keys are dropped, never sent. */
export const searchFiltersSchema = z
  .object({
    public_code: z.string().optional(),
    age_min: z.number().int().min(18).max(80).optional(),
    age_max: z.number().int().min(18).max(80).optional(),
    height_min_cm: z.number().int().min(122).max(213).optional(),
    height_max_cm: z.number().int().min(122).max(213).optional(),
    marital_statuses: codes.optional(),
    children_acceptance: z.enum(['any', 'not_living_with_partner', 'none']).optional(),
    religion_codes: codes.optional(),
    sect_codes: codes.optional(),
    caste_codes: codes.optional(),
    mother_tongue_codes: codes.optional(),
    country_codes: codes.optional(),
    region_ids: ids.optional(),
    city_ids: ids.optional(),
    education_min_rank: z.number().int().min(1).optional(),
    employment_types: codes.optional(),
    profession_codes: codes.optional(),
    income_min_rank: z.number().int().min(1).optional(),
    religiosity_levels: codes.optional(),
    hijab_types: codes.optional(),
    beard_types: codes.optional(),
    family_values: codes.optional(),
    family_types: codes.optional(),
    living_arrangements: codes.optional(),
    work_after_marriage_options: codes.optional(),
    smoking_options: codes.optional(),
    managed_by: codes.optional(),
    has_photo: z.boolean().optional(),
    verified_only: z.boolean().optional(),
    active_within_days: z.union([z.literal(1), z.literal(7), z.literal(30)]).optional(),
    joined_within_days: z.union([z.literal(7), z.literal(30)]).optional(),
  })
  .refine(
    (filters) =>
      filters.age_min === undefined ||
      filters.age_max === undefined ||
      filters.age_min <= filters.age_max,
    { path: ['age_min'], message: 'out_of_range' },
  )

const searchStateSchema = z.object({
  filters: searchFiltersSchema,
  sort: z.enum(SEARCH_SORTS).catch(DEFAULT_SORT),
})

/**
 * Drops every key that sends nothing (16 section 6.6: "an untouched control sends nothing"):
 * undefined, null, empty strings and arrays, switches that are off, and "Any" choices.
 */
export function cleanFilters(filters: SearchFilters): SearchFilters {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value) && value.length === 0) continue
    if (value === false) continue
    if (key === 'children_acceptance' && value === 'any') continue
    out[key] = value
  }
  return out as SearchFilters
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** `{ filters, sort }` as the URL-safe base64 JSON of the `q` parameter (17 section 3.3). */
export function encodeSearchQuery(state: SearchState): string {
  return toBase64Url(JSON.stringify({ filters: cleanFilters(state.filters), sort: state.sort }))
}

/**
 * Reads the `q` parameter back. Returns null when it is not valid base64, not JSON or does not
 * fit `SearchFilters` (a hand-edited or outdated bookmark), so the screen falls back to its form.
 */
export function decodeSearchQuery(q: string | undefined | null): SearchState | null {
  if (!q) return null
  try {
    const parsed = searchStateSchema.safeParse(JSON.parse(fromBase64Url(q)))
    if (!parsed.success) return null
    return { filters: cleanFilters(parsed.data.filters as SearchFilters), sort: parsed.data.sort }
  } catch {
    return null
  }
}

/**
 * "Use my preferences" (16 section 6.6): copies the values of `Preferences` into the filter keys
 * with the same names (15 section 4.8). Importance values and `notes` are ignored. The full age
 * range and "Children are fine" are the untouched states, so they send nothing. Hijab applies to
 * a male viewer and beard to a female viewer.
 */
export function filtersFromPreferences(
  preferences: Preferences,
  viewerGender: Gender | null,
): SearchFilters {
  const fullAgeRange = preferences.age_min <= 18 && preferences.age_max >= 80
  return cleanFilters({
    age_min: fullAgeRange ? undefined : preferences.age_min,
    age_max: fullAgeRange ? undefined : preferences.age_max,
    height_min_cm: preferences.height_min_cm ?? undefined,
    height_max_cm: preferences.height_max_cm ?? undefined,
    marital_statuses: preferences.marital_statuses,
    children_acceptance: preferences.children_acceptance,
    religion_codes: preferences.religion_codes,
    sect_codes: preferences.sect_codes,
    caste_codes: preferences.caste_codes,
    mother_tongue_codes: preferences.mother_tongue_codes,
    country_codes: preferences.country_codes,
    region_ids: preferences.region_ids,
    city_ids: preferences.city_ids,
    education_min_rank: preferences.education_min_rank ?? undefined,
    employment_types: preferences.employment_types,
    profession_codes: preferences.profession_codes,
    income_min_rank: preferences.income_min_rank ?? undefined,
    religiosity_levels: preferences.religiosity_levels,
    hijab_types: viewerGender === 'male' ? preferences.hijab_types : undefined,
    beard_types: viewerGender === 'female' ? preferences.beard_types : undefined,
    family_values: preferences.family_values,
    family_types: preferences.family_types,
    living_arrangements: preferences.living_arrangements,
    work_after_marriage_options: preferences.work_after_marriage_options,
    smoking_options: preferences.smoking_options,
  })
}

/**
 * The search body of 16 section 6.6: `{ filters, sort, limit: 20 }` plus the cursor of a further
 * page. Only set keys are sent.
 */
export function searchBody(state: SearchState, cursor?: string): SearchBody {
  return {
    filters: cleanFilters(state.filters),
    sort: state.sort,
    limit: 20,
    ...(cursor ? { cursor } : {}),
  }
}

/** Filter keys grouped by the control that sets them, for counts and chips. */
export const FILTER_CONTROLS: readonly (readonly (keyof SearchFilters)[])[] = [
  ['age_min', 'age_max'],
  ['height_min_cm', 'height_max_cm'],
  ['marital_statuses'],
  ['children_acceptance'],
  ['religion_codes'],
  ['sect_codes'],
  ['caste_codes'],
  ['mother_tongue_codes'],
  ['country_codes'],
  ['region_ids'],
  ['city_ids'],
  ['education_min_rank'],
  ['employment_types'],
  ['profession_codes'],
  ['income_min_rank'],
  ['religiosity_levels'],
  ['hijab_types'],
  ['beard_types'],
  ['family_values'],
  ['family_types'],
  ['living_arrangements'],
  ['work_after_marriage_options'],
  ['smoking_options'],
  ['managed_by'],
  ['has_photo'],
  ['verified_only'],
  ['active_within_days'],
  ['joined_within_days'],
]

/** The controls that have a value: one entry per control (age is one filter, not two). */
export function activeFilterControls(filters: SearchFilters): (keyof SearchFilters)[][] {
  const clean = cleanFilters(filters)
  return FILTER_CONTROLS.filter((keys) => keys.some((key) => key in clean)).map((keys) => [...keys])
}

/** The number of active filters, shown on the "Filters" button (16 section 6.6). */
export function countActiveFilters(filters: SearchFilters): number {
  return activeFilterControls(filters).length
}

/** Removes one control's keys (the close control of a summary chip). */
export function withoutFilter(
  filters: SearchFilters,
  keys: readonly (keyof SearchFilters)[],
): SearchFilters {
  const next = { ...filters }
  for (const key of keys) delete next[key]
  return cleanFilters(next)
}

// ---------------------------------------------------------------------------
// Profile code (16 section 6.6)
// ---------------------------------------------------------------------------

/** `KR` and 8 Crockford base32 characters (04 section 5). */
export const PROFILE_CODE_PATTERN = /^KR[0-9A-HJKMNP-TV-Z]{8}$/

/** Trimmed and in capitals, as the "Find" control sends it. Inner spaces are removed too. */
export function normalizeProfileCode(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase()
}

export function isProfileCode(input: string): boolean {
  return PROFILE_CODE_PATTERN.test(normalizeProfileCode(input))
}
