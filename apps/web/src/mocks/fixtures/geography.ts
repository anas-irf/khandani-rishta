/**
 * Mock geography for `GET /v1/reference/regions` and `GET /v1/reference/cities`.
 *
 * The real tables are generated from GeoNames (specs/05-reference-data.md section 12), which
 * is far too large to ship as a fixture. This is a small hand-picked subset with the same
 * shape: Pakistan in depth, a handful of major cities for the other countries members live in.
 * Place names are plain ASCII, as the generator rule requires.
 */
import type { CityRef, Region } from '~/lib/api-types'

// ---------------------------------------------------------------------------
// Regions
// ---------------------------------------------------------------------------

/** Region ids are unique across countries, like GeoNames ids. Each country is sorted by name. */
export const regionsByCountry: Record<string, Region[]> = {
  PK: [
    { id: 1, name: 'Azad Jammu and Kashmir', name_ur: null },
    { id: 2, name: 'Balochistan', name_ur: null },
    { id: 3, name: 'Gilgit-Baltistan', name_ur: null },
    { id: 4, name: 'Islamabad Capital Territory', name_ur: null },
    { id: 5, name: 'Khyber Pakhtunkhwa', name_ur: null },
    { id: 6, name: 'Punjab', name_ur: null },
    { id: 7, name: 'Sindh', name_ur: null },
  ],
  AE: [
    { id: 8, name: 'Abu Dhabi', name_ur: null },
    { id: 9, name: 'Ajman', name_ur: null },
    { id: 10, name: 'Dubai', name_ur: null },
    { id: 11, name: 'Fujairah', name_ur: null },
    { id: 12, name: 'Ras al-Khaimah', name_ur: null },
    { id: 13, name: 'Sharjah', name_ur: null },
    { id: 14, name: 'Umm al-Quwain', name_ur: null },
  ],
  GB: [
    { id: 15, name: 'England', name_ur: null },
    { id: 16, name: 'Northern Ireland', name_ur: null },
    { id: 17, name: 'Scotland', name_ur: null },
    { id: 18, name: 'Wales', name_ur: null },
  ],
  SA: [
    { id: 19, name: 'Eastern Province', name_ur: null },
    { id: 20, name: 'Madinah', name_ur: null },
    { id: 21, name: 'Makkah', name_ur: null },
    { id: 22, name: 'Riyadh', name_ur: null },
  ],
  US: [
    { id: 23, name: 'California', name_ur: null },
    { id: 24, name: 'Florida', name_ur: null },
    { id: 25, name: 'Illinois', name_ur: null },
    { id: 26, name: 'New Jersey', name_ur: null },
    { id: 27, name: 'New York', name_ur: null },
    { id: 28, name: 'Texas', name_ur: null },
  ],
  CA: [
    { id: 29, name: 'Alberta', name_ur: null },
    { id: 30, name: 'British Columbia', name_ur: null },
    { id: 31, name: 'Ontario', name_ur: null },
    { id: 32, name: 'Quebec', name_ur: null },
  ],
  AU: [
    { id: 33, name: 'New South Wales', name_ur: null },
    { id: 34, name: 'Queensland', name_ur: null },
    { id: 35, name: 'Victoria', name_ur: null },
    { id: 36, name: 'Western Australia', name_ur: null },
  ],
}

// ---------------------------------------------------------------------------
// Cities
// ---------------------------------------------------------------------------

type CityRow = [name: string, countryCode: string, regionName: string, population: number]

/**
 * City ids are the 1-based position in this table plus 1000, so appending rows never changes
 * an existing id. Populations are rounded, plausible figures (Pakistan: 2023 census scale).
 */
