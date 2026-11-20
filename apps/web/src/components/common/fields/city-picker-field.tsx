import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select'
import type { CityRef, LocationSection } from '~/lib/api-types'
import { useFieldControl } from '~/lib/form-context'
import { useCitySearch, useOptions, useRegions } from '~/lib/reference'
import { cn } from '~/lib/utils'
import { ariaFor, type BaseFieldProps, FieldShell, subId, useFieldDisabled } from './field-shell'
import { SearchSelectControl } from './search-select-field'

/**
 * Where a member lives (07 section 6): country, province or state, then a city searched with
 * `GET /v1/reference/cities`, or a typed city name after "My city is not listed".
 *
 * `city_other` is null while a listed city is used, and a string (possibly empty) once "My
 * city is not listed" was chosen, so a schema can tell "nothing chosen" from "name missing".
 * `cityValueToSection` turns an empty name into null.
 */
export type CityValue = {
  country_code: string | null
  region_id: number | null
  city_id: number | null
  city_other: string | null
  /** The chosen city, for display. Not sent. */
  city: CityRef | null
}

export const EMPTY_CITY_VALUE: CityValue = {
  country_code: null,
  region_id: null,
  city_id: null,
  city_other: null,
  city: null,
}

/** Debounce of the city search (07 section 6.1: 300 ms; `q` is sent from 2 characters). */
export const CITY_SEARCH_DEBOUNCE_MS = 300
const MIN_QUERY_LENGTH = 2

type LocationLike = Partial<
  Pick<LocationSection, 'country_code' | 'region_id' | 'city_id' | 'city_other'>
> & { city?: CityRef | null }

/** The field value from a saved location section (`OwnProfile.location`). */
export function cityValueFromSection(
  location: LocationLike | null | undefined,
  defaultCountry: string | null = 'PK',
): CityValue {
  return {
    country_code: location?.country_code ?? defaultCountry,
    region_id: location?.region_id ?? location?.city?.region_id ?? null,
    city_id: location?.city_id ?? null,
    city_other: location?.city_id ? null : (location?.city_other ?? null),
    city: location?.city ?? null,
  }
}

