import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select'
import { useFieldControl } from '~/lib/form-context'
import { useOptions, useReference } from '~/lib/reference'
import { ariaFor, type BaseFieldProps, FieldShell, subId, useFieldDisabled } from './field-shell'

/** The pattern every stored phone number matches (08 section 3.3 rule 4). */
export const E164_PATTERN = /^\+[1-9][0-9]{7,14}$/

/**
 * Builds the stored value from a dial code and the national number (08 section 3.3 rule 3):
 * spaces and hyphens removed, one leading 0 removed, the dial code in front. An empty national
 * number gives null (rule 7). `toE164('+92', '0300 1234567')` is `+923001234567`.
 */
export function toE164(dialCode: string, national: string): string | null {
  const digits = national.replace(/[\s-]/g, '').replace(/^0/, '')
  if (!digits) return null
  return `${dialCode}${digits}`
}

/**
 * Splits a stored number into the longest dial code that prefixes it and the rest (08 section
 * 3.3 rule 6). `dial` is null when no dial code matches.
 */
export function splitE164(
  value: string | null | undefined,
  dialCodes: readonly string[],
): { dial: string | null; national: string } {
  if (!value) return { dial: null, national: '' }
  const dial = [...dialCodes]
    .sort((a, b) => b.length - a.length)
    .find((code) => value.startsWith(code))
  if (!dial) return { dial: null, national: value.replace(/^\+/, '') }
  return { dial, national: value.slice(dial.length) }
}

/** A Pakistani mobile number shown as `3XX XXXXXXX` (08 section 3.3 rule 6). */
export function formatNational(dial: string | null, national: string): string {
  if (dial === '+92' && /^3\d{9}$/.test(national))
    return `${national.slice(0, 3)} ${national.slice(3)}`
  return national
}

export type PhoneFieldProps = BaseFieldProps & {
  /** The country preselected in the dial-code picker (default `PK`, so `+92`). */
  defaultCountry?: string
  autoComplete?: string
}

/** Dial-code select plus national number (08 section 3.3). Value `string | null` in E.164. */
export function PhoneField({
  label,
  helpText,
  required = false,
  disabled,
  className,
  defaultCountry = 'PK',
  autoComplete = 'tel-national',
}: PhoneFieldProps) {
  const { t } = useTranslation('fields')
  const control = useFieldControl<string | null>()
  const isDisabled = useFieldDisabled(control, disabled)
  const reference = useReference()
  const countryLabels = useOptions('countries')
  const value = control.value ?? null

  // Countries with a dial code, in bootstrap order (Pakistan first). The select's value is the
  // country code, because several countries share a dial code (+1).
  const countries = useMemo(() => {
    const labels = new Map(countryLabels.map((option) => [option.code, option.label]))
    return reference.countries
      .filter((country): country is typeof country & { dial_code: string } =>
        Boolean(country.dial_code),
      )
      .map((country) => ({
        code: country.code,
        dial: country.dial_code,
        label: labels.get(country.code) ?? country.name,
      }))
  }, [reference.countries, countryLabels])
  const dialCodes = useMemo(() => countries.map((country) => country.dial), [countries])
  const dialOf = (code: string) => countries.find((country) => country.code === code)?.dial ?? ''

  const [state, setState] = useState(() => fromValue(value))

  function fromValue(next: string | null) {
    const { dial, national } = splitE164(next, dialCodes)
    const country =
      (dial && countries.find((entry) => entry.code === defaultCountry && entry.dial === dial)) ||
      (dial && countries.find((entry) => entry.dial === dial)) ||
      countries.find((entry) => entry.code === defaultCountry) ||
      countries[0]
    return { country: country?.code ?? '', national: formatNational(dial, national) }
  }

  // Follow changes made outside the field (prefill, reset).
  // biome-ignore lint/correctness/useExhaustiveDependencies: compares with the local state only
  useEffect(() => {
    setState((current) => {
      const composed = toE164(dialOf(current.country), current.national)
      if (composed === value) return current
      if (value == null) return { ...current, national: '' }
      return fromValue(value)
    })
  }, [value])

  function update(next: { country: string; national: string }) {
    setState(next)
    const composed = toE164(dialOf(next.country), next.national)
    if (composed !== value) control.setValue(composed)
  }

  const aria = ariaFor(control, { required, hasHelp: Boolean(helpText) })
  const dialId = subId(control, 'dial')
  const dial = dialOf(state.country)

  return (
    <FieldShell
      control={control}
      label={label}
      helpText={helpText}
      required={required}
      className={className}
      kind="fieldset"
    >
      <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-2">
        <div className="grid gap-1">
          <Label htmlFor={dialId} className="text-sm font-normal text-muted-foreground">
            {t('fields:phone.dial_code')}
          </Label>
          <NativeSelect
            id={dialId}
            value={state.country}
            onChange={(event) => update({ ...state, country: event.target.value })}
            onBlur={control.onBlur}
            disabled={isDisabled}
            {...aria}
          >
            {countries.map((country) => (
              <NativeSelectOption key={country.code} value={country.code}>
                {t('fields:phone.dial_option', { country: country.label, dial: country.dial })}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1">
          <Label htmlFor={control.inputId} className="text-sm font-normal text-muted-foreground">
            {t('fields:phone.number')}
          </Label>
          <Input
            id={control.inputId}
            name={control.name}
            type="tel"
            inputMode="tel"
            dir="ltr"
            autoComplete={autoComplete}
            placeholder={dial === '+92' ? t('fields:phone.placeholder_pk') : undefined}
            value={state.national}
            onChange={(event) =>
              update({ ...state, national: event.target.value.replace(/[^\d\s-]/g, '') })
            }
            onBlur={control.onBlur}
            disabled={isDisabled}
            {...aria}
          />
        </div>
      </div>
    </FieldShell>
  )
}