const cityRows: CityRow[] = [
  // Pakistan, Punjab
  ['Lahore', 'PK', 'Punjab', 13004135],
  ['Faisalabad', 'PK', 'Punjab', 3691999],
  ['Rawalpindi', 'PK', 'Punjab', 3357612],
  ['Gujranwala', 'PK', 'Punjab', 2511118],
  ['Multan', 'PK', 'Punjab', 2206998],
  ['Sargodha', 'PK', 'Punjab', 975886],
  ['Sialkot', 'PK', 'Punjab', 893000],
  ['Bahawalpur', 'PK', 'Punjab', 808000],
  ['Gujrat', 'PK', 'Punjab', 658000],
  ['Sheikhupura', 'PK', 'Punjab', 615000],
  ['Jhang', 'PK', 'Punjab', 565000],
  ['Rahim Yar Khan', 'PK', 'Punjab', 420000],
  ['Dera Ghazi Khan', 'PK', 'Punjab', 399000],
  ['Sahiwal', 'PK', 'Punjab', 389000],
  ['Wah Cantonment', 'PK', 'Punjab', 380000],
  ['Kasur', 'PK', 'Punjab', 360000],
  ['Okara', 'PK', 'Punjab', 285000],
  ['Chiniot', 'PK', 'Punjab', 260000],
  ['Jhelum', 'PK', 'Punjab', 250000],
  ['Mandi Bahauddin', 'PK', 'Punjab', 190000],
  // Pakistan, Sindh
  ['Karachi', 'PK', 'Sindh', 20382881],
  ['Hyderabad', 'PK', 'Sindh', 1921000],
  ['Sukkur', 'PK', 'Sindh', 600000],
  ['Larkana', 'PK', 'Sindh', 550000],
  ['Nawabshah', 'PK', 'Sindh', 330000],
  ['Mirpur Khas', 'PK', 'Sindh', 280000],
  ['Shikarpur', 'PK', 'Sindh', 205000],
  ['Jacobabad', 'PK', 'Sindh', 200000],
  ['Khairpur', 'PK', 'Sindh', 190000],
  // Pakistan, Khyber Pakhtunkhwa
  ['Peshawar', 'PK', 'Khyber Pakhtunkhwa', 2360000],
  ['Mardan', 'PK', 'Khyber Pakhtunkhwa', 400000],
  ['Mingora', 'PK', 'Khyber Pakhtunkhwa', 380000],
  ['Kohat', 'PK', 'Khyber Pakhtunkhwa', 270000],
  ['Dera Ismail Khan', 'PK', 'Khyber Pakhtunkhwa', 220000],
  ['Abbottabad', 'PK', 'Khyber Pakhtunkhwa', 190000],
  ['Swabi', 'PK', 'Khyber Pakhtunkhwa', 150000],
  ['Nowshera', 'PK', 'Khyber Pakhtunkhwa', 145000],
  ['Mansehra', 'PK', 'Khyber Pakhtunkhwa', 100000],
  // Pakistan, Balochistan
  ['Quetta', 'PK', 'Balochistan', 1100000],
  ['Turbat', 'PK', 'Balochistan', 200000],
  ['Khuzdar', 'PK', 'Balochistan', 140000],
  ['Gwadar', 'PK', 'Balochistan', 90000],
  // Pakistan, Islamabad
  ['Islamabad', 'PK', 'Islamabad Capital Territory', 1100000],
  // Pakistan, Azad Jammu and Kashmir
  ['Muzaffarabad', 'PK', 'Azad Jammu and Kashmir', 150000],
  ['Mirpur', 'PK', 'Azad Jammu and Kashmir', 124000],
  ['Kotli', 'PK', 'Azad Jammu and Kashmir', 43000],
  // Pakistan, Gilgit-Baltistan
  ['Gilgit', 'PK', 'Gilgit-Baltistan', 216000],
  ['Skardu', 'PK', 'Gilgit-Baltistan', 80000],
  // United Arab Emirates
  ['Dubai', 'AE', 'Dubai', 3500000],
  ['Abu Dhabi', 'AE', 'Abu Dhabi', 1500000],
  ['Sharjah', 'AE', 'Sharjah', 1300000],
  ['Al Ain', 'AE', 'Abu Dhabi', 766000],
  ['Ajman', 'AE', 'Ajman', 504000],
  // United Kingdom
  ['London', 'GB', 'England', 8800000],
  ['Birmingham', 'GB', 'England', 1140000],
  ['Glasgow', 'GB', 'Scotland', 635000],
  ['Manchester', 'GB', 'England', 553000],
  ['Bradford', 'GB', 'England', 537000],
  // Saudi Arabia
  ['Riyadh', 'SA', 'Riyadh', 7000000],
  ['Jeddah', 'SA', 'Makkah', 4700000],
  ['Makkah', 'SA', 'Makkah', 2000000],
  ['Madinah', 'SA', 'Madinah', 1400000],
  ['Dammam', 'SA', 'Eastern Province', 1100000],
  // United States
  ['New York City', 'US', 'New York', 8300000],
  ['Los Angeles', 'US', 'California', 3900000],
  ['Chicago', 'US', 'Illinois', 2700000],
  ['Houston', 'US', 'Texas', 2300000],
  ['Dallas', 'US', 'Texas', 1300000],
  ['Miami', 'US', 'Florida', 440000],
  ['Jersey City', 'US', 'New Jersey', 292000],
  // Canada
  ['Toronto', 'CA', 'Ontario', 2800000],
  ['Montreal', 'CA', 'Quebec', 1800000],
  ['Calgary', 'CA', 'Alberta', 1300000],
  ['Mississauga', 'CA', 'Ontario', 720000],
  ['Vancouver', 'CA', 'British Columbia', 660000],
  // Australia
  ['Sydney', 'AU', 'New South Wales', 5300000],
  ['Melbourne', 'AU', 'Victoria', 5000000],
  ['Brisbane', 'AU', 'Queensland', 2500000],
  ['Perth', 'AU', 'Western Australia', 2100000],
]

