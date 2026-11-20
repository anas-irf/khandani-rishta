import { revalidateLogic, useStore } from '@tanstack/react-form'
import { CircleAlert } from 'lucide-react'
import {
  type ComponentType,
  createContext,
  type FormEvent,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { z } from 'zod'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { ApiError, isApiError } from '~/lib/api'
import type { ApiFieldError } from '~/lib/api-types'
import { focusFirstInvalid, useAppForm } from '~/lib/form'
import { applyServerErrors } from '~/lib/form-context'
import { reportError } from '~/lib/monitoring'
import { track } from '~/lib/track'
import type { FormMode } from './schemas'

/**
 * The plumbing shared by the section forms, the preferences form and the identity form:
 * validation (Zod, re-run on every change after the first submit), the save pipeline of
 * 07 section 2.4 (steps 3 and 4), server errors mapped with `applyServerErrors` and a summary
 * at the top, an inline "Try again" for network and server failures (08 section 2.5, 07 16.9),
 * and a context that lets a footer (onboarding's Skip and Back, ME-EDIT's Cancel) read the
 * dirty state and trigger a submit.
 */

export type FormControls = {
  mode: FormMode
  /** Whether the member changed anything since the form was filled. */
  isDirty: boolean
  /** True while the save (and the onboarding continue) runs. */
  isSubmitting: boolean
  /** Runs the normal submit: validation, save, then `onSaved`. */
  submit: () => Promise<void>
}

const FormControlsContext = createContext<FormControls | null>(null)

/** Provides `FormControls` around content that is not a managed form (a read-only step). */
export const FormControlsProvider = FormControlsContext.Provider

/** The controls of the surrounding form, for components rendered in its `footer`. */
export function useFormControls(): FormControls {
  const controls = useContext(FormControlsContext)
  if (!controls) throw new Error('useFormControls() must be used inside a section form')
  return controls
}

/** A ref that always holds the latest value (read lazily by schemas and handlers). */
export function useLatest<T>(value: T) {
  const ref = useRef(value)
  ref.current = value
  return ref
}

const FAILURE_CODES = new Set(['internal_error', 'service_unavailable', 'network_error'])

export type ManagedFormOptions<V> = {
  /** i18n namespace of the field messages (`<ns>:errors.<field>.<code>`). */
  namespace: string
  mode: FormMode
  /** Onboarding step key for the funnel event `onboarding_validation_failed` (07 17). */
  step?: string
  defaultValues: V
  schema: z.ZodType<V>
  /** Saves; throws an `ApiError` on failure. */
  submit: (values: V) => Promise<unknown>
  /** API field keys that belong to a differently named form field. */
  aliases?: Record<string, string>
  /** Adjusts API errors before they are shown (for example, messages chosen by the API). */
  rewrite?: (error: ApiFieldError) => ApiFieldError
  /** Field errors to show when the form opens (a failed completion, 07 section 14.2). */
  initialErrors?: ApiFieldError[]
  onDirtyChange?: (dirty: boolean) => void
}

/** Builds the form and the state of the shell around it. */
export function useManagedForm<V extends object>(options: ManagedFormOptions<V>) {
  const latest = useRef(options)
  latest.current = options
  const [unmatched, setUnmatched] = useState<ApiFieldError[]>([])
  const [failure, setFailure] = useState<unknown>(null)

  const form = useAppForm({
    defaultValues: options.defaultValues,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: options.schema },
    onSubmitInvalid: focusFirstInvalid,
    onSubmit: async ({ value }) => {
      setUnmatched([])
      setFailure(null)
      try {
        await latest.current.submit(value)
      } catch (error) {
        handleError(error)
      }
    },
  })

  function showFieldErrors(fields: ApiFieldError[]) {
    const { namespace, aliases, rewrite } = latest.current
    const shown = new ApiError({
      status: 400,
      code: 'validation_failed',
      message: '',
      fields: rewrite ? fields.map(rewrite) : fields,
    })
    setUnmatched(applyServerErrors(form, shown, { namespace, aliases }))
  }

  function handleError(error: unknown) {
    if (isApiError(error) && error.code === 'validation_failed') {
      showFieldErrors(error.fields)
      const { mode, step } = latest.current
      if (mode === 'onboarding' && step) {
        track('onboarding_validation_failed', {
          step,
          fields: error.fields.map((field) => field.field).join(','),
          codes: error.fields.map((field) => field.code).join(','),
        })
      }
      return
    }
    if (!isApiError(error) || FAILURE_CODES.has(error.code)) {
      if (!isApiError(error) || error.code !== 'network_error') reportError(error)
      setFailure(error)
    }
    // Every other code was handled by the global handler (gate codes, rate limits).
  }

  // Errors handed over by another screen are shown once the fields are mounted.
  const initial = useRef(options.initialErrors)
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once after the first render.
  useEffect(() => {
    if (initial.current?.length) showFieldErrors(initial.current)
  }, [])

  const isDirty = useStore(form.store, (state) => state.isDirty)
  const isSubmitting = useStore(form.store, (state) => state.isSubmitting)
  useEffect(() => {
    latest.current.onDirtyChange?.(isDirty)
  }, [isDirty])

  const controls = useMemo<FormControls>(
    () => ({
      mode: options.mode,
      isDirty,
      isSubmitting,
      submit: () => form.handleSubmit(),
    }),
    [options.mode, isDirty, isSubmitting, form],
  )

  return { form, unmatched, failure, controls, showFieldErrors, handleError }
}

