import { createStore } from './store'

/**
 * Dialogs opened from outside React components, such as the global error handler
 * (17 section 6.4). `GlobalDialogs` renders them.
 */
export type LimitDialogState = {
  /** i18n key of the text for the action, or null for the default text (16 section 1.3). */
  textKey: string | null
  details: Record<string, unknown>
}

export const limitDialogStore = createStore<LimitDialogState | null>(null)

export function showLimitDialog(state: LimitDialogState) {
  limitDialogStore.set(state)
}

export function closeLimitDialog() {
  limitDialogStore.set(null)
}
