import { queryOptions, skipToken, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { apiRequestRaw, http } from './api'
import { isOneOf } from './api-enums'
import type { ReferenceBootstrap } from './api-types'
import { qk, STALE } from './query'

/**
 * Reference data (17 section 8.4, 15 section 5). The bootstrap is cached in localStorage with
 * its version and revalidated with `If-None-Match` at every app start.
 */

const STORAGE_KEY = 'kr.reference.bootstrap'

type CachedBootstrap = { etag: string; data: ReferenceBootstrap }

function readCache(): CachedBootstrap | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as CachedBootstrap
    return parsed?.data?.version ? parsed : undefined
  } catch {
    return undefined
  }
}

function writeCache(value: CachedBootstrap) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Storage full or unavailable: the in-memory cache still works.
  }
}

export async function fetchReferenceBootstrap(signal?: AbortSignal): Promise<ReferenceBootstrap> {
  const cached = readCache()
  const { data, response } = await apiRequestRaw('get', '/v1/reference/bootstrap', {
    headers: cached ? { 'If-None-Match': cached.etag } : undefined,
    signal,
  })
  if (response.status === 304 && cached) return cached.data
  const etag = response.headers.get('etag') ?? `"${data.version}"`
  writeCache({ etag, data })
  return data
}

export function referenceQueryOptions() {
  return queryOptions({
    queryKey: qk.referenceBootstrap(),
    queryFn: ({ signal }) => fetchReferenceBootstrap(signal),
    staleTime: STALE.reference,
    initialData: () => readCache()?.data,
    // The disk copy is shown at once and revalidated immediately.
    initialDataUpdatedAt: 0,
  })
}

/** Loads the bootstrap for AuthGate, which waits for it before rendering any screen. */
export function useReferenceQuery(options: { enabled?: boolean } = {}) {
  return useQuery({ ...referenceQueryOptions(), enabled: options.enabled ?? true })
}

