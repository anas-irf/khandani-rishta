import { useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { type ReactNode, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RemovableChip } from '~/components/common/Chip'
import { Disclosure } from '~/components/common/Disclosure'
import { FieldError } from '~/components/common/fields/field-shell'
import { OptionSearch, type SearchOption } from '~/components/common/fields/option-search'
import { SwitchRow } from '~/components/common/SwitchRow'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select'
import { Toggle } from '~/components/ui/toggle'
import type { CityRef, OwnProfile } from '~/lib/api-types'
import { qk } from '~/lib/query'
import { type Option, useCitySearch, useLabelOf, useRegions } from '~/lib/reference'
import type { NumberOption } from './filter-options'

/**
 * Controls of the search form (16 section 6.6). They are plain controlled inputs: the form is a
 * query builder kept in memory, not a record saved to the API, so it does not use TanStack Form.
 * Every control has a visible label; chips are toggle buttons with `aria-pressed`.
 */

const legendClass = 'mb-2 max-w-full text-label-lg'
/**
 * A collapsible group with its count of active filters in the heading. Its controls stay
 * mounted while it is closed, and a refused value inside opens it.
 */
export function FilterGroup({
  title,
  count,
  defaultOpen,
  hasError,
  children,
}: {
  title: string
  count: number
  defaultOpen: boolean
  hasError?: boolean
  children: ReactNode
}) {
  const { t } = useTranslation('discovery')
  return (
    <Disclosure
      as="h2"
      title={title}
      note={count > 0 ? t('search.group_count', { count }) : undefined}
      defaultOpen={defaultOpen}
      forceOpen={hasError}
      keepMounted
      className="border-b border-border"
    >
      {children}
    </Disclosure>
  )
}

/** Several choices from a short list, as toggle chips. */
export function ChipsField<T extends string>({
  label,
  options,
  value,
  onChange,
  error,
}: {
  label: string
  options: readonly Option<T>[]
  value: readonly T[] | null | undefined
  onChange: (next: T[]) => void
  error?: string
}) {
  const errorId = useId()
  const selected = value ?? []
  const toggle = (code: T) =>
    onChange(
      selected.includes(code) ? selected.filter((item) => item !== code) : [...selected, code],
    )
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={error ? errorId : undefined}>
      <legend className={legendClass}>{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const pressed = selected.includes(option.code)
          return (
            <Toggle key={option.code} pressed={pressed} onPressedChange={() => toggle(option.code)}>
              {option.label}
            </Toggle>
          )
        })}
      </div>
      <FieldError id={errorId} message={error} />
    </fieldset>
  )
}

/** Chosen values as removable chips. */
function SelectedChips({
  label,
  items,
  onRemove,
}: {
  label: string
  items: { key: string; label: string }[]
  onRemove: (key: string) => void
}) {
  const { t } = useTranslation('discovery')
  if (items.length === 0) return null
  return (
    <ul aria-label={t('search.selected', { label })} className="flex flex-wrap gap-2">
      {items.map((item) => (
        <li key={item.key} className="max-w-full">
          <RemovableChip
            removeLabel={t('search.remove_value', { value: item.label })}
            onRemove={() => onRemove(item.key)}
          >
            {item.label}
          </RemovableChip>
        </li>
      ))}
    </ul>
  )
}

