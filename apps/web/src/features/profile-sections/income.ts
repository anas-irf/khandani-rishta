import type { ReferenceBootstrap } from '~/lib/api-types'

/**
 * The income picker's currency (07 section 7.2, 05 section 10.3): chosen from the country of
 * residence, falling back to USD.
 */
const COUNTRY_CURRENCY: Record<string, string> = {
  PK: 'PKR',
  US: 'USD',
  GB: 'GBP',
  AE: 'AED',
  SA: 'SAR',
  CA: 'CAD',
  AU: 'AUD',
  QA: 'AED',
  KW: 'AED',
  OM: 'AED',
  BH: 'AED',
}

const EURO_COUNTRIES = ['DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'IE', 'AT', 'PT', 'GR', 'FI']

export function currencyForCountry(countryCode: string | null | undefined): string {
  if (!countryCode) return 'USD'
  if (EURO_COUNTRIES.includes(countryCode)) return 'EUR'
  return COUNTRY_CURRENCY[countryCode] ?? 'USD'
}

type Bands = ReferenceBootstrap['income_bands']

/** Currencies present in `income_bands`, in order of first appearance. */
export function incomeCurrencies(bands: Bands): string[] {
  return Array.from(new Set(bands.map((band) => band.currency_code)))
}

/**
 * The currency the list opens in: the saved band's currency when a band is saved (rule 5),
 * otherwise the country's currency, or USD when that currency has no bands (rule 2).
 */
export function initialIncomeCurrency(
  bands: Bands,
  countryCode: string | null | undefined,
  savedBandCode: string | null | undefined,
): string {
  const saved = bands.find((band) => band.code === savedBandCode)
  if (saved) return saved.currency_code
  const currency = currencyForCountry(countryCode)
  return bands.some((band) => band.currency_code === currency) ? currency : 'USD'
}
