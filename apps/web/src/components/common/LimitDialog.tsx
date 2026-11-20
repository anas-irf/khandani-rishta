import { useQueryClient } from '@tanstack/react-query'
import { Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import type { Me } from '~/lib/api-types'
import { closeLimitDialog, type LimitDialogState, limitDialogStore } from '~/lib/dialogs'
import { formatDate, formatTime } from '~/lib/format'
import { qk } from '~/lib/query'
import { useStore } from '~/lib/store'

const DEFAULT_TEXT = 'errors:limit.default'

/** `ns:key` gives the namespace to load before the text can be shown. */
function namespaceOf(textKey: string): string {
  const index = textKey.indexOf(':')
  return index > 0 ? textKey.slice(0, index) : 'errors'
}

/**
 * The dialog for `limit_reached` (16 section 1.3, 17 section 6.4), opened by the global error
 * handler through `limitDialogStore`. The text is the action's own (the mutation's
 * `meta.limitText`) or the default "You have reached a limit for today...". `details.limit`,
 * `details.used` and `details.resets_at` (formatted) are available to the text, and so is
 * `support_email` from `Me.config`.
 */
export function LimitDialog() {
  const state = useStore(limitDialogStore)
  return (
    <AlertDialog
      open={state !== null}
      onOpenChange={(open) => {
        if (!open) closeLimitDialog()
      }}
    >
      {state ? (
        <Suspense fallback={null}>
          <LimitDialogContent state={state} />
        </Suspense>
      ) : null}
    </AlertDialog>
  )
}

function LimitDialogContent({ state }: { state: LimitDialogState }) {
  const textKey = state.textKey ?? DEFAULT_TEXT
  const { t } = useTranslation(['errors', namespaceOf(textKey)])
  const queryClient = useQueryClient()
  const supportEmail = queryClient.getQueryData<Me>(qk.me())?.config.support_email ?? ''

  const { limit, used, resets_at: resetsAt } = state.details
  const values = {
    limit: typeof limit === 'number' ? limit : '',
    used: typeof used === 'number' ? used : '',
    resets_at:
      typeof resetsAt === 'string' ? `${formatDate(resetsAt)} ${formatTime(resetsAt)}` : '',
    support_email: supportEmail,
  }
  const text = t(textKey, { ...values, defaultValue: t(DEFAULT_TEXT) })

  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{t('errors:limit.title')}</AlertDialogTitle>
        <AlertDialogDescription className="text-base text-foreground">
          {text}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogAction onClick={closeLimitDialog}>{t('errors:limit.ok')}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  )
}