type ShellForm = {
  handleSubmit: () => Promise<void>
  AppForm: ComponentType<{ children?: ReactNode }>
  SubmitButton: ComponentType<{ label: string; className?: string; disabled?: boolean }>
  FormErrorSummary: ComponentType<{ serverErrors?: ApiFieldError[]; className?: string }>
}

/** The form element: summary, fields, inline failure, the submit button, then the footer. */
export function FormShell({
  form,
  controls,
  unmatched,
  failure,
  submitLabel,
  footer,
  failureText,
  children,
  label,
  submitDisabled,
}: {
  form: ShellForm
  controls: FormControls
  unmatched: ApiFieldError[]
  failure: unknown
  submitLabel: string
  footer?: ReactNode
  /** The text of the inline failure (07 16.9 during onboarding). */
  failureText: string
  children: ReactNode
  /** Accessible name of the form. */
  label?: string
  /** Keeps the submit button disabled (for example until a number is complete). */
  submitDisabled?: boolean
}) {
  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    event.stopPropagation()
    void form.handleSubmit()
  }
  return (
    <FormControlsContext.Provider value={controls}>
      <form noValidate aria-label={label} onSubmit={onSubmit} className="flex flex-col gap-6">
        <form.AppForm>
          <form.FormErrorSummary serverErrors={unmatched} />
        </form.AppForm>
        {children}
        {failure ? (
          <InlineFailure
            error={failure}
            text={failureText}
            onRetry={() => void form.handleSubmit()}
            retrying={controls.isSubmitting}
          />
        ) : null}
        <div className="flex flex-col gap-3">
          <form.AppForm>
            <form.SubmitButton
              label={submitLabel}
              disabled={submitDisabled}
              className="w-full md:w-auto md:self-start"
            />
          </form.AppForm>
          {footer}
        </div>
      </form>
    </FormControlsContext.Provider>
  )
}

/** "Something went wrong..." with "Try again" and the request id (07 16.9, 08 2.5). */
export function InlineFailure({
  error,
  text,
  onRetry,
  retrying,
}: {
  error: unknown
  text: string
  onRetry: () => void
  retrying?: boolean
}) {
  const { t } = useTranslation('profile_sections')
  const requestId = isApiError(error) ? error.requestId : null
  return (
    <Alert variant="danger">
      <CircleAlert aria-hidden="true" />
      <AlertDescription className="flex flex-col items-start gap-2">
        <span>{text}</span>
        <Button type="button" variant="outline" onClick={onRetry} loading={retrying}>
          {t('form.try_again')}
        </Button>
        {requestId ? (
          <span className="text-sm text-muted-foreground">
            {t('form.reference', { id: requestId })}
          </span>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}

/** A group of fields with a heading (07 sections 8 and 9). */
export function FieldGroup({
  title,
  help,
  children,
}: {
  title: string
  help?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-5">
      <h3 className="text-base font-semibold">{title}</h3>
      {children}
      {help ? <p className="text-sm text-muted-foreground">{help}</p> : null}
    </section>
  )
}
