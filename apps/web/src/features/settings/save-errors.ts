import { toast } from 'sonner'
import { isApiError } from '~/lib/api'
import { reportError } from '~/lib/monitoring'

/**
 * Settings that save by themselves show one text when a save fails: "Could not save. Please try
 * again." (16 sections 6.25 and 6.26). Their mutations list these codes in `meta.handles`, so the
 * global handler stays silent for them. Everything else (`rate_limited`, `cooldown_active`,
 * `limit_reached`, gate codes) keeps the global handling.
 */
export const SAVE_FAILURE_CODES = [
  'bad_request',
  'forbidden',
  'not_found',
  'invalid_state',
  'already_exists',
  'payload_too_large',
  'internal_error',
  'service_unavailable',
  'upgrade_required',
  'network_error',
] as const

const UNEXPECTED = new Set(['internal_error', 'service_unavailable', 'upgrade_required'])

/** Shows `message` for a failed save, unless the global handler has already told the member. */
export function toastSaveFailure(error: unknown, message: string) {
  if (!isApiError(error)) {
    reportError(error)
    toast.error(message)
    return
  }
  if (!(SAVE_FAILURE_CODES as readonly string[]).includes(error.code)) return
  if (UNEXPECTED.has(error.code)) reportError(error)
  toast.error(message, { id: 'settings-save-failed' })
}
