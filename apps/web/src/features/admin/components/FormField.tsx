import { type ReactNode, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/button'
import { Label } from '~/components/ui/label'
import { Textarea } from '~/components/ui/textarea'
import { cn } from '~/lib/utils'
import { describeField } from '../forms'

type FormFieldProps = {
  label: ReactNode
  /** Hides the label visually; screen readers still read it. */
  hideLabel?: boolean
  hint?: ReactNode
  error?: string
  /** Receives the `id` and `aria-*` props for the control. */
  children: (props: ReturnType<typeof describeField>) => ReactNode
  className?: string
}

/** A labelled control with an optional hint and an error announced to screen readers. */
export function FormField({
  label,
  hideLabel = false,
  hint,
  error,
  children,
  className,
}: FormFieldProps) {
  const id = useId()
  return (
    <div className={cn('grid gap-1.5', className)}>
      <Label htmlFor={id} className={hideLabel ? 'sr-only' : undefined}>
        {label}
      </Label>
      {children(describeField(id, { hint: Boolean(hint), error }))}
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** A text area with a character counter. Longer text is not cut off: validation reports it. */
export function CountedTextarea({
  label,
  hint,
  error,
  value,
  onChange,
  max,
  rows = 4,
  name,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: string
  value: string
  onChange: (value: string) => void
  max: number
  rows?: number
  name?: string
}) {
  const { t } = useTranslation('admin')
  return (
    <FormField label={label} hint={hint} error={error}>
      {(props) => (
        <>
          <Textarea
            {...props}
            name={name}
            rows={rows}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
          <p className="text-end text-sm text-muted-foreground">
            {t('form.counter', { current: value.trim().length, max })}
          </p>
        </>
      )}
    </FormField>
  )
}

/** Buttons that fill a text area with a ready-made text the staff member may edit. */
export function PresetButtons({
  label,
  presets,
  onPick,
}: {
  label: string
  presets: readonly string[]
  onPick: (preset: string) => void
}) {
  return (
    <fieldset className="grid gap-1.5">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {presets.map((preset) => (
          <Button
            key={preset}
            size="sm"
            variant="secondary"
            className="h-auto min-h-9 whitespace-normal py-1.5 text-start"
            onClick={() => onPick(preset)}
          >
            {preset}
          </Button>
        ))}
      </div>
    </fieldset>
  )
}