/** Several choices from a long list (caste, language, country, profession), added by search. */
export function SearchMultiField({
  label,
  options,
  value,
  onChange,
  error,
}: {
  label: string
  options: readonly SearchOption[]
  value: readonly string[] | null | undefined
  onChange: (next: string[]) => void
  error?: string
}) {
  const { t } = useTranslation('discovery')
  const [open, setOpen] = useState(false)
  const listId = useId()
  const errorId = useId()
  const selected = value ?? []
  const labelOf = (code: string) =>
    options.find((option) => option.code === code)?.label ?? code.replaceAll('_', ' ')

  return (
    <fieldset aria-describedby={error ? errorId : undefined} className="flex flex-col gap-2">
      <legend className={legendClass}>{label}</legend>
      <SelectedChips
        label={label}
        items={selected.map((code) => ({ key: code, label: labelOf(code) }))}
        onRemove={(code) => onChange(selected.filter((item) => item !== code))}
      />
      <OptionSearch
        label={label}
        options={[...options]}
        selected={[...selected]}
        excluded={[...selected]}
        onSelect={(code) => onChange([...selected, code])}
        open={open}
        onOpenChange={setOpen}
        listId={listId}
        closeOnSelect={false}
        searchPlaceholder={t('search.add_named', { label })}
        trigger={
          <Button
            type="button"
            variant="secondary"
            className="self-start"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={listId}
            aria-label={t('search.add_named', { label })}
          >
            <Plus aria-hidden="true" />
            {t('search.add')}
          </Button>
        }
      />
      <FieldError id={errorId} message={error} />
    </fieldset>
  )
}

