// Generates apps/api/migrations/0012_seed_geography.sql (countries, regions and cities) from the
// public GeoNames dumps. The rules are in specs/05-reference-data.md section 12.3.
//
//   node scripts/build-geo-seed.mjs
//
// Run it by hand when the geography needs refreshing, never in CI and never at runtime. The
// generated SQL file is committed. Node standard library only: the two zip files are read with
// a small unzip helper built on node:zlib.
//
// 1. Downloads the four input files into scripts/.geo-cache/ (git-ignored). Cached files younger
//    than 7 days are reused.
// 2. Builds countries, regions and cities in memory.
// 3. Writes the migration file.
// 4. Prints the three row counts.
//
// Place names from GeoNames (geonames.org), licensed under CC BY 4.0.

import { existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, inflateRawSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = join(root, 'scripts', '.geo-cache')
const outFile = join(root, 'apps', 'api', 'migrations', '0012_seed_geography.sql')

const BASE_URL = 'https://download.geonames.org/export/dump/'
const ATTRIBUTION = 'Place names from GeoNames (geonames.org), licensed under CC BY 4.0.'
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const BATCH_SIZE = 500
const MAX_FILE_BYTES = 8 * 1024 * 1024

// Pakistani places below this population are dropped. Raised to the second value when the
// generated file would exceed MAX_FILE_BYTES (05 section 12.4).
const PK_POPULATION_THRESHOLDS = [1000, 2000]

const INPUTS = {
  countryInfo: 'countryInfo.txt',
  admin1: 'admin1CodesASCII.txt',
  pakistan: 'PK.zip',
  world: 'cities15000.zip',
}

// Pickers order countries by sort_order, then name. Every other country gets 1000.
const COUNTRY_SORT_ORDER = {
  PK: 10, // Pakistan
  SA: 20, // Saudi Arabia
  AE: 30, // United Arab Emirates
  GB: 40, // United Kingdom
  US: 50, // United States
  CA: 60, // Canada
  AU: 70, // Australia
  QA: 80, // Qatar
  KW: 90, // Kuwait
  OM: 100, // Oman
  BH: 110, // Bahrain
  DE: 120, // Germany
  IT: 130, // Italy
  MY: 140, // Malaysia
}
const DEFAULT_COUNTRY_SORT_ORDER = 1000

// Populated places, without sections of cities (PPLX), abandoned and historical places.
const CITY_FEATURE_CODES = new Set([
  'PPL',
  'PPLA',
  'PPLA2',
  'PPLA3',
  'PPLA4',
  'PPLC',
  'PPLG',
  'PPLL',
  'PPLS',
])

// ---- download and unzip -------------------------------------------------------------------

async function ensureCached(fileName) {
  const path = join(cacheDir, fileName)
  if (existsSync(path) && Date.now() - statSync(path).mtimeMs < CACHE_MAX_AGE_MS) {
    console.log(`cached      ${fileName}`)
    return path
  }
  const url = `${BASE_URL}${fileName}`
  console.log(`downloading ${url}`)
  const response = await fetch(url, { signal: AbortSignal.timeout(300_000) })
  if (!response.ok) {
    throw new Error(`Download of ${url} failed: HTTP ${response.status}`)
  }
  const body = Buffer.from(await response.arrayBuffer())
  // Write next to the target and rename, so an interrupted run never leaves a partial file.
  const partial = `${path}.part`
  writeFileSync(partial, body)
  renameSync(partial, path)
  console.log(`            ${(body.length / 1024).toFixed(0)} KiB`)
  return path
}

// Returns the bytes of one entry of a zip archive. Handles stored and deflated entries, which is
// all the GeoNames archives use. Zip64 archives are not supported (the files are far below 4 GiB).
function readZipEntry(zip, entryName) {
  const eocdSignature = 0x06054b50
  const centralSignature = 0x02014b50
  const localSignature = 0x04034b50

  // The end-of-central-directory record is in the last 64 KiB plus 22 bytes.
  let eocd = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === eocdSignature) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Not a zip file: end of central directory not found')

  const entryCount = zip.readUInt16LE(eocd + 10)
  let offset = zip.readUInt32LE(eocd + 16)

  for (let n = 0; n < entryCount; n++) {
    if (zip.readUInt32LE(offset) !== centralSignature) {
      throw new Error('Corrupt zip file: bad central directory entry')
    }
    const method = zip.readUInt16LE(offset + 10)
    const expectedCrc = zip.readUInt32LE(offset + 16)
    const compressedSize = zip.readUInt32LE(offset + 20)
    const size = zip.readUInt32LE(offset + 24)
    const nameLength = zip.readUInt16LE(offset + 28)
    const extraLength = zip.readUInt16LE(offset + 30)
    const commentLength = zip.readUInt16LE(offset + 32)
    const localOffset = zip.readUInt32LE(offset + 42)
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength)
    offset += 46 + nameLength + extraLength + commentLength

    if (name !== entryName) continue

    if (compressedSize === 0xffffffff || size === 0xffffffff) {
      throw new Error('Zip64 archives are not supported')
    }
    if (zip.readUInt32LE(localOffset) !== localSignature) {
      throw new Error('Corrupt zip file: bad local header')
    }
    const dataStart =
      localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28)
    const compressed = zip.subarray(dataStart, dataStart + compressedSize)

    let data
    if (method === 0) data = compressed
    else if (method === 8) data = inflateRawSync(compressed)
    else throw new Error(`Unsupported zip compression method ${method} for ${name}`)

    if (data.length !== size) throw new Error(`Size mismatch for ${name} in the zip file`)
    if (crc32(data) !== expectedCrc) throw new Error(`CRC mismatch for ${name} in the zip file`)
    return data
  }
  throw new Error(`${entryName} not found in the zip file`)
}

