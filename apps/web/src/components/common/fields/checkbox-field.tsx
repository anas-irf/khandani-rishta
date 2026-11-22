import type { ComponentProps, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useFieldControl } from '~/lib/form-context'
import { cn } from '~/lib/utils'
import { CheckboxLine } from '../CheckboxLine'
import { inlineLinkClass } from '../TextLink'
import {
  ariaFor,
  type BaseFieldProps,
  FieldError,
  FieldHelp,
  OptionalMark,
  useFieldDisabled,
  useNameRef,
} from './field-shell'

type CheckboxRowProps = Omit<BaseFieldProps, 'label'> & {
  label: ReactNode
  showOptional: boolean
}

function CheckboxRow({
  label,
  helpText,
  required = false,
  disabled,
  className,
  showOptional,
}: CheckboxRowProps) {
  const control = useFieldControl<boolean>()
  const isDisabled = useFieldDisabled(control, disabled)
  const nameRef = useNameRef(control.name)
  return (
    <div className={cn('grid gap-1', className)}>
      <CheckboxLine
        id={control.inputId}
        ref={nameRef}
        checked={control.value === true}
        onCheckedChange={(checked) => control.setValue(checked === true)}
        onBlur={control.onBlur}
        disabled={isDisabled}
        {...ariaFor(control, { required, hasHelp: Boolean(helpText) })}
        label={
          <>
            {label}
            {showOptional ? (
              <>
                {' '}
                <OptionalMark required={required} />
              </>
            ) : null}
          </>
        }
      />
      <div className="grid gap-1 ps-[calc(26px+0.75rem)]">
        {helpText ? <FieldHelp id={control.helpId}>{helpText}</FieldHelp> : null}
        <FieldError id={control.errorId} message={control.message} />
      </div>
    </div>
  )
}

/**
 * A single yes or no choice. Value `boolean`. A checkbox always has a value, so its label never
 * shows "(optional)"; `required` only sets `aria-required` (the box must be ticked).
 */
export function CheckboxField(props: BaseFieldProps) {
  return <CheckboxRow {...props} showOptional={false} />
}

export type ConsentCheckboxProps = Omit<BaseFieldProps, 'label'> & {
  /** May contain links: use `ConsentLink` so they open in a new tab. */
  label: ReactNode
}

/**
 * A consent checkbox whose label contains links (17 section 8.2). Value `boolean`. Optional
 * consents show "(optional)"; required ones set `aria-required`.
 */
export function ConsentCheckbox(props: ConsentCheckboxProps) {
  return <CheckboxRow {...props} showOptional />
}

/** A link inside a consent label: opens in a new tab, says so to screen readers. */
export function ConsentLink({
  children,
  className,
  ...props
}: Omit<ComponentProps<'a'>, 'target' | 'rel'>) {
  const { t } = useTranslation('fields')
  return (
    <a
      {...props}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(inlineLinkClass, className)}
    >
      {children}
      <span className="sr-only"> {t('fields:new_tab')}</span>
    </a>
  )
}
