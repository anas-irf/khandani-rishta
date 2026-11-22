import { type AnyFormApi, useStore } from '@tanstack/react-form'
import { CircleAlert } from 'lucide-react'
import { type ReactNode, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Label } from '~/components/ui/label'
import { describedBy, type useFieldControl } from '~/lib/form-context'
import { cn } from '~/lib/utils'

/**
 * Building blocks shared by every field component (17 section 8.2, 20 section 7): a visible
 * label with "(optional)" on optional fields, help text and the error text under the control,
 * linked to it with `aria-describedby`.
 */

export type FieldControl<TValue> = ReturnType<typeof useFieldControl<TValue>>

/** The parts of a control that do not depend on its value type. */
export type ControlIds = Pick<
  FieldControl<unknown>,
  'name' | 'inputId' | 'helpId' | 'errorId' | 'message' | 'invalid'
>

/** Props every field component takes. */
export type BaseFieldProps = {
  label: string
  helpText?: ReactNode
  /** Default false: the label then gets "(optional)". When true the control gets `aria-required`. */
  required?: boolean
  disabled?: boolean
  className?: string
}

/** The control is disabled when asked to and while the form is submitting (07 section 2.4). */
export function useFieldDisabled(
  control: { field: { form: AnyFormApi } },
  disabled?: boolean,
): boolean {
  const submitting = useStore(control.field.form.store, (state) => state.isSubmitting)
  return Boolean(disabled) || submitting
}

/** Ids derived from the control's ids, for labels of groups and sub-controls. */
export function subId(control: ControlIds, part: string): string {
  return `${control.inputId}-${part}`
}

export type AriaProps = {
  'aria-invalid'?: boolean
  'aria-required'?: boolean
  'aria-describedby'?: string
}

/** The ARIA attributes of the main control of a field. */
export function ariaFor(
  control: Pick<ControlIds, 'helpId' | 'errorId' | 'invalid'>,
  options: { required?: boolean; hasHelp?: boolean; extraDescribedBy?: string } = {},
): AriaProps {
  const ids = [describedBy(control, Boolean(options.hasHelp)), options.extraDescribedBy]
    .filter(Boolean)
    .join(' ')
  return {
    'aria-invalid': control.invalid || undefined,
    'aria-required': options.required || undefined,
    'aria-describedby': ids || undefined,
  }
}

/**
 * A callback ref that puts `name` on an element whose component does not forward it (Radix
 * checkboxes, switches and radios render a `<button>`), so `focusField()` can find the control.
 */
export function useNameRef(name: string | undefined) {
  return useCallback(
    (element: HTMLElement | null) => {
      if (!element) return
      if (name) element.setAttribute('name', name)
      else element.removeAttribute('name')
    },
    [name],
  )
}

export function OptionalMark({ required }: { required?: boolean }) {
  const { t } = useTranslation('common')
  if (required) return null
  return <span className="font-normal text-muted-foreground">{t('common:optional')}</span>
}

/** How much is written of what fits ("120 / 300"), or what is wrong with it. */
export function CharCount({
  id,
  over = false,
  children,
}: {
  id?: string
  over?: boolean
  children: ReactNode
}) {
  return (
    <p
      id={id}
      className={cn(
        'text-end text-caption tabular-nums',
        over ? 'font-semibold text-danger' : 'text-muted-foreground',
      )}
    >
      {children}
    </p>
  )
}

export function FieldHelp({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={id} className="text-caption text-muted-foreground">
      {children}
    </div>
  )
}

export function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null
  return (
    <p id={id} className="flex items-start gap-2 text-caption font-semibold text-danger">
      <CircleAlert aria-hidden="true" className="mt-[0.2em] size-4" />
      <span className="min-w-0">{message}</span>
    </p>
  )
}

type FieldShellProps = {
  control: ControlIds
  label: ReactNode
  helpText?: ReactNode
  required?: boolean
  className?: string
  children: ReactNode
  /**
   * - `label` (default): a `<label htmlFor>` for one native control with id `control.inputId`.
   * - `group`: a text label with id `subId(control, 'label')`; the group control points at it
   *   with `aria-labelledby` (radio groups, segmented controls).
   * - `fieldset`: a `<fieldset>` with a `<legend>`, for fields made of several controls.
   */
  kind?: 'label' | 'group' | 'fieldset'
  /** Overrides the error message (for example a local "Enter a real date."). */
  message?: string
  /** Hides the label visually; it stays available to screen readers. */
  labelHidden?: boolean
}

/** Label, help text, the control and its error, in that order. */
export function FieldShell({
  control,
  label,
  helpText,
  required = false,
  className,
  children,
  kind = 'label',
  message,
  labelHidden = false,
}: FieldShellProps) {
  const labelClass = cn(
    'flex max-w-full flex-wrap items-center gap-x-2 text-label-lg text-foreground',
    labelHidden && 'sr-only',
  )
  const labelContent = (
    <>
      {label}
      {required ? null : ' '}
      <OptionalMark required={required} />
    </>
  )
  const help = helpText ? <FieldHelp id={control.helpId}>{helpText}</FieldHelp> : null
  const error = <FieldError id={control.errorId} message={message ?? control.message} />

  if (kind === 'fieldset') {
    return (
      <fieldset className={cn('field-stack min-w-0', className)}>
        <legend className={cn('mb-2 p-0', labelClass)}>{labelContent}</legend>
        {help}
        {children}
        {error}
      </fieldset>
    )
  }

  return (
    <div className={cn('field-stack', className)}>
      {kind === 'label' ? (
        <Label htmlFor={control.inputId} className={labelClass}>
          {labelContent}
        </Label>
      ) : (
        <div id={subId(control, 'label')} className={labelClass}>
          {labelContent}
        </div>
      )}
      {help}
      {children}
      {error}
    </div>
  )
}
