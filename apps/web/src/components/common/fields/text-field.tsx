import { Minus, Plus } from 'lucide-react'
import type { HTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Textarea } from '~/components/ui/textarea'
import { useFieldControl } from '~/lib/form-context'
import {
  ariaFor,
  type BaseFieldProps,
  CharCount,
  FieldShell,
  subId,
  useFieldDisabled,
} from './field-shell'

type InputMode = HTMLAttributes<HTMLInputElement>['inputMode']

export type TextFieldProps = BaseFieldProps & {
  type?: 'text' | 'email' | 'tel' | 'url' | 'search'
  inputMode?: InputMode
  autoComplete?: string
  autoCapitalize?: string
  maxLength?: number
  placeholder?: string
  readOnly?: boolean
}

/** Free text on one line. Value `string | null`: an empty input is `null`. */
export function TextField({
  label,
  helpText,
  required = false,
  disabled,
  className,
  type = 'text',
  inputMode,
  autoComplete,
  autoCapitalize,
  maxLength,
  placeholder,
  readOnly,
}: TextFieldProps) {
  const control = useFieldControl<string | null>()
  const isDisabled = useFieldDisabled(control, disabled)
  return (
    <FieldShell
      control={control}
      label={label}
      helpText={helpText}
      required={required}
      className={className}
    >
      <Input
        id={control.inputId}
        name={control.name}
        type={type}
        dir={type === 'text' || type === 'search' ? 'auto' : undefined}
        value={control.value ?? ''}
        onChange={(event) =>
          control.setValue(event.target.value === '' ? null : event.target.value)
        }
        onBlur={control.onBlur}
        inputMode={inputMode}
        autoComplete={autoComplete}
        autoCapitalize={autoCapitalize}
        maxLength={maxLength}
        placeholder={placeholder}
        readOnly={readOnly}
        disabled={isDisabled}
        {...ariaFor(control, { required, hasHelp: Boolean(helpText) })}
      />
    </FieldShell>
  )
}

export type TextAreaFieldProps = BaseFieldProps & {
  /** Shows the counter "n / max". Longer text is not cut off: the schema reports it. */
  maxLength?: number
  rows?: number
  placeholder?: string
}

/** Free text on several lines with a character counter. Value `string | null`. */
export function TextAreaField({
  label,
  helpText,
  required = false,
  disabled,
  className,
  maxLength,
  rows = 5,
  placeholder,
}: TextAreaFieldProps) {
  const { t } = useTranslation('fields')
  const control = useFieldControl<string | null>()
  const isDisabled = useFieldDisabled(control, disabled)
  const length = control.value?.length ?? 0
  const counterId = subId(control, 'counter')
  const over = maxLength != null && length > maxLength
  return (
    <FieldShell
      control={control}
      label={label}
      helpText={helpText}
      required={required}
      className={className}
    >
      <Textarea
        id={control.inputId}
        name={control.name}
        dir="auto"
        rows={rows}
        value={control.value ?? ''}
        onChange={(event) =>
          control.setValue(event.target.value === '' ? null : event.target.value)
        }
        onBlur={control.onBlur}
        placeholder={placeholder}
        disabled={isDisabled}
        {...ariaFor(control, {
          required,
          hasHelp: Boolean(helpText),
          extraDescribedBy: maxLength != null ? counterId : undefined,
        })}
      />
      {maxLength != null ? (
        <CharCount id={counterId} over={over}>
          <span aria-hidden="true">
            {t('fields:text_area.counter', { length, max: maxLength })}
          </span>
          <span className="sr-only">
            {t('fields:text_area.counter_label', { length, max: maxLength })}
          </span>
        </CharCount>
      ) : null}
    </FieldShell>
  )
}

export type NumberFieldProps = BaseFieldProps & {
  min?: number
  max?: number
  step?: number
  /** Adds decrease and increase buttons (the "stepper" of 07). */
  stepper?: boolean
  placeholder?: string
}

/**
 * A whole number (0 or more). Value `number | null`. Uses a text input with a numeric keypad
 * rather than `type="number"`, which changes on scroll and accepts "e".
 */
export function NumberField({
  label,
  helpText,
  required = false,
  disabled,
  className,
  min,
  max,
  step = 1,
  stepper = false,
  placeholder,
}: NumberFieldProps) {
  const { t } = useTranslation('fields')
  const control = useFieldControl<number | null>()
  const isDisabled = useFieldDisabled(control, disabled)
  const value = control.value ?? null
  const lower = min ?? 0

  const input = (
    <Input
      id={control.inputId}
      name={control.name}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="off"
      value={value == null ? '' : String(value)}
      onChange={(event) => {
        const digits = event.target.value.replace(/\D/g, '')
        control.setValue(digits === '' ? null : Number(digits))
      }}
      onBlur={control.onBlur}
      maxLength={max != null ? String(max).length : undefined}
      placeholder={placeholder}
      disabled={isDisabled}
      className={stepper ? 'w-[5.5rem] px-[8px] text-center tabular-nums' : undefined}
      {...ariaFor(control, { required, hasHelp: Boolean(helpText) })}
    />
  )

  return (
    <FieldShell
      control={control}
      label={label}
      helpText={helpText}
      required={required}
      className={className}
    >
      {stepper ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="icon"
            aria-label={t('fields:number.decrease', { label })}
            disabled={isDisabled || (value != null && value <= lower)}
            onClick={() => control.setValue(value == null ? lower : Math.max(lower, value - step))}
          >
            <Minus aria-hidden="true" />
          </Button>
          {input}
          <Button
            variant="secondary"
            size="icon"
            aria-label={t('fields:number.increase', { label })}
            disabled={isDisabled || (max != null && value != null && value >= max)}
            onClick={() => {
              const next = value == null ? lower : value + step
              control.setValue(max != null ? Math.min(max, next) : next)
            }}
          >
            <Plus aria-hidden="true" />
          </Button>
        </div>
      ) : (
        input
      )}
    </FieldShell>
  )
}
