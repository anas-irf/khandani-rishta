import type { ApiFieldError } from '~/lib/api-types'
import { createStore } from '~/lib/store'

/**
 * Field errors of a failed completion (07 section 14.2), handed from ONB-11 to the step that
 * owns them, which shows them when it opens in edit mode.
 */
type Pending = { step: string; fields: ApiFieldError[] } | null

const store = createStore<Pending>(null)

export function setCompletionErrors(step: string, fields: ApiFieldError[]) {
  store.set({ step, fields })
}

/** Returns the errors for `step` once and forgets them. */
export function takeCompletionErrors(step: string): ApiFieldError[] | undefined {
  const pending = store.get()
  if (!pending || pending.step !== step) return undefined
  store.set(null)
  return pending.fields
}
