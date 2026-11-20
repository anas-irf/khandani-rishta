import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Plus, X } from 'lucide-react'
import { type ReactNode, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { OptionSearch, type SearchOption } from '~/components/common/fields/option-search'
import { Button } from '~/components/ui/button'
import { Label } from '~/components/ui/label'
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select'
import { Switch } from '~/components/ui/switch'
import type { CityRef, OwnProfile } from '~/lib/api-types'
import { qk } from '~/lib/query'
import { type Option, useCitySearch, useLabelOf, useRegions } from '~/lib/reference'
import { cn } from '~/lib/utils'
import type { NumberOption } from './filter-options'

/**
 * Controls of the search form (16 section 6.6). They are plain controlled inputs: the form is a
 * query builder kept in memory, not a record saved to the API, so it does not use TanStack Form.
 * Every control has a visible label; chips are toggle buttons with `aria-pressed`.
 */

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} className="text-sm text-danger" data-field-error="">
      {message}
    </p>
  )
}

/** A collapsible group with its count of active filters in the heading. */
export function FilterGroup({
  title,
  count,
  defaultOpen,
  children,
}: {
  title: string
  count: number
  defaultOpen: boolean
  children: ReactNode
}) {
  const { t } = useTranslation('discovery')
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()
  return (
    <section className="border-b border-border last:border-b-0">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className="flex min-h-12 w-full items-center justify-between gap-2 py-2 text-start font-semibold"
        >
          <span>
            {title}
            {count > 0 ? (
              <span className="ms-2 text-sm font-normal text-muted-foreground">
                {t('search.group_count', { count })}
              </span>
            ) : null}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn('size-5 shrink-0 transition-transform', open && 'rotate-180')}
          />
        </button>
      </h3>
      <div id={panelId} hidden={!open} className="flex flex-col gap-5 pb-5">
        {children}
      </div>
    </section>
  )
}

/** Several choices from a short list, as toggle chips. */
export function ChipsField({
  label,
  options,
  value,
  onChange,
  error,
}: {
  label: string
  options: readonly Option[]
  value: readonly string[] | undefined
  onChange: (next: string[]) => void
  error?: string
}) {
  const errorId = useId()
  const selected = value ?? []
  const toggle = (code: string) =>
    onChange(
      selected.includes(code) ? selected.filter((item) => item !== code) : [...selected, code],
    )
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={error ? errorId : undefined}>
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const pressed = selected.includes(option.code)
          return (
            <button
              key={option.code}
              type="button"
              aria-pressed={pressed}
              onClick={() => toggle(option.code)}
              className={cn(
                'inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                pressed
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input bg-surface text-foreground hover:bg-muted',
              )}
            >
              {option.label}
            </button>
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
        <li
          key={item.key}
          className="inline-flex min-h-11 items-center rounded-full border border-border bg-primary-soft ps-3 text-sm font-medium"
        >
          <span dir="auto">{item.label}</span>
          <button
            type="button"
            onClick={() => onRemove(item.key)}
            aria-label={t('search.remove_value', { value: item.label })}
            className="inline-flex size-11 items-center justify-center rounded-full hover:bg-primary-soft/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
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
  value: readonly string[] | undefined
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
      <legend className="mb-2 text-sm font-medium">{label}</legend>
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
            variant="outline"
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
  value: T | undefined
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
        value={value === undefined ? '' : String(value)}
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
  min: number | undefined
  max: number | undefined
  onChange: (next: { min: number | undefined; max: number | undefined }) => void
  error?: string
}) {
  const { t } = useTranslation('discovery')
  const fromId = useId()
  const toId = useId()
  const errorId = useId()
  const parse = (raw: string) => (raw === '' ? undefined : Number(raw))
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={error ? errorId : undefined}>
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor={fromId} className="text-sm text-muted-foreground">
            {t('search.from')}
          </Label>
          <NativeSelect
            id={fromId}
            aria-label={t('search.range_from', { label })}
            value={min === undefined ? '' : String(min)}
            aria-invalid={error ? true : undefined}
            onChange={(event) => onChange({ min: parse(event.target.value), max })}
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
          <Label htmlFor={toId} className="text-sm text-muted-foreground">
            {t('search.to')}
          </Label>
          <NativeSelect
            id={toId}
            aria-label={t('search.range_to', { label })}
            value={max === undefined ? '' : String(max)}
            aria-invalid={error ? true : undefined}
            onChange={(event) => onChange({ min, max: parse(event.target.value) })}
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
  const id = useId()
  return (
    <div className="flex min-h-11 items-center justify-between gap-3">
      <Label htmlFor={id} className="text-base font-normal">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={(next) => onChange(next === true)} />
    </div>
  )
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
  value: readonly number[] | undefined
  onChange: (next: number[]) => void
}) {
  if (countries.length === 0) return null
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">{label}</legend>
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
          <button
            key={region.id}
            type="button"
            aria-pressed={pressed}
            onClick={() =>
              onChange(pressed ? value.filter((id) => id !== region.id) : [...value, region.id])
            }
            className={cn(
              'inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              pressed
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input bg-surface text-foreground hover:bg-muted',
            )}
          >
            {region.name}
          </button>
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
  value: readonly number[] | undefined
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
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <SelectedChips
        label={label}
        items={selected.map((id) => ({
          key: String(id),
          label: cityNames.get(id) ?? t('search.city_unknown'),
        }))}
        onRemove={(key) => onChange(selected.filter((id) => String(id) !== key))}
      />
      <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {choices.length > 1 ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor={countryId} className="text-sm text-muted-foreground">
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
        <div className={cn('flex flex-col gap-1', choices.length <= 1 && 'sm:col-span-2')}>
          <Label htmlFor={inputId} className="text-sm text-muted-foreground">
            {t('search.city_search')}
          </Label>
          <input
            id={inputId}
            type="search"
            value={query}
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            className="h-11 w-full rounded-[var(--radius-input)] border border-input bg-surface px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                  variant="outline"
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
            <li className="text-sm text-muted-foreground">{t('search.no_results')}</li>
          ) : null}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t('search.city_search_hint')}</p>
      )}
    </fieldset>
  )
}
