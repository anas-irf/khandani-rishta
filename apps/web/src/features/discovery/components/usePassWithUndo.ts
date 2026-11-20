import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { usePass, useUndoPass } from '~/features/relations/queries'

/** How long the "Undo" of a pass is offered (16 section 6.4). */
export const UNDO_MS = 5000

/**
 * "Not interested" on a card (16 section 6.4): `PUT /v1/passes/{profile_id}`, optimistic (G7).
 * The card leaves the lists at once and a toast "Hidden. Undo" stays for 5 seconds; "Undo" calls
 * `DELETE /v1/passes/{profile_id}` and the lists are refetched, which restores the card. On
 * failure the card comes back and the global handler shows the generic toast.
 */
export function usePassWithUndo() {
  const { t } = useTranslation('discovery')
  const pass = usePass()
  const undo = useUndoPass()

  return (profileId: string, options: { message?: string; onPassed?: () => void } = {}) => {
    const toastId = toast(options.message ?? t('card.hidden'), {
      duration: UNDO_MS,
      action: {
        label: t('card.undo'),
        onClick: () => undo.mutate(profileId),
      },
    })
    pass.mutate(profileId, {
      onSuccess: () => options.onPassed?.(),
      onError: () => toast.dismiss(toastId),
    })
  }
}
