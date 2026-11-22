import { useQueries } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RemovableChip } from '~/components/common/Chip'
import { FieldShell, subId, useFieldDisabled } from '~/components/common/fields/field-shell'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select'
import { http } from '~/lib/api'
import type { CityRef } from '~/lib/api-types'
import { useFieldControl } from '~/lib/form-context'
import { qk, STALE } from '~/lib/query'
import { type Option, useCitySearch, useOptions } from '~/lib/reference'

/**
 * The location row's "Provinces or states" and "Cities" controls (07 section 11.2). Regions
 * come from `GET /v1/reference/regions` for each selected country; cities are searched with
 * `GET /v1/reference/cities`.
 */

/** Regions of several countries, each loaded (and cached) like `useRegions`. */
export function useRegionOptions(countryCodes: string[]): Option[] {
  const { i18n } = useTranslation()
  const results = useQueries({
    queries: countryCodes.map((country) => ({
      queryKey: qk.regions(country),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        http.get('/v1/reference/regions', {
          query: { country_code: country },
          signal,
        }),
      staleTime: STALE.reference,
    })),
  })
  return results.flatMap((result) =>
    (result.data?.items ?? []).map((region) => ({
      code: String(region.id),
      label: i18n.language === 'ur' && region.name_ur ? region.name_ur : region.name,
    })),
  )
}

/** City names seen in this session: the API has no lookup by id. */
const cityNames = new Map<number, string>()

function useCityNames(countryCodes: string[]) {
  // The major cities of each selected country name most saved choices.
  const results = useQueries({
    queries: countryCodes.map((country) => ({
      queryKey: qk.cities({ country_code: country, region_id: null, q: undefined }),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        http.get('/v1/reference/cities', {
          query: { country_code: country, limit: 50 },
          signal,
        }),
      staleTime: STALE.cities,
    })),
  })
  for (const result of results) {
    for (const city of result.data?.items ?? []) cityNames.set(city.id, city.name)
  }
  return (id: number) => cityNames.get(id) ?? String(id)
}

/** Several cities as chips, added by searching. Value `number[]`. */
export function CityIdsField({
  label,
  countryCodes,
  max = 20,
}: {
  label: string
  /** The selected countries; the search runs in one of them (all countries when none). */
  countryCodes: string[]
  max?: number
}) {
  const { t } = useTranslation(['preferences', 'fields'])
  const control = useFieldControl<number[]>()
  const isDisabled = useFieldDisabled(control)
  const countries = useOptions('countries')
  const value = control.value ?? []
  const nameOf = useCityNames(countryCodes)
  const searchCountries = useMemo(
    () =>
      countryCodes.length > 0
        ? countries.filter((country) => countryCodes.includes(country.code))
        : countries,
    [countries, countryCodes],
  )
  const [country, setCountry] = useState<string | null>(null)
  const activeCountry =
    country && searchCountries.some((entry) => entry.code === country)
      ? country
      : (searchCountries[0]?.code ?? 'PK')
  const [query, setQuery] = useState('')
  const search = useCitySearch(
    query.trim().length >= 2 ? { country_code: activeCountry, q: query } : null,
  )
  const results = (search.data ?? []).filter((city) => !value.includes(city.id))
  const searchId = useId()
  const countryId = useId()
  const reached = value.length >= max

  const add = (city: CityRef) => {
    cityNames.set(city.id, city.name)
    if (!reached) control.setValue([...value, city.id])
    setQuery('')
  }

  return (
    <FieldShell control={control} label={label} kind="fieldset">
      {value.length > 0 ? (
        <ul
          aria-label={t('fields:multi_select.selected_label', { label })}
          className="flex flex-wrap gap-2"
        >
          {value.map((id) => (
            <li key={id} className="max-w-full">
              <RemovableChip
                removeLabel={t('fields:multi_select.remove', { item: nameOf(id) })}
                disabled={isDisabled}
                onRemove={() => control.setValue(value.filter((entry) => entry !== id))}
              >
                {nameOf(id)}
              </RemovableChip>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body-sm text-muted-foreground">{t('preferences:any')}</p>
      )}
      {searchCountries.length > 1 ? (
        <div className="grid gap-2">
          <Label htmlFor={countryId}>{t('preferences:cities_country')}</Label>
          <NativeSelect
            id={countryId}
            value={activeCountry}
            disabled={isDisabled}
            onChange={(event) => setCountry(event.target.value)}
          >
            {searchCountries.map((entry) => (
              <NativeSelectOption key={entry.code} value={entry.code}>
                {entry.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      ) : null}
      <div className="grid gap-2">
        <Label htmlFor={searchId}>{t('preferences:cities_search')}</Label>
        <Input
          id={searchId}
          name={control.name}
          type="search"
          dir="auto"
          autoComplete="off"
          value={query}
          disabled={isDisabled || reached}
          placeholder={t('fields:city.city_placeholder')}
          aria-describedby={reached ? subId(control, 'max') : undefined}
          onChange={(event) => setQuery(event.target.value)}
        />
        {reached ? (
          <p id={subId(control, 'max')} className="text-caption text-muted-foreground">
            {t('fields:multi_select.max_reached', { max })}
          </p>
        ) : null}
      </div>
      {query.trim().length >= 2 ? (
        <ul aria-label={t('fields:city.results_label')} className="flex flex-col gap-1">
          {results.map((city) => (
            <li key={city.id}>
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-start rounded-row px-3 text-start"
                disabled={isDisabled || reached}
                onClick={() => add(city)}
              >
                <Plus aria-hidden="true" />
                <span className="flex min-w-0 flex-col">
                  <span dir="auto">{city.name}</span>
                  {city.region_name ? (
                    <span className="text-body-sm font-normal text-muted-foreground">
                      {city.region_name}
                    </span>
                  ) : null}
                </span>
              </Button>
            </li>
          ))}
          {search.isSuccess && results.length === 0 ? (
            <li role="status" className="px-3 text-body-sm text-muted-foreground">
              {t('fields:city.no_results')}
            </li>
          ) : null}
        </ul>
      ) : null}
    </FieldShell>
  )
}
