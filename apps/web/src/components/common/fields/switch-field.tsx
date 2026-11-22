import { useFieldControl } from '~/lib/form-context'
import { cn } from '~/lib/utils'
import { SwitchRow } from '../SwitchRow'
import {
  ariaFor,
  type BaseFieldProps,
  FieldError,
  useFieldDisabled,
  useNameRef,
} from './field-shell'

export type SwitchFieldProps = Omit<BaseFieldProps, 'required'>

/**
 * A settings toggle as one row that is the switch (DESIGN.md 6.11). Value `boolean`. The
 * description is `helpText`. A switch always has a value, so no "(optional)".
 */
export function SwitchField({ label, helpText, disabled, className }: SwitchFieldProps) {
  const control = useFieldControl<boolean>()
  const isDisabled = useFieldDisabled(control, disabled)
  const nameRef = useNameRef(control.name)
  return (
    <div className={cn('field-stack', className)}>
      <SwitchRow
        id={control.inputId}
        ref={nameRef}
        label={label}
        help={helpText}
        checked={control.value === true}
        onCheckedChange={(checked) => control.setValue(checked)}
        onBlur={control.onBlur}
        disabled={isDisabled}
        {...ariaFor(control)}
      />
      <FieldError id={control.errorId} message={control.message} />
    </div>
  )
}
