import { type ReactNode, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { CharCount, FieldError } from '~/components/common/fields/field-shell'
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
    <div className={cn('grid content-start gap-2', className)}>
      <Label htmlFor={id} className={hideLabel ? 'sr-only' : undefined}>
        {label}
      </Label>
      {children(describeField(id, { hint: Boolean(hint), error }))}
      {hint ? (
        <p id={`${id}-hint`} className="text-caption text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <div role="alert">
          <FieldError id={`${id}-error`} message={error} />
        </div>
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
          <CharCount>{t('form.counter', { current: value.trim().length, max })}</CharCount>
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
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-label-lg">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {presets.map((preset) => (
          <Button
            key={preset}
            variant="quiet"
            className="rounded-row px-4 text-start text-body-sm font-normal"
            onClick={() => onPick(preset)}
          >
            {preset}
          </Button>
        ))}
      </div>
    </fieldset>
  )
}
