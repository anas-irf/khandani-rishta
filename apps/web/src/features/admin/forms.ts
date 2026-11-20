import type { TFunction } from 'i18next'
import { z } from 'zod'
import { isApiError } from '~/lib/api'
import { serverFieldMessage } from '~/lib/form-context'

/**
 * Small form helpers for the staff console: Zod validation with translated messages, and the
 * mapping of `validation_failed` fields (15 section 2) onto inputs. A Zod message is a code with
 * optional arguments, `too_short:10` or `out_of_range:1:365`, translated from `admin:validation`.
 */

export type FieldMessages = Record<string, string>

/** A string of `min` to `max` characters after trimming (`min` 0 allows an empty string). */
export function boundedText(min: number, max: number) {
  return z
    .string()
    .trim()
    .refine((value) => min === 0 || value.length > 0, { message: 'required' })
    .refine((value) => value.length === 0 || value.length >= min, { message: `too_short:${min}` })
    .refine((value) => value.length <= max, { message: `too_long:${max}` })
}

/** An integer from `min` to `max`. */
export function boundedInt(min: number, max: number) {
  return z
    .number({ error: 'required' })
    .refine((value) => Number.isInteger(value), { message: 'invalid' })
    .refine((value) => value >= min && value <= max, { message: `out_of_range:${min}:${max}` })
}

function translateCode(t: TFunction, message: string): string {
  const [code = 'invalid', ...args] = message.split(':')
  // An address argument contains colons itself (`url_prefix:https://download.`).
  const [first, second] = code === 'url_prefix' ? [args.join(':')] : args
  return t(`validation.${code}`, { min: first, max: second ?? first, defaultValue: message })
}

/** Validates `value`; on failure returns one translated message per field (the first issue). */
export function validate<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
  t: TFunction,
): { ok: true; data: z.infer<TSchema> } | { ok: false; errors: FieldMessages } {
  const result = schema.safeParse(value)
  if (result.success) return { ok: true, data: result.data }
  const errors: FieldMessages = {}
  for (const issue of result.error.issues) {
    const field = String(issue.path[0] ?? '_')
    if (errors[field]) continue
    errors[field] = translateCode(t, issue.message)
  }
  return { ok: false, errors }
}

/**
 * Field errors of a `validation_failed` response, keyed by form field (`aliases` renames API
 * fields). Errors that match no field come back in `rest`.
 */
export function serverFieldErrors(
  error: unknown,
  knownFields: readonly string[],
  aliases: Record<string, string> = {},
): { fields: FieldMessages; rest: string[] } {
  const fields: FieldMessages = {}
  const rest: string[] = []
  if (!isApiError(error) || error.code !== 'validation_failed') return { fields, rest }
  for (const fieldError of error.fields) {
    const name = aliases[fieldError.field] ?? fieldError.field
    const message = serverFieldMessage('admin', fieldError)
    if (knownFields.includes(name)) fields[name] = message
    else rest.push(message)
  }
  return { fields, rest }
}

/** `id` and `aria-*` attributes of a labelled control with an optional hint and error. */
export function describeField(id: string, options: { hint?: boolean; error?: string }) {
  const ids = [options.hint ? `${id}-hint` : null, options.error ? `${id}-error` : null]
  return {
    id,
    'aria-invalid': options.error ? true : undefined,
    'aria-describedby': ids.filter(Boolean).join(' ') || undefined,
  }
}
