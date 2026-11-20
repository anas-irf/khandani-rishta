import type { ReferenceBootstrap } from '~/lib/api-types'
import { feetInchesToCm } from '~/lib/format'
import { i18n } from '~/lib/i18n'

/** Option lists of the search form that are derived rather than read from the bootstrap. */

export type NumberOption = { value: number; label: string }

/** 18 to 80 (16 section 6.6). */
export function ageOptions(): NumberOption[] {
  return Array.from({ length: 63 }, (_, index) => ({
    value: 18 + index,
    label: String(18 + index),
  }))
}

/** 4 ft 0 in to 7 ft 0 in, one entry per inch, valued in centimetres (07 section 4.3). */
export function heightOptions(): NumberOption[] {
  const options: NumberOption[] = []
  for (let total = 48; total <= 84; total += 1) {
    const feet = Math.floor(total / 12)
    const inches = total % 12
    options.push({
      value: feetInchesToCm(feet, inches),
      label: i18n.t('common:format.height_short', { feet, inches }),
    })
  }
  return options
}

/**
 * "Education, at least": one entry per distinct `rank` of `education_levels`, labelled with the
 * first level of that rank (05 section 7): "Bachelor's (BA, BSc, BS, BE, BBA) or higher".
 */
export function educationRankOptions(
  reference: ReferenceBootstrap,
  language = i18n.language,
): NumberOption[] {
  const seen = new Map<number, string>()
  for (const level of reference.education_levels) {
    if (seen.has(level.rank)) continue
    const name = language === 'ur' && level.name_ur ? level.name_ur : level.name
    seen.set(level.rank, name)
  }
  return [...seen.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rank, name]) => ({
      value: rank,
      label: i18n.t('discovery:search.education_option', { name }),
    }))
}

/** The lower bound of a band label: "50,000 to 100,000" and "Above 1,000,000" give the number. */
function lowerBound(label: string): string | null {
  if (/^\s*below\b/i.test(label)) return null
  const match = /[\d][\d,.]*/.exec(label)
  return match ? match[0] : null
}

/**
 * "Monthly income, at least": the PKR `income_bands` by `rank`, labelled as in 05 section 10.3
 * ("At least 100,000 PKR a month or the equivalent abroad").
 */
export function incomeRankOptions(reference: ReferenceBootstrap): NumberOption[] {
  return reference.income_bands
    .filter((band) => band.currency_code === 'PKR')
    .sort((a, b) => a.rank - b.rank)
    .map((band) => ({ value: band.rank, label: incomeMinLabel(band.label) }))
}

/** The "at least" label of one PKR band. */
export function incomeMinLabel(bandLabel: string): string {
  const amount = lowerBound(bandLabel)
  return amount
    ? i18n.t('discovery:search.income_option', { amount })
    : i18n.t('discovery:search.income_option_lowest', { label: bandLabel })
}

/** The PKR band label for a rank, as "at least" text (looking-for lines, 16 section 6.7). */
export function incomeRankLabel(reference: ReferenceBootstrap, rank: number): string | null {
  const band = reference.income_bands.find(
    (item) => item.currency_code === 'PKR' && item.rank === rank,
  )
  return band ? incomeMinLabel(band.label) : null
}
