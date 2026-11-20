import { useTranslation } from 'react-i18next'
import type { Importance } from '~/lib/api-types'
import { useFieldControl } from '~/lib/form-context'
import { fallbackLabel, useOptions } from '~/lib/reference'
import { SegmentedChoice } from './choice-controls'
import { ariaFor, type BaseFieldProps, FieldShell, subId, useFieldDisabled } from './field-shell'

export const IMPORTANCE_VALUES: readonly Importance[] = ['must', 'high', 'medium', 'low']

export type ImportanceFieldProps = Omit<BaseFieldProps, 'required'> & {
  /** Hides the "Must have" note under the control (07 section 11.3 rule 2). */
  hideMustNote?: boolean
}

/**
 * The four importance choices as a segmented control (07 section 11.3). Value `Importance`.
 * It always holds a value, so the label never shows "(optional)". Pass `disabled` when the row
 * has no preference (rule 1): the stored value is kept.
 */
export function ImportanceField({
  label,
  helpText,
  disabled,
  className,
  hideMustNote = false,
}: ImportanceFieldProps) {
  const { t } = useTranslation('fields')
  const control = useFieldControl<Importance>()
  const isDisabled = useFieldDisabled(control, disabled)
  const labels = useOptions('importance')
  const options = IMPORTANCE_VALUES.map((code) => ({
    code,
    label: labels.find((option) => option.code === code)?.label ?? fallbackLabel(code),
  }))
  const help = helpText ?? t('fields:importance.help')
  const noteId = subId(control, 'note')
  const showNote = !hideMustNote && control.value === 'must' && !disabled

  return (
    <FieldShell
      control={control}
      label={label}
      helpText={help}
      required
      className={className}
      kind="group"
    >
      <SegmentedChoice
        name={control.name}
        options={options}
        value={control.value ?? null}
        onChange={(code) => {
          if (code) control.setValue(code as Importance)
        }}
        onBlur={control.onBlur}
        labelledBy={subId(control, 'label')}
        aria={ariaFor(control, {
          hasHelp: true,
          extraDescribedBy: showNote ? noteId : undefined,
        })}
        disabled={isDisabled}
        required
      />
      {showNote ? (
        <p id={noteId} className="text-sm text-foreground">
          {t('fields:importance.must_note')}
        </p>
      ) : null}
    </FieldShell>
  )
}