/** One choice from a list, first entry "Any" (sends nothing). */
export function SelectField<T extends string | number>({
  label,
  options,
  value,
  onChange,
  anyLabel,
  error,
}: {
  label: string
  options: readonly { value: T; label: string }[]
  value: T | null | undefined
  onChange: (next: T | undefined) => void
  anyLabel: string
  error?: string
}) {
  const id = useId()
  const errorId = useId()
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect
        id={id}
        value={value == null ? '' : String(value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => {
          const raw = event.target.value
          if (raw === '') return onChange(undefined)
          const match = options.find((option) => String(option.value) === raw)
          onChange(match?.value)
        }}
      >
        <NativeSelectOption value="">{anyLabel}</NativeSelectOption>
        {options.map((option) => (
          <NativeSelectOption key={String(option.value)} value={String(option.value)}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <FieldError id={errorId} message={error} />
    </div>
  )
}

/** A range as two selects, "From" and "To" (17 section 8.2: selects, not a slider). */
export function RangeField({
  label,
  options,
  min,
  max,
  onChange,
  error,
}: {
  label: string
  options: readonly NumberOption[]
  min: number | null | undefined
  max: number | null | undefined
  onChange: (next: { min: number | undefined; max: number | undefined }) => void
  error?: string
}) {
  const { t } = useTranslation('discovery')
  const fromId = useId()
  const toId = useId()
  const errorId = useId()
  const parse = (raw: string) => (raw === '' ? undefined : Number(raw))
  const current = { min: min ?? undefined, max: max ?? undefined }
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={error ? errorId : undefined}>
      <legend className={legendClass}>{label}</legend>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,6.5rem),1fr))] gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor={fromId} variant="part">
            {t('search.from')}
          </Label>
          <NativeSelect
            id={fromId}
            aria-label={t('search.range_from', { label })}
            value={min == null ? '' : String(min)}
            aria-invalid={error ? true : undefined}
            onChange={(event) => onChange({ ...current, min: parse(event.target.value) })}
          >
            <NativeSelectOption value="">{t('search.any')}</NativeSelectOption>
            {options.map((option) => (
              <NativeSelectOption key={option.value} value={String(option.value)}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={toId} variant="part">
            {t('search.to')}
          </Label>
          <NativeSelect
            id={toId}
            aria-label={t('search.range_to', { label })}
            value={max == null ? '' : String(max)}
            aria-invalid={error ? true : undefined}
            onChange={(event) => onChange({ ...current, max: parse(event.target.value) })}
          >
            <NativeSelectOption value="">{t('search.any')}</NativeSelectOption>
            {options.map((option) => (
              <NativeSelectOption key={option.value} value={String(option.value)}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>
      <FieldError id={errorId} message={error} />
    </fieldset>
  )
}

export function SwitchField({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return <SwitchRow label={label} checked={checked} onCheckedChange={onChange} />
}

/** "Province or state": regions of the chosen countries, as chips (one list per country). */
export function RegionsField({
  label,
  countries,
  value,
  onChange,
}: {
  label: string
  countries: readonly string[]
  value: readonly number[] | null | undefined
  onChange: (next: number[]) => void
}) {
  if (countries.length === 0) return null
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className={legendClass}>{label}</legend>
      {countries.map((country) => (
        <CountryRegions key={country} country={country} value={value ?? []} onChange={onChange} />
      ))}
    </fieldset>
  )
}

function CountryRegions({
  country,
  value,
  onChange,
}: {
  country: string
  value: readonly number[]
  onChange: (next: number[]) => void
}) {
  const regions = useRegions(country)
  if (!regions.data?.length) return null
  return (
    <div className="flex flex-wrap gap-2">
      {regions.data.map((region) => {
        const pressed = value.includes(region.id)
        return (
          <Toggle
            key={region.id}
            pressed={pressed}
            onPressedChange={() =>
              onChange(pressed ? value.filter((id) => id !== region.id) : [...value, region.id])
            }
          >
            {region.name}
          </Toggle>
        )
      })}
    </div>
  )
}

/** City names seen in this session (search results and the own city), by id. */
const cityNames = new Map<number, string>()

export function rememberCity(city: Pick<CityRef, 'id' | 'name'>) {
  cityNames.set(city.id, city.name)
}

/** The name of a city seen in this session, or undefined. */
export function knownCityName(id: number): string | undefined {
  return cityNames.get(id)
}

/** "City": a search against `GET /v1/reference/cities`, chosen cities as chips. */
export function CityField({
  label,
  countries,
  fallbackCountry,
  value,
  onChange,
}: {
  label: string
  /** The chosen countries; the search runs in one of them. */
  countries: readonly string[]
  /** The viewer's own country when none is chosen. */
  fallbackCountry: string
  value: readonly number[] | null | undefined
  onChange: (next: number[]) => void
}) {
  const { t } = useTranslation('discovery')
  const labelOf = useLabelOf()
  const queryClient = useQueryClient()
  const inputId = useId()
  const countryId = useId()
  const choices = countries.length > 0 ? countries : [fallbackCountry]
  const [country, setCountry] = useState(choices[0] ?? 'PK')
  const activeCountry = choices.includes(country) ? country : (choices[0] ?? 'PK')
  const [query, setQuery] = useState('')
  const search = useCitySearch(
    query.trim().length >= 2 ? { country_code: activeCountry, q: query } : null,
  )
  const selected = value ?? []

  const own = queryClient.getQueryData<OwnProfile>(qk.ownProfile())?.location.city
  if (own) rememberCity(own)
  for (const city of search.data ?? []) rememberCity(city)

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className={legendClass}>{label}</legend>
      <SelectedChips
        label={label}
        items={selected.map((id) => ({
          key: String(id),
          label: cityNames.get(id) ?? t('search.city_unknown'),
        }))}
        onRemove={(key) => onChange(selected.filter((id) => String(id) !== key))}
      />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-3">
        {choices.length > 1 ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor={countryId} variant="part">
              {t('search.city_country')}
            </Label>
            <NativeSelect
              id={countryId}
              value={activeCountry}
              onChange={(event) => setCountry(event.target.value)}
            >
              {choices.map((code) => (
                <NativeSelectOption key={code} value={code}>
                  {labelOf('countries', code)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        ) : null}
        <div className="flex flex-col gap-1">
          <Label htmlFor={inputId} variant="part">
            {t('search.city_search')}
          </Label>
          <Input
            id={inputId}
            type="search"
            value={query}
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>
      {query.trim().length >= 2 ? (
        <ul className="flex flex-wrap gap-2" aria-live="polite">
          {(search.data ?? [])
            .filter((city) => !selected.includes(city.id))
            .map((city) => (
              <li key={city.id}>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    onChange([...selected, city.id])
                    setQuery('')
                  }}
                >
                  <Plus aria-hidden="true" />
                  {city.region_name ? `${city.name}, ${city.region_name}` : city.name}
                </Button>
              </li>
            ))}
          {search.data && search.data.length === 0 ? (
            <li className="text-caption text-muted-foreground">{t('search.no_results')}</li>
          ) : null}
        </ul>
      ) : (
        <p className="text-caption text-muted-foreground">{t('search.city_search_hint')}</p>
      )}
    </fieldset>
  )
}
