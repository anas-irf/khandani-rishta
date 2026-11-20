import { LimitDialog } from './LimitDialog'

/**
 * Dialogs opened from outside React (the global error handler, 17 section 6.4). Rendered once
 * by `AuthGate` inside the signed-in tree.
 */
export function GlobalDialogs() {
  return <LimitDialog />
}
