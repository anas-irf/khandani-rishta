import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { usePass, useUndoPass } from '~/features/relations/queries'

/** How long the "Undo" of a pass is offered on the profile (11 section 12). */
export const UNDO_MS = 5000

/**
 * "Not interested" on `APP-PROFILE` (16 section 6.7): `PUT /v1/passes/{profile_id}`, optimistic
 * (G7), with a toast whose "Undo" stays for 5 seconds and calls `DELETE`. On failure the global
 * handler shows the generic toast. Lists keep a panel instead: `usePassInPlace`.
 */
export function usePassWithUndo() {
  const { t } = useTranslation('discovery')
  const pass = usePass()
  const undo = useUndoPass()

  return (profileId: string, options: { message: string; onPassed?: () => void }) => {
    const toastId = toast(options.message, {
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