/** The bootstrap object. Suspends until it is loaded; AuthGate loads it before any screen. */
export function useReference(): ReferenceBootstrap {
  return useSuspenseQuery(referenceQueryOptions()).data
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** Lookup tables of the bootstrap that are not closed option lists. */
export type LookupTable =
  | 'religions'
  | 'sects'
  | 'castes'
  | 'sub_castes'
  | 'languages'
  | 'education_levels'
  | 'education_fields'
  | 'profession_categories'
  | 'income_bands'
  | 'hobbies'
  | 'countries'

export type Option<T extends string = string> = { code: T; label: string }

/**
 * The options whose code is one of `codes` (a contract enumeration), typed with them. A code
 * the contract does not know could not be sent, so it is not offered.
 */
export function optionsIn<T extends string>(
  options: readonly Option[],
  codes: readonly T[],
): Option<T>[] {
  return options.filter((option): option is Option<T> => isOneOf(codes, option.code))
}

type Labelled = { code: string; label?: string; label_ur?: string | null }
type Named = { code: string; name?: string; name_ur?: string | null }

function localized(item: Labelled & Named, language: string): string {
  if (language === 'ur') {
    const ur = item.label_ur ?? item.name_ur
    if (ur) return ur
  }
  return item.label ?? item.name ?? item.code
}

/** How an unknown code is shown, so a newer API value never breaks an older client. */
export function fallbackLabel(code: string): string {
  return code.replaceAll('_', ' ')
}

function tableItems(reference: ReferenceBootstrap, table: LookupTable): (Labelled & Named)[] {
  switch (table) {
    case 'sects':
      return reference.religions.flatMap((religion) => religion.sects)
    case 'sub_castes':
      return reference.castes.flatMap((caste) => caste.sub_castes)
    default:
      return reference[table] as (Labelled & Named)[]
  }
}

function isLookupTable(list: string): list is LookupTable {
  return [
    'religions',
    'sects',
    'castes',
    'sub_castes',
    'languages',
    'education_levels',
    'education_fields',
    'profession_categories',
    'income_bands',
    'hobbies',
    'countries',
  ].includes(list)
}

/** Items of an option list (`marital_status`) or a lookup table (`languages`). */
export function itemsOf(reference: ReferenceBootstrap, list: string): (Labelled & Named)[] {
  if (isLookupTable(list)) return tableItems(reference, list)
  return reference.options[list] ?? []
}

/**
 * Display label for a stored code. Unknown codes render as the code with underscores
 * replaced by spaces (17 section 8.4).
 */
export function labelOf(
  reference: ReferenceBootstrap,
  list: string,
  code: string | null | undefined,
  language = 'en',
): string {
  if (!code) return ''
  const item = itemsOf(reference, list).find((entry) => entry.code === code)
  return item ? localized(item, language) : fallbackLabel(code)
}

export function optionsOf(reference: ReferenceBootstrap, list: string, language = 'en'): Option[] {
  return itemsOf(reference, list).map((item) => ({
    code: item.code,
    label: localized(item, language),
  }))
}

/** `{ code, label }[]` for a closed list or lookup table, in the current language. */
export function useOptions(list: string): Option[] {
  const reference = useReference()
  const { i18n } = useTranslation()
  return useMemo(() => optionsOf(reference, list, i18n.language), [reference, list, i18n.language])
}

/** A function that labels codes in the current language: `label('marital_status', code)`. */
export function useLabelOf(): (list: string, code: string | null | undefined) => string {
  const reference = useReference()
  const { i18n } = useTranslation()
  return useCallback(
    (list: string, code: string | null | undefined) =>
      labelOf(reference, list, code, i18n.language),
    [reference, i18n.language],
  )
}

/** Castes with their sub-castes and aliases (for the caste picker, 07 section 5.2). */
export function useCastes() {
  return useReference().castes
}

/**
 * Sects of a religion; empty when the religion has none.
 * @public listed in 17 section 8.4
 */
export function useSects(religionCode: string | null | undefined): Option[] {
  const reference = useReference()
  const { i18n } = useTranslation()
  return useMemo(() => {
    const religion = reference.religions.find((entry) => entry.code === religionCode)
    return (religion?.sects ?? []).map((sect) => ({
      code: sect.code,
      label: localized(sect, i18n.language),
    }))
  }, [reference, religionCode, i18n.language])
}

/**
 * Income bands of a currency, in rank order (07 section 7.2).
 * @public listed in 17 section 8.4
 */
export function useIncomeBands(currencyCode: string | null | undefined) {
  const reference = useReference()
  return useMemo(
    () =>
      reference.income_bands
        .filter((band) => band.currency_code === currencyCode)
        .sort((a, b) => a.rank - b.rank),
    [reference, currencyCode],
  )
}

// ---------------------------------------------------------------------------
// Geography
// ---------------------------------------------------------------------------

export function useRegions(countryCode: string | null | undefined) {
  return useQuery({
    queryKey: qk.regions(countryCode ?? ''),
    // Without a country there is nothing to ask for: `country_code` is required.
    queryFn: countryCode
      ? ({ signal }) =>
          http.get('/v1/reference/regions', { query: { country_code: countryCode }, signal })
      : skipToken,
    select: (data) => data.items,
    staleTime: STALE.reference,
  })
}

export type CitySearchParams = {
  country_code: string
  region_id?: number | null
  /** At least 2 characters, otherwise major cities are returned. */
  q?: string
}

export function useCitySearch(params: CitySearchParams | null) {
  const query = params?.q && params.q.trim().length >= 2 ? params.q.trim() : undefined
  const key = params
    ? { country_code: params.country_code, region_id: params.region_id ?? null, q: query }
    : null
  const countryCode = key?.country_code
  return useQuery({
    queryKey: qk.cities(key ?? { country_code: '' }),
    // Without a country there is nothing to ask for: `country_code` is required.
    queryFn: countryCode
      ? ({ signal }) =>
          http.get('/v1/reference/cities', {
            query: {
              country_code: countryCode,
              region_id: key?.region_id ?? undefined,
              q: key?.q,
              limit: 20,
            },
            signal,
          })
      : skipToken,
    select: (data) => data.items,
    staleTime: STALE.cities,
    placeholderData: (previous) => previous,
  })
}
