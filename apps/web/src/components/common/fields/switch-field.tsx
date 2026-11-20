import { Label } from '~/components/ui/label'
import { Switch } from '~/components/ui/switch'
import { useFieldControl } from '~/lib/form-context'
import { cn } from '~/lib/utils'
import {
  ariaFor,
  type BaseFieldProps,
  FieldError,
  FieldHelp,
  useFieldDisabled,
  useNameRef,
} from './field-shell'

export type SwitchFieldProps = Omit<BaseFieldProps, 'required'>

/**
 * A settings toggle: label and description at the start, the switch at the end. Value
 * `boolean`. The description is `helpText`. A switch always has a value, so no "(optional)".
 */
export function SwitchField({ label, helpText, disabled, className }: SwitchFieldProps) {
  const control = useFieldControl<boolean>()
  const isDisabled = useFieldDisabled(control, disabled)
  const nameRef = useNameRef(control.name)
  return (
    <div className={cn('grid gap-1', className)}>
      <div className="flex min-h-11 items-center justify-between gap-4 py-1.5">
        <div className="grid min-w-0 gap-0.5">
          <Label htmlFor={control.inputId} className="block text-base font-medium leading-snug">
            {label}
          </Label>
          {helpText ? <FieldHelp id={control.helpId}>{helpText}</FieldHelp> : null}
        </div>
        <Switch
          id={control.inputId}
          ref={nameRef}
          checked={control.value === true}
          onCheckedChange={(checked) => control.setValue(checked)}
          onBlur={control.onBlur}
          disabled={isDisabled}
          {...ariaFor(control, { hasHelp: Boolean(helpText) })}
        />
      </div>
      <FieldError id={control.errorId} message={control.message} />
    </div>
  )
}