/** The four section fields to send: `country_code`, `region_id`, `city_id`, `city_other`. */
export function cityValueToSection(value: CityValue | null | undefined) {
  const other = value?.city_other?.trim()
  return {
    country_code: value?.country_code ?? null,
    region_id: value?.region_id ?? null,
    city_id: value?.city_id ?? null,
    city_other: value?.city_id == null && other ? other : null,
  }
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export type CityPickerFieldProps = BaseFieldProps & {
  countryLabel?: string
  regionLabel?: string
  cityLabel?: string
  cityOtherLabel?: string
  /** Hides the legend visually (the sub-controls have their own labels). */
  legendHidden?: boolean
  /** Hides the country control, for example for a place that is always in Pakistan. */
  hideCountry?: boolean
}

/** Country, province or state, and city (07 section 6). Value `CityValue`. */
export function CityPickerField({
  label,
  helpText,
  required = false,
  disabled,
  className,
  countryLabel,
  regionLabel,
  cityLabel,
  cityOtherLabel,
  legendHidden = false,
  hideCountry = false,
}: CityPickerFieldProps) {
  const { t, i18n } = useTranslation('fields')
  const control = useFieldControl<CityValue>()
  const isDisabled = useFieldDisabled(control, disabled)
  const value = control.value ?? EMPTY_CITY_VALUE
  const countries = useOptions('countries')
  const regions = useRegions(value.country_code)
  const regionList = regions.data ?? []
  const otherMode = value.city_other != null

  const [query, setQuery] = useState(value.city?.name ?? '')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const debouncedQuery = useDebouncedValue(query, CITY_SEARCH_DEBOUNCE_MS)
  const showingChosen = value.city != null && query === value.city.name
  const search = useCitySearch(
    value.country_code && !otherMode
      ? {
          country_code: value.country_code,
          region_id: value.region_id,
          q: showingChosen ? undefined : debouncedQuery,
        }
      : null,
  )
  const results = search.data ?? []
  const rows = results.length + 1
  const activeIndex = Math.min(active, rows - 1)

  const listId = useId()
  const optionPrefix = useId()
  const cityInputId = subId(control, 'city')
  const otherInputId = subId(control, 'other')
  const countryId = subId(control, 'country')
  const regionId = subId(control, 'region')
  const hintId = subId(control, 'hint')
  const otherInputRef = useRef<HTMLInputElement>(null)
  const cityInputRef = useRef<HTMLInputElement>(null)
  const focusAfterSwitch = useRef<'other' | 'city' | null>(null)

  // Show the chosen city's name when it is set from outside (prefill, reset).
  useEffect(() => {
    if (value.city) setQuery(value.city.name)
  }, [value.city])

  // Move focus to the control that replaced the one just used.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the mode switches
  useEffect(() => {
    if (focusAfterSwitch.current === 'other') otherInputRef.current?.focus()
    if (focusAfterSwitch.current === 'city') cityInputRef.current?.focus()
    focusAfterSwitch.current = null
  }, [otherMode])

  useEffect(() => {
    if (!open) return
    document.getElementById(`${optionPrefix}-${activeIndex}`)?.scrollIntoView?.({
      block: 'nearest',
    })
  }, [open, activeIndex, optionPrefix])

  function update(patch: Partial<CityValue>) {
    control.setValue({ ...value, ...patch })
  }

  function chooseCountry(code: string | null) {
    if (code === value.country_code) return
    setQuery('')
    control.setValue({ ...EMPTY_CITY_VALUE, country_code: code })
  }

  function chooseRegion(id: number | null) {
    const keepCity = value.city != null && value.city.region_id === id
    if (!keepCity && value.city) setQuery('')
    update({
      region_id: id,
      city_id: keepCity ? value.city_id : null,
      city: keepCity ? value.city : null,
    })
  }

  function chooseCity(city: CityRef) {
    update({ city_id: city.id, city, region_id: city.region_id, city_other: null })
    setQuery(city.name)
    setOpen(false)
  }

  function chooseNotListed() {
    focusAfterSwitch.current = 'other'
    setOpen(false)
    update({ city_id: null, city: null, city_other: value.city_other ?? '' })
  }

  function backToList() {
    focusAfterSwitch.current = 'city'
    setQuery('')
    update({ city_other: null, city_id: null, city: null })
  }

  function onCityKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        if (!open) setOpen(true)
        else setActive((current) => Math.min(current + 1, rows - 1))
        break
      case 'ArrowUp':
        event.preventDefault()
        setActive((current) => Math.max(current - 1, 0))
        break
      case 'Enter':
        if (!open) return
        event.preventDefault()
        if (activeIndex < results.length) {
          const city = results[activeIndex]
          if (city) chooseCity(city)
        } else chooseNotListed()
        break
      case 'Escape':
        if (open) {
          event.preventDefault()
          setOpen(false)
        }
        break
      default:
        break
    }
  }

  const regionName = (region: { name: string; name_ur: string | null }) =>
    i18n.language === 'ur' && region.name_ur ? region.name_ur : region.name
  const aria = ariaFor(control, { required, hasHelp: Boolean(helpText) })
  const hasRegions = regionList.length > 0
  const typedTooShort = query.trim().length > 0 && query.trim().length < MIN_QUERY_LENGTH
  const optionClass =
    'flex min-h-11 cursor-pointer select-none flex-col justify-center rounded-[var(--radius-input)] px-3 py-1.5 text-base data-[active=true]:bg-muted'

  return (
    <FieldShell
      control={control}
      label={label}
      helpText={helpText}
      required={required}
      className={className}
      kind="fieldset"
      labelHidden={legendHidden}
    >
      <div className="grid gap-4">
        {hideCountry ? null : (
          <div className="grid gap-1.5">
            <Label htmlFor={countryId}>{countryLabel ?? t('fields:city.country')}</Label>
            <SearchSelectControl
              id={countryId}
              label={countryLabel ?? t('fields:city.country')}
              options={countries}
              value={value.country_code}
              onChange={chooseCountry}
              onBlur={control.onBlur}
              required
              disabled={isDisabled}
              aria={{ 'aria-invalid': aria['aria-invalid'] }}
            />
          </div>
        )}

        {value.country_code && hasRegions ? (
          <div className="grid gap-1.5">
            <Label htmlFor={regionId}>{regionLabel ?? t('fields:city.region')}</Label>
            <NativeSelect
              id={regionId}
              value={value.region_id == null ? '' : String(value.region_id)}
              onChange={(event) =>
                chooseRegion(event.target.value === '' ? null : Number(event.target.value))
              }
              onBlur={control.onBlur}
              disabled={isDisabled}
              aria-required={otherMode || undefined}
              aria-invalid={aria['aria-invalid']}
            >
              <NativeSelectOption value="">
                {t('fields:city.region_placeholder')}
              </NativeSelectOption>
              {regionList.map((region) => (
                <NativeSelectOption key={region.id} value={String(region.id)}>
                  {regionName(region)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        ) : null}

        {value.country_code && !otherMode ? (
          <div className="grid gap-1.5">
            <Label htmlFor={cityInputId}>{cityLabel ?? t('fields:city.city')}</Label>
            <div className="relative">
              <Input
                ref={cityInputRef}
                id={cityInputId}
                name={control.name}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={open}
                aria-controls={listId}
                aria-activedescendant={open ? `${optionPrefix}-${activeIndex}` : undefined}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                dir="auto"
                placeholder={t('fields:city.city_placeholder')}
                value={query}
                disabled={isDisabled}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setActive(0)
                  setOpen(true)
                  if (value.city_id != null) update({ city_id: null, city: null })
                }}
                onFocus={() => setOpen(true)}
                onClick={() => setOpen(true)}
                onBlur={() => {
                  setOpen(false)
                  control.onBlur()
                }}
                onKeyDown={onCityKeyDown}
                {...aria}
                aria-required={required || undefined}
                aria-describedby={
                  [aria['aria-describedby'], typedTooShort ? hintId : null]
                    .filter(Boolean)
                    .join(' ') || undefined
                }
              />
              <div
                id={listId}
                role="listbox"
                aria-label={t('fields:city.results_label')}
                className={cn(
                  'absolute inset-x-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-[var(--radius-card)] border border-border bg-surface p-1 shadow-md',
                  !open && 'hidden',
                )}
              >
                {results.map((city, index) => (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: options are chosen by keyboard on the combobox input (aria-activedescendant)
                  <div
                    key={city.id}
                    id={`${optionPrefix}-${index}`}
                    role="option"
                    tabIndex={-1}
                    aria-selected={city.id === value.city_id}
                    data-active={index === activeIndex}
                    className={optionClass}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseMove={() => setActive(index)}
                    onClick={() => chooseCity(city)}
                  >
                    <span dir="auto">{city.name}</span>
                    {city.region_name ? (
                      <span className="text-sm text-muted-foreground">{city.region_name}</span>
                    ) : null}
                  </div>
                ))}
                {/* biome-ignore lint/a11y/useKeyWithClickEvents: options are chosen by keyboard on the combobox input (aria-activedescendant) */}
                <div
                  id={`${optionPrefix}-${results.length}`}
                  role="option"
                  tabIndex={-1}
                  aria-selected={false}
                  data-active={results.length === activeIndex}
                  className={cn(optionClass, 'font-medium text-primary')}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => setActive(results.length)}
                  onClick={chooseNotListed}
                >
                  {t('fields:city.not_listed')}
                </div>
              </div>
              {open && (search.isFetching || (results.length === 0 && search.isSuccess)) ? (
                <p role="status" className="sr-only">
                  {search.isFetching ? t('fields:city.searching') : t('fields:city.no_results')}
                </p>
              ) : null}
            </div>
            {typedTooShort ? (
              <p id={hintId} className="text-sm text-muted-foreground">
                {t('fields:city.city_hint')}
              </p>
            ) : null}
            <Button
              variant="link"
              className="h-11 w-fit px-0"
              disabled={isDisabled}
              onClick={chooseNotListed}
            >
              {t('fields:city.not_listed')}
            </Button>
          </div>
        ) : null}

        {value.country_code && otherMode ? (
          <div className="grid gap-1.5">
            <Label htmlFor={otherInputId}>{cityOtherLabel ?? t('fields:city.city_name')}</Label>
            <Input
              ref={otherInputRef}
              id={otherInputId}
              name={control.name}
              dir="auto"
              autoComplete="address-level2"
              maxLength={60}
              value={value.city_other ?? ''}
              disabled={isDisabled}
              onChange={(event) => update({ city_other: event.target.value })}
              onBlur={control.onBlur}
              {...aria}
              aria-required={required || undefined}
            />
            <Button
              variant="link"
              className="h-11 w-fit px-0"
              disabled={isDisabled}
              onClick={backToList}
            >
              {t('fields:city.back_to_list')}
            </Button>
          </div>
        ) : null}
      </div>
    </FieldShell>
  )
}
