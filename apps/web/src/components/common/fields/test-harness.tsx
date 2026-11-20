import { type ReactNode, useState } from 'react'
import type { z } from 'zod'
import { ApiError, type ClientFieldError } from '~/lib/api'
import { focusFirstInvalid, useAppForm } from '~/lib/form'
import { applyServerErrors } from '~/lib/form-context'

/**
 * Test-only form around field components: a Zod schema checked on submit, a button that
 * applies `validation_failed` field errors with `applyServerErrors`, and the current values as
 * JSON in `<output data-testid="values">`.
 */

type Values = Record<string, unknown>

function useHarnessForm(
  initial: Values,
  schema: z.ZodType | undefined,
  onSubmit: ((values: Values) => unknown) | undefined,
) {
  return useAppForm({
    defaultValues: initial,
    validators: schema ? { onSubmit: schema as never } : undefined,
    onSubmitInvalid: focusFirstInvalid,
    onSubmit: async ({ value }) => {
      await onSubmit?.(value)
    },
  })
}

export type HarnessForm = ReturnType<typeof useHarnessForm>

export type HarnessProps = {
  initial: Values
  schema?: z.ZodType
  onSubmit?: (values: Values) => unknown
  /** Field errors applied by the "Apply server errors" button. */
  serverErrors?: ClientFieldError[]
  children: (form: HarnessForm) => ReactNode
}

export function Harness({ initial, schema, onSubmit, serverErrors = [], children }: HarnessProps) {
  const form = useHarnessForm(initial, schema, onSubmit)
  const [unmatched, setUnmatched] = useState<ClientFieldError[]>([])
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <form.AppForm>
        <form.FormErrorSummary serverErrors={unmatched} />
      </form.AppForm>
      {children(form)}
      <form.AppForm>
        <form.SubmitButton label="Save" />
      </form.AppForm>
      <button
        type="button"
        onClick={() =>
          setUnmatched(
            applyServerErrors(
              form,
              new ApiError({
                status: 400,
                code: 'validation_failed',
                message: 'Invalid',
                fields: serverErrors,
              }),
            ),
          )
        }
      >
        Apply server errors
      </button>
      <form.Subscribe selector={(state) => state.values}>
        {(values) => <output data-testid="values">{JSON.stringify(values)}</output>}
      </form.Subscribe>
    </form>
  )
}

/** The values the harness shows. */
export function readValues(): Values {
  const output = document.querySelector('[data-testid="values"]')
  return JSON.parse(output?.textContent || '{}') as Values
}

/** The text of every element `element` points at with `aria-describedby`. */
export function describedText(element: Element): string {
  const ids = element.getAttribute('aria-describedby')?.split(/\s+/).filter(Boolean) ?? []
  return ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ')
}
