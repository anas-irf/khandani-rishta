// ME-PREFS (16 section 6.20)
import { useBlocker } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConfirmDialog } from '~/components/common/ConfirmDialog'
import { Page } from '~/components/common/Page'
import { useGoBack } from '~/components/common/PageHeader'
import { Button } from '~/components/ui/button'
import { PreferencesForm } from '~/features/preferences/PreferencesForm'

/**
 * Edit the partner preferences with the form of 07 section 11. Save shows "Preferences saved.
 * Your matches are being updated." and goes back; leaving with unsaved input asks first.
 */
export function MePreferencesScreen() {
  const { t } = useTranslation('me')
  const goBack = useGoBack('/me')
  const [dirty, setDirty] = useState(false)
  const leaving = useRef(false)

  const blocker = useBlocker({
    shouldBlockFn: () => dirty && !leaving.current,
    enableBeforeUnload: () => dirty && !leaving.current,
    withResolver: true,
  })

  return (
    <Page title={t('prefs.title')} description={t('prefs.intro')} showBack width="form">
      <PreferencesForm
        mode="edit"
        onDirtyChange={setDirty}
        onSaved={() => {
          leaving.current = true
          toast.success(t('prefs.saved'))
          goBack()
        }}
        footer={
          <Button type="button" variant="quiet" fill="phone" onClick={goBack}>
            {t('contacts.cancel')}
          </Button>
        }
      />
      <ConfirmDialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => {
          if (!open && blocker.status === 'blocked') blocker.reset()
        }}
        title={t('discard.title')}
        description={t('discard.body')}
        confirmLabel={t('discard.discard')}
        cancelLabel={t('discard.keep')}
        tone="danger"
        onConfirm={() => {
          if (blocker.status === 'blocked') blocker.proceed()
        }}
      />
    </Page>
  )
}