async function readTextLines(path, zipEntry) {
  let bytes = await readFile(path)
  if (zipEntry) bytes = readZipEntry(bytes, zipEntry)
  return bytes
    .toString('utf8')
    .split(/\r?\n/)
    .filter((line) => line !== '')
}

// ---- build ---------------------------------------------------------------------------------

function buildCountries(lines) {
  const countries = []
  for (const line of lines) {
    if (line.startsWith('#')) continue
    const cols = line.split('\t')
    const code = cols[0]
    if (!/^[A-Z]{2}$/.test(code ?? '')) continue
    // Phone: keep the part before the first space, remove hyphens, prefix "+".
    // "92" becomes "+92"; "1-809 and 1-829" becomes "+1809". Empty stays NULL.
    const phone = (cols[12] ?? '').trim().split(' ')[0].replaceAll('-', '').replace(/^\+/, '')
    countries.push({
      code,
      name: cols[4],
      dialCode: phone === '' ? null : `+${phone}`,
      sortOrder: COUNTRY_SORT_ORDER[code] ?? DEFAULT_COUNTRY_SORT_ORDER,
    })
  }
  return countries
}

function buildRegions(lines, countryCodes) {
  const regions = []
  const idByAdminCode = new Map() // "PK.04" -> geonameid
  const namesSeen = new Set() // "PK|Punjab"
  for (const line of lines) {
    if (line.startsWith('#')) continue
    const cols = line.split('\t')
    const adminCode = cols[0]
    const countryCode = adminCode.split('.')[0]
    if (!countryCodes.has(countryCode)) continue
    const id = Number.parseInt(cols[3], 10)
    let name = cols[2]
    // UNIQUE (country_code, name): the second region with a name gets its admin code appended.
    if (namesSeen.has(`${countryCode}|${name}`)) {
      name = `${name} (${adminCode.slice(countryCode.length + 1)})`
      if (namesSeen.has(`${countryCode}|${name}`)) {
        throw new Error(`Region name still not unique after adding the admin code: ${name}`)
      }
    }
    namesSeen.add(`${countryCode}|${name}`)
    idByAdminCode.set(adminCode, id)
    regions.push({ id, countryCode, name })
  }
  regions.sort((a, b) => a.id - b.id)
  return { regions, idByAdminCode }
}

// Parses one line of the standard 19-column GeoNames table into a city candidate, or returns
// null when the line is not a kept kind of populated place.
function parseCity(line, idByAdminCode, countryCodes) {
  const cols = line.split('\t')
  const featureClass = cols[6]
  const featureCode = cols[7]
  if (featureClass !== 'P' || !CITY_FEATURE_CODES.has(featureCode)) return null
  const countryCode = cols[8]
  if (!countryCodes.has(countryCode)) return null
  const name = cols[2]
  if (name === '') return null
  return {
    id: Number.parseInt(cols[0], 10),
    name,
    latitude: cols[4],
    longitude: cols[5],
    countryCode,
    regionId: idByAdminCode.get(`${countryCode}.${cols[10]}`) ?? null,
    population: Number.parseInt(cols[14] || '0', 10),
  }
}

function buildCities(pakistanLines, worldLines, idByAdminCode, countryCodes, pkThreshold) {
  // Deduplicate on (country_code, region_id, name), keeping the larger population. A tie keeps
  // the lower id, so the result does not depend on the order of the input files.
  const best = new Map()
  const consider = (city) => {
    const key = `${city.countryCode}|${city.regionId ?? ''}|${city.name}`
    const current = best.get(key)
    const wins =
      !current ||
      city.population > current.population ||
      (city.population === current.population && city.id < current.id)
    if (wins) best.set(key, city)
  }

  for (const line of pakistanLines) {
    const city = parseCity(line, idByAdminCode, countryCodes)
    if (city && city.population >= pkThreshold) consider(city)
  }
  for (const line of worldLines) {
    const city = parseCity(line, idByAdminCode, countryCodes)
    // The world file is already limited to places of 15,000 people or more.
    if (city && city.countryCode !== 'PK') consider(city)
  }

  const cities = [...best.values()]
  for (const city of cities) {
    const majorThreshold = city.countryCode === 'PK' ? 100_000 : 500_000
    city.isMajor = city.population >= majorThreshold
  }
  cities.sort((a, b) => a.id - b.id)
  return cities
}

