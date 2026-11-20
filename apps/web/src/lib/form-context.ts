import { createFormHookContexts } from '@tanstack/react-form'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { ApiError } from './api'
import type { ApiFieldError } from './api-types'
import { i18n } from './i18n'

/**
 * Form plumbing shared by the field components (17 section 8). Forms are built with
 * `useAppForm` from `lib/form.ts`; field components read their field through
 * `useFieldControl()`.
 */
export const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts()

/** Turns one error from TanStack Form (a string or a Standard Schema issue) into text. */
export function errorText(error: unknown): string | undefined {
  if (error == null || error === false) return undefined
  const raw =
    typeof error === 'string'
      ? error
      : typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : undefined
  if (!raw) return undefined
  // Client schemas use i18n keys as messages; server messages arrive already translated.
  return i18n.t(raw, { defaultValue: raw })
}

/**
 * Everything a field component needs: ids for label, help and error text, the value, a
 * change handler that also clears a server error, and the message to show.
 */
export function useFieldControl<TValue>() {
  const field = useFieldContext<TValue>()
  const id = useId()
  useTranslation()
  const meta = field.state.meta
  const attempted = field.form.state.submissionAttempts > 0
  const serverError = meta.errorMap.onServer
  const visible = meta.isTouched || attempted || serverError != null
  const message = visible ? errorText(meta.errors.find((error) => error != null)) : undefined

  return {
    field,
    name: field.name,
    value: field.state.value,
    inputId: `${id}-input`,
    helpId: `${id}-help`,
    errorId: `${id}-error`,
    message,
    invalid: Boolean(message),
    setValue(next: TValue) {
      if (field.state.meta.errorMap.onServer != null) {
        field.setMeta((previous) => ({
          ...previous,
          errorMap: { ...previous.errorMap, onServer: undefined },
        }))
      }
      field.handleChange(next as Parameters<typeof field.handleChange>[0])
    },
    onBlur: () => field.handleBlur(),
  }
}

/** `aria-describedby` for a field: its help text and its error, when present. */
export function describedBy(
  control: { helpId: string; errorId: string; invalid: boolean },
  hasHelp: boolean,
) {
  const ids = [hasHelp ? control.helpId : null, control.invalid ? control.errorId : null]
  return ids.filter(Boolean).join(' ') || undefined
}

/**
 * The translated message for a server field error (17 section 8.3): the screen's own text for
 * that field and code when it has one (`<ns>:errors.<field>.<code>`), then the generic text for
 * the code (`errors:field.<code>`), then the API's message.
 */
export function serverFieldMessage(namespace: string | null, error: ApiFieldError): string {
  const keys = [
    namespace ? `${namespace}:errors.${error.field}.${error.code}` : null,
    `errors:field.${error.code}`,
  ].filter((key): key is string => Boolean(key))
  for (const key of keys) {
    if (i18n.exists(key)) return i18n.t(key)
  }
  return error.message
}

type FormLike = {
  getFieldInfo: (name: never) => unknown
  setFieldMeta: (name: never, updater: (meta: never) => unknown) => void
  fieldInfo: Record<string, unknown>
}

/**
 * Shows a `validation_failed` error on a form (17 section 8.3): each `fields[i]` goes to the
 * form field of the same name; the rest are returned for a summary box at the top. Focus moves
 * to the first invalid field. `aliases` maps API field keys to form field names when they differ.
 */
export function applyServerErrors(
  form: unknown,
  error: ApiError,
  options: { namespace?: string | null; aliases?: Record<string, string> } = {},
): ApiFieldError[] {
  const target = form as FormLike
  const unmatched: ApiFieldError[] = []
  let first: string | null = null
  for (const fieldError of error.fields) {
    const name = options.aliases?.[fieldError.field] ?? fieldError.field
    if (!(name in target.fieldInfo)) {
      unmatched.push(fieldError)
      continue
    }
    const message = serverFieldMessage(options.namespace ?? null, fieldError)
    target.setFieldMeta(
      name as never,
      ((meta: Record<string, unknown>) => ({
        ...meta,
        isTouched: true,
        errorMap: { ...(meta.errorMap as Record<string, unknown>), onServer: message },
      })) as never,
    )
    first ??= name
  }
  if (first) focusField(first)
  return unmatched
}

/** Scrolls to and focuses the control of a field, found by its `name` attribute. */
export function focusField(name: string) {
  if (typeof document === 'undefined') return
  requestAnimationFrame(() => {
    const element = document.querySelector<HTMLElement>(`[name="${CSS.escape(name)}"]`)
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    element?.focus({ preventScroll: true })
  })
}
