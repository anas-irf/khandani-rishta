import { describe, expect, it } from 'vitest'
import { cities, regionsByCountry, searchCities } from './geography'
import { referenceBootstrap } from './reference'

/** Every list of specs/05-reference-data.md section 2 (2.1 to 2.45), in spec order. */
const OPTION_LISTS = [
  'gender',
  'managed_by',
  'marital_status',
  'children_status',
  'complexion',
  'body_type',
  'blood_group',
  'disability',
  'residency_status',
  'relocation',
  'employment_type',
  'religiosity',
  'prayer_frequency',
  'hijab',
  'beard',
  'religious_education',
  'smoking',
  'living_arrangement',
  'work_after_marriage',
  'marriage_timeline',
  'jahez_stance',
  'parent_status',
  'family_type',
  'family_class',
  'family_values',
  'home_ownership',
  'home_type',
  'home_size_unit',
  'guardian_relation',
  'preferred_contact',
  'importance',
  'children_acceptance',
  'name_display',
  'photo_visibility',
  'field_visibility',
  'discovery_visibility',
  'interest_permission',
  'document_type',
  'closed_reason',
  'connection_stage',
  'connection_end_reason',
  'report_reason',
  'photo_rejection_reason',
  'verification_rejection_reason',
  'email_match_digest',
] as const

const CODE_PATTERN = /^[a-z][a-z0-9_]*$/

const hasDuplicates = (values: string[]): boolean => new Set(values).size !== values.length

const codesOf = (items: { code: string }[]): string[] => items.map((item) => item.code)

describe('referenceBootstrap option lists', () => {
  const { options } = referenceBootstrap

  it('has the 45 lists of spec 05 section 2 and nothing else', () => {
    expect(Object.keys(options).sort()).toEqual([...OPTION_LISTS].sort())
  })

  it.each(OPTION_LISTS)('%s is not empty and has unique, well-formed codes', (list) => {
    const items = options[list]
    expect(items.length).toBeGreaterThan(0)
    expect(hasDuplicates(codesOf(items))).toBe(false)
    for (const item of items) {
      expect(item.code).toMatch(CODE_PATTERN)
      expect(item.label.length).toBeGreaterThan(0)
      expect(item.label_ur).toBeNull()
    }
  })

  it('keeps the spec order and exact codes and labels (spot checks)', () => {
    expect(options.marital_status).toEqual([
      { code: 'never_married', label: 'Never married', label_ur: null },
      { code: 'divorced', label: 'Divorced', label_ur: null },
      { code: 'widowed', label: 'Widowed', label_ur: null },
      { code: 'separated', label: 'Separated', label_ur: null },
      { code: 'nikah_ended_before_rukhsati', label: 'Nikah ended before rukhsati', label_ur: null },
      { code: 'married', label: 'Married (seeking another marriage)', label_ur: null },
    ])
    expect(codesOf(options.gender)).toEqual(['male', 'female'])
    expect(codesOf(options.parent_status)).toEqual(['alive', 'deceased'])
    expect(codesOf(options.blood_group)).toEqual([
      'a_pos',
      'a_neg',
      'b_pos',
      'b_neg',
      'ab_pos',
      'ab_neg',
      'o_pos',
      'o_neg',
    ])
    expect(options.employment_type.find((o) => o.code === 'self_employed')?.label).toBe(
      'Self-employed or freelancer',
    )
    expect(options.report_reason.find((o) => o.code === 'asking_for_money')?.label).toBe(
      'Asking for money',
    )
    expect(codesOf(options.photo_rejection_reason)).toContain('contains_contact_info')
    expect(codesOf(options.closed_reason)).toEqual([
      'found_match_here',
      'found_match_elsewhere',
      'taking_a_break',
      'other',
    ])
  })

  it('lists the system-set connection end reasons last', () => {
    expect(codesOf(options.connection_end_reason).slice(-2)).toEqual(['blocked', 'account_closed'])
  })

  it('covers every value of the matching TypeScript unions', () => {
    expect(codesOf(options.importance)).toEqual(['must', 'high', 'medium', 'low'])
    expect(codesOf(options.document_type)).toEqual(['cnic', 'nicop', 'poc', 'passport'])
    expect(codesOf(options.connection_stage)).toEqual([
      'chatting',
      'families_talking',
      'engaged',
      'nikah_done',
    ])
  })
})

