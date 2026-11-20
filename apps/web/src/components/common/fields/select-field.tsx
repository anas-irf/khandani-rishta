import { useTranslation } from 'react-i18next'
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select'
import { useFieldControl } from '~/lib/form-context'
import { fallbackLabel, type Option } from '~/lib/reference'
import { fitsSegmented, RadioCardList, SegmentedChoice } from './choice-controls'
import { ariaFor, type BaseFieldProps, FieldShell, subId, useFieldDisabled } from './field-shell'
import type { SearchOption } from './option-search'
import { SearchSelectControl, useFieldOptions } from './search-select-field'

export type SelectVariant = 'auto' | 'native' | 'radio' | 'search'

/**
 * The control a list gets (07 section 2.6): up to 4 options as radio choices, 5 to 8 as a
 * native select, more than 8 with search.
 */
export function resolveSelectVariant(variant: SelectVariant, count: number) {
  if (variant !== 'auto') return variant
  if (count <= 4) return 'radio'
  if (count <= 8) return 'native'
  return 'search'
}

export type SelectFieldProps = BaseFieldProps & {
  options?: SearchOption[]
  /** A reference list or lookup table name (`marital_status`, `languages`), used without `options`. */
  list?: string
  placeholder?: string
  variant?: SelectVariant
  /** For the radio variant: a segmented control, cards, or chosen by label length (default). */
  radioLayout?: 'auto' | 'segmented' | 'cards'
}

/** One choice from a closed list. Value `string | null`. */
export function SelectField({
  label,
  helpText,
  required = false,
  disabled,
  className,
  options,
  list,
  placeholder,
  variant = 'auto',
  radioLayout = 'auto',
}: SelectFieldProps) {
  const { t } = useTranslation('fields')
  const control = useFieldControl<string | null>()
  const isDisabled = useFieldDisabled(control, disabled)
  const items = useFieldOptions(options, list)
  const value = control.value ?? null
  const kind = resolveSelectVariant(variant, items.length)
  const aria = ariaFor(control, { required, hasHelp: Boolean(helpText) })

  if (kind === 'radio') {
    const segmented =
      radioLayout === 'segmented' || (radioLayout === 'auto' && fitsSegmented(items))
    const choice = {
      name: control.name,
      options: items,
      value,
      onChange: control.setValue,
      onBlur: control.onBlur,
      labelledBy: subId(control, 'label'),
      aria,
      disabled: isDisabled,
      required,
    }
    return (
      <FieldShell
        control={control}
        label={label}
        helpText={helpText}
        required={required}
        className={className}
        kind="group"
      >
        {segmented ? (
          <SegmentedChoice {...choice} />
        ) : (
          <RadioCardList {...choice} idPrefix={control.inputId} />
        )}
      </FieldShell>
    )
  }

  if (kind === 'search') {
    return (
      <FieldShell
        control={control}
        label={label}
        helpText={helpText}
        required={required}
        className={className}
      >
        <SearchSelectControl
          id={control.inputId}
          name={control.name}
          label={label}
          options={items}
          value={value}
          onChange={control.setValue}
          onBlur={control.onBlur}
          placeholder={placeholder}
          required={required}
          disabled={isDisabled}
          aria={aria}
        />
      </FieldShell>
    )
  }

  return (
    <FieldShell
      control={control}
      label={label}
      helpText={helpText}
      required={required}
      className={className}
    >
      <NativeSelect
        id={control.inputId}
        name={control.name}
        value={value ?? ''}
        onChange={(event) => control.setValue(event.target.value || null)}
        onBlur={control.onBlur}
        disabled={isDisabled}
        {...aria}
      >
        <NativeSelectOption value="" disabled={required && value != null}>
          {placeholder ?? t('fields:select.placeholder')}
        </NativeSelectOption>
        {withCurrent(items, value).map((option) => (
          <NativeSelectOption key={option.code} value={option.code}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </FieldShell>
  )
}

/** Keeps a stored code that is no longer in the list visible (17 section 8.4). */
export function withCurrent(options: Option[], value: string | null): Option[] {
  if (!value || options.some((option) => option.code === value)) return options
  return [...options, { code: value, label: fallbackLabel(value) }]
}