// ---- SQL output ------------------------------------------------------------------------------

const quote = (value) => (value === null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`)

function numberOrNull(text) {
  const trimmed = (text ?? '').trim()
  if (trimmed === '' || !Number.isFinite(Number(trimmed))) return 'NULL'
  return trimmed
}

function batches(table, columns, rows) {
  const out = []
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE)
    const values = chunk.map((row) => `    (${row})`).join(',\n')
    out.push(`INSERT INTO ${table} (${columns}) VALUES\n${values}\nON CONFLICT DO NOTHING;\n`)
  }
  return out
}

function renderSql({ countries, regions, cities, pkThreshold }) {
  const header = [
    '-- 0012_seed_geography.sql',
    '-- Generated by scripts/build-geo-seed.mjs. Do not edit by hand: refresh the geography with a new',
    '-- migration file (specs/05-reference-data.md section 13).',
    '--',
    `-- Generated on ${new Date().toISOString().slice(0, 10)} from the GeoNames dumps at ${BASE_URL}`,
    `-- ${ATTRIBUTION}`,
    '--',
    `-- countries: ${countries.length}`,
    `-- regions:   ${regions.length}`,
    `-- cities:    ${cities.length} (Pakistani places of ${pkThreshold} people or more, and every other`,
    '--            country from cities15000)',
    '',
  ].join('\n')

  const countryRows = countries.map(
    (c) => `${quote(c.code)}, ${quote(c.name)}, NULL, ${quote(c.dialCode)}, ${c.sortOrder}, true`,
  )
  const regionRows = regions.map((r) => `${r.id}, ${quote(r.countryCode)}, ${quote(r.name)}`)
  const cityRows = cities.map((c) => {
    const place = [c.id, quote(c.countryCode), c.regionId ?? 'NULL', quote(c.name)]
    const where = [numberOrNull(c.latitude), numberOrNull(c.longitude), c.population, c.isMajor]
    return [...place, ...where].join(', ')
  })

  return [
    header,
    ...batches('countries', 'code, name, name_ur, dial_code, sort_order, is_active', countryRows),
    ...batches('regions', 'id, country_code, name', regionRows),
    ...batches(
      'cities',
      'id, country_code, region_id, name, latitude, longitude, population, is_major',
      cityRows,
    ),
    "SELECT setval(pg_get_serial_sequence('regions', 'id'), (SELECT max(id) FROM regions));",
    "SELECT setval(pg_get_serial_sequence('cities', 'id'), (SELECT max(id) FROM cities));",
    '',
  ].join('\n')
}

// ---- main --------------------------------------------------------------------------------------

mkdirSync(cacheDir, { recursive: true })
const paths = {}
for (const [key, fileName] of Object.entries(INPUTS)) {
  paths[key] = await ensureCached(fileName)
}

const countries = buildCountries(await readTextLines(paths.countryInfo))
const countryCodes = new Set(countries.map((c) => c.code))
const { regions, idByAdminCode } = buildRegions(await readTextLines(paths.admin1), countryCodes)
const pakistanLines = await readTextLines(paths.pakistan, 'PK.txt')
const worldLines = await readTextLines(paths.world, 'cities15000.txt')

let sql = ''
let cities = []
let pkThreshold = PK_POPULATION_THRESHOLDS[0]
for (const threshold of PK_POPULATION_THRESHOLDS) {
  pkThreshold = threshold
  cities = buildCities(pakistanLines, worldLines, idByAdminCode, countryCodes, threshold)
  sql = renderSql({ countries, regions, cities, pkThreshold })
  const bytes = Buffer.byteLength(sql)
  if (bytes <= MAX_FILE_BYTES) break
  console.log(`Output is ${bytes} bytes (over 8 MB) with a Pakistani threshold of ${threshold}.`)
}

if (Buffer.byteLength(sql) > MAX_FILE_BYTES) {
  console.warn('Warning: the output is still over 8 MB with the highest Pakistani threshold.')
}
writeFileSync(outFile, sql)
console.log(`Wrote ${outFile} (${(Buffer.byteLength(sql) / 1024 / 1024).toFixed(2)} MiB)`)
console.log(`Pakistani population threshold: ${pkThreshold}`)
console.log(`countries: ${countries.length}`)
console.log(`regions:   ${regions.length}`)
console.log(`cities:    ${cities.length}`)
