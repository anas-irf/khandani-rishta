import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Label } from '~/components/ui/label'
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select'
import { useFieldControl } from '~/lib/form-context'
import { feetInchesToCm, formatHeightShort, MAX_HEIGHT_CM, MIN_HEIGHT_CM } from '~/lib/format'
import { SwitchRow } from '../SwitchRow'
import { ariaFor, type BaseFieldProps, FieldShell, subId, useFieldDisabled } from './field-shell'

export type RangeValue = { min: number | null; max: number | null }

export type RangeFieldProps = BaseFieldProps & {
  /** Values offered at both ends. */
  options: number[]
  /** Values offered for the lower end, when they differ from `options`. */
  minOptions?: number[]
  /** Values offered for the upper end, when they differ from `options`. */
  maxOptions?: number[]
  formatOption?: (value: number) => string
  minLabel?: string
  maxLabel?: string
  /**
   * Adds a "No preference" switch that sets both ends to null (07 section 11.2, height). Turning
   * it off restores the last range, or the full range.
   */
  noPreference?: boolean
  noPreferenceLabel?: string
}

/**
 * A range as two selects, not a slider (17 section 8.2, 20 section 7). Value
 * `{ min: number | null, max: number | null }`. When `required` is false each end also offers
 * "Any" (null). Choosing a lower end above the upper end moves the upper end with it, and the
 * other way round.
 */
export function RangeField({
  label,
  helpText,
  required = false,
  disabled,
  className,
  options,
  minOptions = options,
  maxOptions = options,
  formatOption = String,
  minLabel,
  maxLabel,
  noPreference = false,
  noPreferenceLabel,
}: RangeFieldProps) {
  const { t } = useTranslation('fields')
  const control = useFieldControl<RangeValue>()
  const isDisabled = useFieldDisabled(control, disabled)
  const value = control.value ?? { min: null, max: null }
  const lastRange = useRef<RangeValue | null>(null)
  const empty = value.min == null && value.max == null

  useEffect(() => {
    if (value.min != null || value.max != null)
      lastRange.current = { min: value.min, max: value.max }
  }, [value.min, value.max])

  function setMin(min: number | null) {
    const max = min != null && value.max != null && min > value.max ? min : value.max
    control.setValue({ min, max })
  }

  function setMax(max: number | null) {
    const min = max != null && value.min != null && max < value.min ? max : value.min
    control.setValue({ min, max })
  }

  function toggleNoPreference(on: boolean) {
    if (on) control.setValue({ min: null, max: null })
    else {
      control.setValue(
        lastRange.current ?? { min: minOptions[0] ?? null, max: maxOptions.at(-1) ?? null },
      )
    }
  }

  const aria = ariaFor(control, { required, hasHelp: Boolean(helpText) })
  const maxId = subId(control, 'max')
  const switchId = subId(control, 'any')
  const selectsDisabled = isDisabled || (noPreference && empty)

  const ends = [
    {
      key: 'min' as const,
      id: control.inputId,
      label: minLabel ?? t('fields:range.min'),
      options: minOptions,
      current: value.min,
      onChange: setMin,
    },
    {
      key: 'max' as const,
      id: maxId,
      label: maxLabel ?? t('fields:range.max'),
      options: maxOptions,
      current: value.max,
      onChange: setMax,
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
    >
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,7.5rem),1fr))] gap-3">
        {ends.map((end) => (
          <div key={end.key} className="grid min-w-0 gap-1">
            <Label htmlFor={end.id} variant="part">
              {end.label}
            </Label>
            <NativeSelect
              id={end.id}
              name={end.key === 'min' ? control.name : undefined}
              value={end.current == null ? '' : String(end.current)}
              onChange={(event) =>
                end.onChange(event.target.value === '' ? null : Number(event.target.value))
              }
              onBlur={control.onBlur}
              disabled={selectsDisabled}
              {...aria}
            >
              {!required || end.current == null ? (
                <NativeSelectOption value="" disabled={required}>
                  {t('fields:range.any')}
                </NativeSelectOption>
              ) : null}
              {end.options.map((option) => (
                <NativeSelectOption key={option} value={String(option)}>
                  {formatOption(option)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        ))}
      </div>
      {noPreference ? (
        <SwitchRow
          id={switchId}
          label={noPreferenceLabel ?? t('fields:range.no_preference')}
          checked={empty}
          onCheckedChange={toggleNoPreference}
          disabled={isDisabled}
        />
      ) : null}
    </FieldShell>
  )
}

const AGES = Array.from({ length: 80 - 18 + 1 }, (_, index) => 18 + index)

/** Heights from 4 ft 0 in to 7 ft 0 in in whole inches, in centimetres (122 to 213). */
export const HEIGHT_RANGE_OPTIONS: number[] = Array.from({ length: 84 - 48 + 1 }, (_, index) =>
  feetInchesToCm(Math.floor((48 + index) / 12), (48 + index) % 12),
).filter((cm) => cm >= MIN_HEIGHT_CM && cm <= MAX_HEIGHT_CM)

type PresetRangeProps = Omit<RangeFieldProps, 'options' | 'minOptions' | 'maxOptions'>

/** Age range 18 to 80 (07 section 11.2). Both ends are always set, so `required` defaults to true. */
export function AgeRangeField({ required = true, formatOption, ...props }: PresetRangeProps) {
  const { t } = useTranslation('common')
  return (
    <RangeField
      {...props}
      required={required}
      options={AGES}
      formatOption={formatOption ?? ((age) => t('common:format.age', { age }))}
    />
  )
}

/** Height range 4 ft 0 in to 7 ft 0 in with a "No preference" switch (07 section 11.2). */
export function HeightRangeField({
  noPreference = true,
  formatOption = formatHeightShort,
  ...props
}: PresetRangeProps) {
  return (
    <RangeField
      {...props}
      noPreference={noPreference}
      options={HEIGHT_RANGE_OPTIONS}
      formatOption={formatOption}
    />
  )
}