describe('referenceBootstrap religions and sects', () => {
  const { religions } = referenceBootstrap

  it('has the six religions in spec order', () => {
    expect(codesOf(religions)).toEqual([
      'islam',
      'christianity',
      'hinduism',
      'sikhism',
      'zoroastrianism',
      'other',
    ])
    expect(religions.find((r) => r.code === 'zoroastrianism')?.name).toBe('Zoroastrianism (Parsi)')
  })

  it('attaches all 14 sects to an existing religion, with unique codes', () => {
    const sectCodes = religions.flatMap((r) => codesOf(r.sects))
    // The spec has 14 sect rows: none may be left without a parent religion.
    expect(sectCodes).toHaveLength(14)
    expect(hasDuplicates(sectCodes)).toBe(false)
    expect(religions.find((r) => r.code === 'islam')?.sects).toHaveLength(11)
    expect(codesOf(religions.find((r) => r.code === 'christianity')?.sects ?? [])).toEqual([
      'catholic',
      'protestant',
      'christian_other',
    ])
  })

  it('leaves hinduism, sikhism, zoroastrianism and other without sects', () => {
    for (const code of ['hinduism', 'sikhism', 'zoroastrianism', 'other']) {
      expect(religions.find((r) => r.code === code)?.sects).toEqual([])
    }
  })
})

describe('referenceBootstrap castes', () => {
  const { castes } = referenceBootstrap
  const subCastes = castes.flatMap((c) => c.sub_castes.map((s) => ({ ...s, parent: c.code })))

  it('has 69 top-level castes with unique codes, the first 12 being the pinned entries', () => {
    expect(castes).toHaveLength(69)
    expect(hasDuplicates(codesOf(castes))).toBe(false)
    expect(codesOf(castes).slice(0, 12)).toEqual([
      'arain',
      'awan',
      'rajput',
      'jutt',
      'gujjar',
      'syed',
      'sheikh',
      'mughal',
      'malik',
      'qureshi',
      'pathan',
      'baloch',
    ])
  })

  it('has 253 sub-castes with codes unique across all parents', () => {
    expect(subCastes).toHaveLength(253)
    expect(hasDuplicates(codesOf(subCastes))).toBe(false)
    // No sub-caste code may collide with a top-level code either.
    const all = [...codesOf(castes), ...codesOf(subCastes)]
    expect(hasDuplicates(all)).toBe(false)
  })

  it('prefixes every sub-caste code with its parent code', () => {
    for (const sub of subCastes) {
      expect(sub.code.startsWith(`${sub.parent}_`)).toBe(true)
      expect(sub.code).toMatch(CODE_PATTERN)
    }
  })

  it('keeps aliases and the same clan name under several parents', () => {
    expect(castes.find((c) => c.code === 'syed')?.aliases).toEqual([
      'Sayyid',
      'Sayed',
      'Saiyid',
      'Shah',
    ])
    expect(castes.find((c) => c.code === 'awan')?.aliases).toEqual([])
    const bhatti = subCastes.filter((s) => s.name === 'Bhatti').map((s) => s.code)
    expect(bhatti).toEqual(['rajput_bhatti', 'jutt_bhatti'])
  })

  it('has the sub-castes of the combined awan, khoja and bohra table', () => {
    const subsOf = (code: string) => codesOf(castes.find((c) => c.code === code)?.sub_castes ?? [])
    expect(subsOf('awan')).toEqual(['awan_qutb_shahi'])
    expect(subsOf('khoja')).toEqual(['khoja_ismaili', 'khoja_ithna_ashari'])
    expect(subsOf('bohra')).toEqual(['bohra_dawoodi', 'bohra_sulaimani'])
    expect(subsOf('memon')).toContain('memon_sindhi')
    expect(subsOf('malik')).toEqual([])
  })
})

