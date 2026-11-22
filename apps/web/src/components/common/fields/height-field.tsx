import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Label } from '~/components/ui/label'
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select'
import { useFieldControl } from '~/lib/form-context'
import { cmToFeetInches, feetInchesToCm, MAX_HEIGHT_CM, MIN_HEIGHT_CM } from '~/lib/format'
import { ariaFor, type BaseFieldProps, FieldShell, subId, useFieldDisabled } from './field-shell'

type Parts = { feet: string; inches: string }

const EMPTY: Parts = { feet: '', inches: '' }
export const HEIGHT_FEET = [4, 5, 6, 7] as const
const MAX_FEET = 7

function partsOf(heightCm: number | null): Parts {
  if (heightCm == null || heightCm < MIN_HEIGHT_CM || heightCm > MAX_HEIGHT_CM) return EMPTY
  const { feet, inches } = cmToFeetInches(heightCm)
  return { feet: String(feet), inches: String(inches) }
}

function composeParts(parts: Parts): number | null {
  if (!parts.feet || !parts.inches) return null
  return feetInchesToCm(Number(parts.feet), Number(parts.inches))
}

/** Inches offered for a number of feet: 0 to 11, only 0 at 7 ft (07 section 4.3). */
export function inchesFor(feet: number | null): number[] {
  if (feet === MAX_FEET) return [0]
  return Array.from({ length: 12 }, (_, index) => index)
}

/** Height as feet and inches selects (07 section 4.3). Value `number | null` in centimetres. */
export function HeightField({
  label,
  helpText,
  required = false,
  disabled,
  className,
}: BaseFieldProps) {
  const { t } = useTranslation('fields')
  const control = useFieldControl<number | null>()
  const isDisabled = useFieldDisabled(control, disabled)
  const value = control.value ?? null
  const [parts, setParts] = useState<Parts>(() => partsOf(value))

  // Follow changes made outside the field (prefill, reset).
  useEffect(() => {
    setParts((current) => {
      const composed = composeParts(current)
      if (value === composed) return current
      if (value == null) return composed == null ? current : EMPTY
      return partsOf(value)
    })
  }, [value])

  function update(next: Parts) {
    const adjusted = next.feet === String(MAX_FEET) ? { ...next, inches: '0' } : next
    setParts(adjusted)
    const composed = composeParts(adjusted)
    if (composed !== value) control.setValue(composed)
  }

  const aria = ariaFor(control, { required, hasHelp: Boolean(helpText) })
  const inchesId = subId(control, 'inches')
  const feet = parts.feet ? Number(parts.feet) : null

  return (
    <FieldShell
      control={control}
      label={label}
      helpText={helpText}
      required={required}
      className={className}
      kind="fieldset"
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid w-[min(100%,8rem)] gap-1">
          <Label htmlFor={control.inputId} variant="part">
            {t('fields:height.feet')}
          </Label>
          <NativeSelect
            id={control.inputId}
            name={control.name}
            value={parts.feet}
            onChange={(event) => update({ ...parts, feet: event.target.value })}
            onBlur={control.onBlur}
            disabled={isDisabled}
            {...aria}
          >
            <NativeSelectOption value="">{t('fields:height.feet')}</NativeSelectOption>
            {HEIGHT_FEET.map((option) => (
              <NativeSelectOption key={option} value={String(option)}>
                {t('fields:height.feet_option', { feet: option })}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="grid w-[min(100%,8rem)] gap-1">
          <Label htmlFor={inchesId} variant="part">
            {t('fields:height.inches')}
          </Label>
          <NativeSelect
            id={inchesId}
            value={parts.inches}
            onChange={(event) => update({ ...parts, inches: event.target.value })}
            onBlur={control.onBlur}
            disabled={isDisabled}
            {...aria}
          >
            <NativeSelectOption value="">{t('fields:height.inches')}</NativeSelectOption>
            {inchesFor(feet).map((option) => (
              <NativeSelectOption key={option} value={String(option)}>
                {t('fields:height.inches_option', { inches: option })}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        {value != null ? (
          <p className="flex min-h-touch items-center text-body-sm text-muted-foreground tabular-nums">
            {t('fields:height.centimetres', { cm: value })}
          </p>
        ) : null}
      </div>
    </FieldShell>
  )
}