/** `is_major` rule of section 12.3: 100,000 people in Pakistan, 500,000 elsewhere. */
const isMajor = (countryCode: string, population: number): boolean =>
  population >= (countryCode === 'PK' ? 100_000 : 500_000)

const regionsByKey = new Map<string, Region>()
for (const [countryCode, regions] of Object.entries(regionsByCountry)) {
  for (const region of regions) regionsByKey.set(`${countryCode}:${region.name}`, region)
}

export const cities: (CityRef & { is_major: boolean; population: number })[] = cityRows.map(
  ([name, country_code, regionName, population], index) => {
    const region = regionsByKey.get(`${country_code}:${regionName}`)
    if (!region) throw new Error(`Unknown region "${regionName}" for city "${name}"`)
    return {
      id: 1001 + index,
      name,
      region_id: region.id,
      region_name: region.name,
      country_code,
      is_major: isMajor(country_code, population),
      population,
    }
  },
)

// ---------------------------------------------------------------------------
// City search (15 section 5)
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
const MIN_QUERY_LENGTH = 2

type SearchCitiesParams = {
  country_code: string
  region_id?: number | null
  q?: string | null
  limit?: number
}

/** Major cities first, then the most populous. */
function byImportance(a: (typeof cities)[number], b: (typeof cities)[number]): number {
  if (a.is_major !== b.is_major) return a.is_major ? -1 : 1
  return b.population - a.population || a.name.localeCompare(b.name)
}

/**
 * Mirrors `GET /v1/reference/cities`.
 *
 * - `country_code` is required; `region_id` narrows to one region.
 * - `q` needs at least 2 characters (after trimming), otherwise it is ignored. Matching is
 *   case-insensitive: names that start with `q` come first, then names that contain it.
 * - Without `q`, major cities come first, then the most populous. The same order breaks ties
 *   inside each `q` group.
 * - `limit` defaults to 20 and is capped at 50.
 */
export function searchCities(params: SearchCitiesParams): CityRef[] {
  const countryCode = params.country_code.toUpperCase()
  const q = params.q?.trim().toLowerCase() ?? ''
  const hasQuery = q.length >= MIN_QUERY_LENGTH
  const requested = params.limit
  const limit =
    requested === undefined || !Number.isFinite(requested)
      ? DEFAULT_LIMIT
      : Math.min(Math.max(Math.trunc(requested), 1), MAX_LIMIT)

  const inScope = cities.filter(
    (city) =>
      city.country_code === countryCode &&
      (params.region_id == null || city.region_id === params.region_id),
  )

  let ordered: typeof cities
  if (hasQuery) {
    const prefix = inScope.filter((city) => city.name.toLowerCase().startsWith(q))
    const substring = inScope.filter((city) => {
      const name = city.name.toLowerCase()
      return !name.startsWith(q) && name.includes(q)
    })
    ordered = [...prefix.sort(byImportance), ...substring.sort(byImportance)]
  } else {
    ordered = [...inScope].sort(byImportance)
  }

  return ordered.slice(0, limit).map((city) => ({
    id: city.id,
    name: city.name,
    region_id: city.region_id,
    region_name: city.region_name,
    country_code: city.country_code,
  }))
}