describe('referenceBootstrap lookup lists', () => {
  const b = referenceBootstrap

  it('has the spec row counts and unique codes', () => {
    expect(b.languages).toHaveLength(29)
    expect(b.education_levels).toHaveLength(10)
    expect(b.education_fields).toHaveLength(27)
    expect(b.profession_categories).toHaveLength(39)
    expect(b.income_bands).toHaveLength(56)
    expect(b.hobbies).toHaveLength(42)
    for (const list of [
      b.languages,
      b.education_levels,
      b.education_fields,
      b.profession_categories,
      b.income_bands,
      b.hobbies,
      b.countries,
    ]) {
      expect(hasDuplicates(codesOf(list))).toBe(false)
    }
  })

  it('has education level ranks that never decrease, with the two deliberate ties', () => {
    const ranks = b.education_levels.map((l) => l.rank)
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i]).toBeGreaterThanOrEqual(ranks[i - 1])
    }
    const rankOf = (code: string) => b.education_levels.find((l) => l.code === code)?.rank
    expect(rankOf('below_matric')).toBe(1)
    expect(rankOf('bachelors')).toBe(5)
    expect(rankOf('dars_e_nizami')).toBe(5)
    expect(rankOf('professional')).toBe(6)
    expect(rankOf('masters')).toBe(6)
    expect(rankOf('mphil')).toBe(7)
    expect(rankOf('doctorate')).toBe(8)
  })

  it('has seven ranked bands for each of the eight currencies', () => {
    const currencies = ['PKR', 'USD', 'GBP', 'EUR', 'AED', 'SAR', 'CAD', 'AUD']
    for (const currency of currencies) {
      const bands = b.income_bands.filter((band) => band.currency_code === currency)
      expect(bands.map((band) => band.rank)).toEqual([1, 2, 3, 4, 5, 6, 7])
      expect(codesOf(bands)).toEqual(
        [1, 2, 3, 4, 5, 6, 7].map((rank) => `${currency.toLowerCase()}_${rank}`),
      )
    }
    expect(b.income_bands.find((band) => band.code === 'pkr_3')).toEqual({
      code: 'pkr_3',
      currency_code: 'PKR',
      label: '100,000 to 150,000',
      label_ur: null,
      rank: 3,
    })
    expect(b.income_bands.find((band) => band.code === 'usd_7')?.label).toBe('Above 15,000')
  })

  it('groups hobbies into the nine categories of the spec', () => {
    const categories = new Set(b.hobbies.map((h) => h.category))
    expect([...categories].sort()).toEqual([
      'arts',
      'faith',
      'food',
      'home',
      'learning',
      'outdoors',
      'social',
      'sports',
      'technology',
    ])
    expect(b.hobbies.find((h) => h.code === 'quran_recitation')).toEqual({
      code: 'quran_recitation',
      name: 'Quran recitation',
      name_ur: null,
      category: 'faith',
    })
  })

  it('has languages and professions with exact codes', () => {
    expect(b.languages[0]).toEqual({ code: 'urdu', name: 'Urdu', name_ur: null })
    expect(b.languages.at(-1)?.code).toBe('other')
    expect(b.profession_categories.find((p) => p.code === 'software_it')?.name).toBe(
      'Software and IT',
    )
    expect(b.education_fields.find((f) => f.code === 'computer_science_it')?.name).toBe(
      'Computer science and IT',
    )
  })

  it('has countries with dial codes and the priority countries first', () => {
    expect(b.countries.slice(0, 3).map((c) => c.code)).toEqual(['PK', 'SA', 'AE'])
    expect(b.countries.find((c) => c.code === 'PK')).toEqual({
      code: 'PK',
      name: 'Pakistan',
      name_ur: null,
      dial_code: '+92',
    })
    for (const country of b.countries) {
      expect(country.code).toMatch(/^[A-Z]{2}$/)
      expect(country.dial_code).toMatch(/^\+\d+$/)
    }
  })

  it('carries the mock version', () => {
    expect(b.version).toBe('mock-2026-11-20')
  })
})

