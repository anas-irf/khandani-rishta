import { LogOut } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '~/components/common/ConfirmDialog'
import { Button, type ButtonProps } from '~/components/ui/button'
import { useSignOut } from '~/features/auth/useSignOut'

/**
 * "Sign out" with its confirmation (16 rule G8 and section 6.27): "Sign out of Khandani
 * Rishta?" with "Sign out" and "Cancel". Confirming runs the steps of 06 section 10.1 through
 * `useSignOut()`: close the WebSocket, sign out of Clerk, clear the cache, open the landing page.
 */
export function SignOutButton({
  variant = 'secondary',
  className,
}: {
  variant?: ButtonProps['variant']
  className?: string
}) {
  const { t } = useTranslation('common')
  const signOut = useSignOut()
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button variant={variant} className={className} onClick={() => setOpen(true)}>
        <LogOut aria-hidden="true" className="rtl:-scale-x-100" />
        {t('actions.sign_out')}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('sign_out_dialog.title')}
        description={t('sign_out_dialog.body')}
        confirmLabel={t('actions.sign_out')}
        onConfirm={() => signOut()}
      />
    </>
  )
}
