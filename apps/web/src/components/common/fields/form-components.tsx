import { useStore } from '@tanstack/react-form'
import { CircleAlert } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Button, type ButtonProps } from '~/components/ui/button'
import type { ApiFieldError } from '~/lib/api-types'
import { useFormContext } from '~/lib/form-context'

function subscribeOnline(callback: () => void) {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

/** `navigator.onLine`, kept up to date (16 rule G14). True on the server. */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  )
}

export type SubmitButtonProps = Omit<ButtonProps, 'type' | 'children' | 'loading' | 'asChild'> & {
  label: string
  /** Disabled while `navigator.onLine` is false (default true, 16 rule G14). */
  disabledWhenOffline?: boolean
}

/**
 * The form's submit button. Shows a spinner and is disabled while the form submits, so a second
 * submission is impossible (07 section 2.4); disabled while the form cannot be submitted and,
 * by default, while offline.
 */
export function SubmitButton({
  label,
  disabledWhenOffline = true,
  disabled,
  ...props
}: SubmitButtonProps) {
  const form = useFormContext()
  const isSubmitting = useStore(form.store, (state) => state.isSubmitting)
  const canSubmit = useStore(form.store, (state) => state.canSubmit)
  const online = useOnlineStatus()
  return (
    <Button
      {...props}
      type="submit"
      loading={isSubmitting}
      disabled={Boolean(disabled) || !canSubmit || (disabledWhenOffline && !online)}
    >
      {label}
    </Button>
  )
}

export type FormErrorSummaryProps = {
  /** Server field errors that match no field of the form (from `applyServerErrors`). */
  serverErrors?: (ApiFieldError | string)[]
  className?: string
}

/**
 * The box at the top of a form after a failed submit (07 section 2.4, 17 section 8.3): "Please
 * check the highlighted fields." and the server errors that belong to no field.
 */
export function FormErrorSummary({ serverErrors = [], className }: FormErrorSummaryProps) {
  const { t } = useTranslation('errors')
  const form = useFormContext()
  const attempted = useStore(form.store, (state) => state.submissionAttempts > 0)
  const isValid = useStore(form.store, (state) => state.isValid)
  const isSubmitting = useStore(form.store, (state) => state.isSubmitting)
  const show = serverErrors.length > 0 || (attempted && !isValid && !isSubmitting)
  if (!show) return null
  return (
    <Alert variant="danger" className={className}>
      <CircleAlert aria-hidden="true" />
      <AlertTitle>{t('errors:form_summary')}</AlertTitle>
      {serverErrors.length > 0 ? (
        <AlertDescription>
          <ul className="list-disc ps-5">
            {serverErrors.map((error) => {
              const text = typeof error === 'string' ? error : error.message
              const key = typeof error === 'string' ? error : `${error.field}:${error.code}`
              return <li key={key}>{text}</li>
            })}
          </ul>
        </AlertDescription>
      ) : null}
    </Alert>
  )
}