describe('geography data', () => {
  it('has Pakistan regions with unique integer ids starting at 1', () => {
    const pk = regionsByCountry.PK
    expect(pk.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(pk.map((r) => r.name)).toContain('Punjab')
    const allIds = Object.values(regionsByCountry).flatMap((regions) => regions.map((r) => r.id))
    expect(new Set(allIds).size).toBe(allIds.length)
  })

  it('has 40 to 80 cities whose regions exist in the matching country', () => {
    expect(cities.length).toBeGreaterThanOrEqual(40)
    expect(cities.length).toBeLessThanOrEqual(80)
    expect(new Set(cities.map((c) => c.id)).size).toBe(cities.length)
    for (const city of cities) {
      const region = regionsByCountry[city.country_code]?.find((r) => r.id === city.region_id)
      expect(region?.name).toBe(city.region_name)
    }
  })

  it('flags major cities by the 100,000 (Pakistan) and 500,000 (elsewhere) rule', () => {
    for (const city of cities) {
      const threshold = city.country_code === 'PK' ? 100_000 : 500_000
      expect(city.is_major).toBe(city.population >= threshold)
    }
    const major = (name: string) => cities.find((c) => c.name === name)?.is_major
    expect(major('Karachi')).toBe(true)
    expect(major('Kotli')).toBe(false)
    expect(major('Ajman')).toBe(true)
  })
})

describe('searchCities', () => {
  const regionId = (country: string, name: string): number => {
    const region = regionsByCountry[country].find((r) => r.name === name)
    if (!region) throw new Error(`No region ${name}`)
    return region.id
  }

  it('returns only cities of the requested country', () => {
    for (const country of ['PK', 'AE', 'GB', 'SA', 'US', 'CA']) {
      const result = searchCities({ country_code: country, limit: 50 })
      expect(result.length).toBeGreaterThanOrEqual(3)
      expect(result.every((c) => c.country_code === country)).toBe(true)
    }
    expect(searchCities({ country_code: 'ZZ' })).toEqual([])
  })

  it('accepts a lowercase country code', () => {
    expect(searchCities({ country_code: 'pk', limit: 1 })[0].country_code).toBe('PK')
  })

  it('narrows to a region', () => {
    const kp = regionId('PK', 'Khyber Pakhtunkhwa')
    const result = searchCities({ country_code: 'PK', region_id: kp, limit: 50 })
    expect(result.map((c) => c.name)).toContain('Peshawar')
    expect(result.map((c) => c.name)).not.toContain('Lahore')
    expect(result.every((c) => c.region_id === kp)).toBe(true)
    // A null region id means no region filter.
    expect(searchCities({ country_code: 'PK', region_id: null, limit: 50 }).length).toBeGreaterThan(
      result.length,
    )
  })

  it('without q lists major cities first, then by population', () => {
    const result = searchCities({ country_code: 'PK', limit: 50 })
    expect(result.slice(0, 3).map((c) => c.name)).toEqual(['Karachi', 'Lahore', 'Faisalabad'])
    const byId = new Map(cities.map((c) => [c.id, c]))
    const flags = result.map((c) => byId.get(c.id)?.is_major)
    const firstMinor = flags.indexOf(false)
    expect(firstMinor).toBeGreaterThan(0)
    expect(flags.slice(firstMinor).every((f) => f === false)).toBe(true)
    const populations = result.slice(0, firstMinor).map((c) => byId.get(c.id)?.population ?? 0)
    expect(populations).toEqual([...populations].sort((a, b) => b - a))
  })

  it('matches q as a case-insensitive prefix first, then as a substring', () => {
    const result = searchCities({ country_code: 'PK', q: 'RA', limit: 50 })
    const names = result.map((c) => c.name.toLowerCase())
    expect(names.length).toBeGreaterThan(2)
    const firstSubstring = names.findIndex((n) => !n.startsWith('ra'))
    expect(firstSubstring).toBeGreaterThan(0)
    expect(names.slice(0, firstSubstring).every((n) => n.startsWith('ra'))).toBe(true)
    expect(names.slice(firstSubstring).every((n) => n.includes('ra') && !n.startsWith('ra'))).toBe(
      true,
    )
    expect(names).toContain('rawalpindi')
    expect(names).toContain('karachi')
  })

  it('finds a city by prefix and combines q with the region filter', () => {
    expect(searchCities({ country_code: 'PK', q: 'lah' }).map((c) => c.name)).toEqual(['Lahore'])
    const sindh = regionId('PK', 'Sindh')
    const inSindh = searchCities({ country_code: 'PK', region_id: sindh, q: 'mir' })
    expect(inSindh.map((c) => c.name)).toEqual(['Mirpur Khas'])
    const anywhere = searchCities({ country_code: 'PK', q: 'mir' }).map((c) => c.name)
    expect(anywhere).toEqual(['Mirpur Khas', 'Mirpur'])
  })

  it('ignores q shorter than 2 characters and trims it', () => {
    const all = searchCities({ country_code: 'PK' })
    expect(searchCities({ country_code: 'PK', q: 'l' })).toEqual(all)
    expect(searchCities({ country_code: 'PK', q: ' ' })).toEqual(all)
    expect(searchCities({ country_code: 'PK', q: null })).toEqual(all)
    expect(searchCities({ country_code: 'PK', q: '  lah  ' }).map((c) => c.name)).toEqual([
      'Lahore',
    ])
  })

  it('returns an empty list when q matches nothing', () => {
    expect(searchCities({ country_code: 'PK', q: 'zzzz' })).toEqual([])
  })

  it('applies the default limit of 20 and a custom limit', () => {
    expect(searchCities({ country_code: 'PK' })).toHaveLength(20)
    expect(searchCities({ country_code: 'PK', limit: 5 })).toHaveLength(5)
    expect(searchCities({ country_code: 'PK', limit: 1 })).toHaveLength(1)
  })

  it('caps the limit at 50 and floors it at 1', () => {
    const pkCount = cities.filter((c) => c.country_code === 'PK').length
    const capped = searchCities({ country_code: 'PK', limit: 1000 })
    expect(capped.length).toBe(Math.min(pkCount, 50))
    expect(searchCities({ country_code: 'PK', limit: 0 })).toHaveLength(1)
    expect(searchCities({ country_code: 'PK', limit: Number.NaN })).toHaveLength(20)
  })

  it('returns objects with exactly the CityRef keys', () => {
    const [first] = searchCities({ country_code: 'PK', limit: 1 })
    expect(Object.keys(first).sort()).toEqual([
      'country_code',
      'id',
      'name',
      'region_id',
      'region_name',
    ])
    expect(first).toEqual({
      id: first.id,
      name: 'Karachi',
      region_id: regionId('PK', 'Sindh'),
      region_name: 'Sindh',
      country_code: 'PK',
    })
  })
})
