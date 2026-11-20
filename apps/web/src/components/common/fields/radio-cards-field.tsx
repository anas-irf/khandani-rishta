import { useFieldControl } from '~/lib/form-context'
import { type ChoiceOption, RadioCardList } from './choice-controls'
import { ariaFor, type BaseFieldProps, FieldShell, subId, useFieldDisabled } from './field-shell'

export type RadioCardsFieldProps = BaseFieldProps & {
  options: ChoiceOption[]
}

/**
 * Choices that each need an explanation (photo visibility, discovery visibility, `managed_by`):
 * one card per choice with a title and a description, with radio group semantics. Value
 * `string | null`.
 */
export function RadioCardsField({
  label,
  helpText,
  required = false,
  disabled,
  className,
  options,
}: RadioCardsFieldProps) {
  const control = useFieldControl<string | null>()
  const isDisabled = useFieldDisabled(control, disabled)
  return (
    <FieldShell
      control={control}
      label={label}
      helpText={helpText}
      required={required}
      className={className}
      kind="group"
    >
      <RadioCardList
        name={control.name}
        idPrefix={control.inputId}
        options={options}
        value={control.value ?? null}
        onChange={control.setValue}
        onBlur={control.onBlur}
        labelledBy={subId(control, 'label')}
        aria={ariaFor(control, { required, hasHelp: Boolean(helpText) })}
        disabled={isDisabled}
        required={required}
      />
    </FieldShell>
  )
}
