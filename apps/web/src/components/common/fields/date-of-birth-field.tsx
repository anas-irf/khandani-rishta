import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Label } from '~/components/ui/label'
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select'
import { useFieldControl } from '~/lib/form-context'
import { todayInKarachi } from '~/lib/format'
import { ariaFor, type BaseFieldProps, FieldShell, subId, useFieldDisabled } from './field-shell'

type Parts = { day: string; month: string; year: string }

const EMPTY: Parts = { day: '', month: '', year: '' }

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0')
}

/** `YYYY-MM-DD` for a real calendar date, otherwise null (31 February gives null). */
export function composeDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1) return null
  if (date.getUTCDate() !== day) return null
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`
}

function partsOf(value: string | null): Parts {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null
  if (!match) return EMPTY
  return {
    year: String(Number(match[1])),
    month: String(Number(match[2])),
    day: String(Number(match[3])),
  }
}

function composeParts(parts: Parts): string | null {
  if (!parts.day || !parts.month || !parts.year) return null
  return composeDate(Number(parts.year), Number(parts.month), Number(parts.day))
}

export type DateOfBirthFieldProps = BaseFieldProps & {
  /** The youngest age offered (default 18): the newest year is the current year minus this. */
  minAge?: number
  /** The oldest age offered (default 80). */
  maxAge?: number
}

/**
 * Date of birth as three selects: day, month, year (17 section 8.2, 07 section 4.1). No free
 * typing. Value `string | null` (`YYYY-MM-DD`); an incomplete or impossible date is null.
 */
export function DateOfBirthField({
  label,
  helpText,
  required = false,
  disabled,
  className,
  minAge = 18,
  maxAge = 80,
}: DateOfBirthFieldProps) {
  const { t, i18n } = useTranslation('fields')
  const control = useFieldControl<string | null>()
  const isDisabled = useFieldDisabled(control, disabled)
  const value = control.value ?? null
  const [parts, setParts] = useState<Parts>(() => partsOf(value))

  // Follow changes made outside the field (prefill, reset). Partial input stays as typed.
  useEffect(() => {
    setParts((current) => {
      const composed = composeParts(current)
      if (value === composed) return current
      if (value == null) return composed == null ? current : EMPTY
      return partsOf(value)
    })
  }, [value])

  const currentYear = Number(todayInKarachi().slice(0, 4))
  const years = useMemo(() => {
    const list: number[] = []
    for (let year = currentYear - minAge; year >= currentYear - maxAge; year -= 1) list.push(year)
    return list
  }, [currentYear, minAge, maxAge])

  const months = useMemo(() => {
    const format = new Intl.DateTimeFormat(i18n.language || 'en', {
      month: 'long',
      timeZone: 'UTC',
    })
    return Array.from({ length: 12 }, (_, index) => ({
      value: String(index + 1),
      label: format.format(new Date(Date.UTC(2000, index, 1))),
    }))
  }, [i18n.language])

  function update(part: keyof Parts, next: string) {
    const updated = { ...parts, [part]: next }
    setParts(updated)
    const composed = composeParts(updated)
    if (composed !== value) control.setValue(composed)
  }

  const complete = Boolean(parts.day && parts.month && parts.year)
  const impossible = complete && composeParts(parts) == null
  const message = impossible ? t('fields:date_of_birth.invalid') : control.message
  const aria = ariaFor(
    { helpId: control.helpId, errorId: control.errorId, invalid: Boolean(message) },
    { required, hasHelp: Boolean(helpText) },
  )

  const selects: {
    part: keyof Parts
    label: string
    options: { value: string; label: string }[]
  }[] = [
    {
      part: 'day',
      label: t('fields:date_of_birth.day'),
      options: Array.from({ length: 31 }, (_, index) => ({
        value: String(index + 1),
        label: String(index + 1),
      })),
    },
    { part: 'month', label: t('fields:date_of_birth.month'), options: months },
    {
      part: 'year',
      label: t('fields:date_of_birth.year'),
      options: years.map((year) => ({ value: String(year), label: String(year) })),
    },
  ]

  return (
    <FieldShell
      control={control}
      label={label}
      helpText={helpText}
      required={required}
      className={className}
      kind="fieldset"
      message={message}
    >
      <div className="grid grid-cols-[minmax(0,5rem)_minmax(0,1fr)_minmax(0,6.5rem)] gap-2">
        {selects.map((select, index) => {
          const id = index === 0 ? control.inputId : subId(control, select.part)
          return (
            <div key={select.part} className="grid gap-1">
              <Label htmlFor={id} className="text-sm font-normal text-muted-foreground">
                {select.label}
              </Label>
              <NativeSelect
                id={id}
                name={index === 0 ? control.name : undefined}
                value={parts[select.part]}
                onChange={(event) => update(select.part, event.target.value)}
                onBlur={control.onBlur}
                disabled={isDisabled}
                {...aria}
              >
                <NativeSelectOption value="">{select.label}</NativeSelectOption>
                {select.options.map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          )
        })}
      </div>
    </FieldShell>
  )
}
