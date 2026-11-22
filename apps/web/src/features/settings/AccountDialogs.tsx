import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '~/components/common/ConfirmDialog'
import { displayHeadingVariants } from '~/components/common/DisplayHeading'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { OrnamentRule } from '~/components/common/Ornament'
import { RadioCard } from '~/components/common/RadioCard'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { RadioGroup } from '~/components/ui/radio-group'
import type { CloseReason } from '~/lib/api-types'
import { useCurrentMe } from '~/lib/me'
import { useOptions } from '~/lib/reference'
import { DeleteAccountDialog } from './DeleteAccountDialog'
import { useCloseProfile, useNikahCheck, usePauseProfile, useReopenProfile } from './queries'

/** The dialogs of SET-ACCOUNT; at most one is open at a time. */
export type AccountDialog = 'pause' | 'close' | 'reopen' | 'gentle' | 'delete' | 'mubarak' | null

/** The status the profile must be in for each gentler option of the delete sheet (06 section 9.1). */
export function canPause(status: string): boolean {
  return status === 'active'
}
export function canClose(status: string): boolean {
  return status === 'active' || status === 'paused'
}

/**
 * Every dialog opened from SET-ACCOUNT: pause (08 section 7.1), close (7.3), reopen (7.4), the
 * gentler options before deleting (06 section 9.1), the deletion confirmation (9.5) and the
 * one-time "Mubarak" note after closing for a match found here.
 */
export function AccountDialogs({
  dialog,
  onDialogChange,
}: {
  dialog: AccountDialog
  onDialogChange: (dialog: AccountDialog) => void
}) {
  const close = () => onDialogChange(null)
  return (
    <>
      <PauseDialog open={dialog === 'pause'} onClose={close} />
      <CloseDialog
        open={dialog === 'close'}
        onClose={close}
        onMatchFoundHere={() => onDialogChange('mubarak')}
      />
      <ReopenDialog open={dialog === 'reopen'} onClose={close} />
      <GentleDialog
        open={dialog === 'gentle'}
        onClose={close}
        onChoose={(next) => onDialogChange(next)}
      />
      <DeleteAccountDialog
        open={dialog === 'delete'}
        onOpenChange={(open) => {
          if (!open) close()
        }}
      />
      <MubarakDialog open={dialog === 'mubarak'} onClose={close} />
    </>
  )
}

function PauseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('settings')
  const pause = usePauseProfile()
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={t('account.status.pause.title')}
      description={t('account.status.pause.body')}
      confirmLabel={t('account.status.pause.confirm')}
      tone="ink"
      onConfirm={() => pause.mutateAsync()}
    />
  )
}

function CloseDialog({
  open,
  onClose,
  onMatchFoundHere,
}: {
  open: boolean
  onClose: () => void
  onMatchFoundHere: () => void
}) {
  const { t } = useTranslation(['settings', 'common'])
  const reasons = useOptions('closed_reason')
  const online = useOnlineStatus()
  const closeProfile = useCloseProfile()
  const [reason, setReason] = useState<CloseReason | ''>('')

  const submit = async () => {
    if (!reason) return
    try {
      await closeProfile.mutateAsync(reason)
    } catch {
      // The global handler has shown the toast; the dialog stays open to try again.
      return
    }
    setReason('')
    if (reason === 'found_match_here') onMatchFoundHere()
    else onClose()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (closeProfile.isPending) return
        if (!next) {
          setReason('')
          onClose()
        }
      }}
    >
      <DialogContent closeLabel={t('common:actions.close')}>
        <DialogHeader>
          <DialogTitle>{t('account.status.close.title')}</DialogTitle>
          <DialogDescription>{t('account.status.close.body')}</DialogDescription>
        </DialogHeader>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-label-lg">{t('account.status.close.reason_label')}</legend>
          <RadioGroup
            aria-label={t('account.status.close.reason_label')}
            value={reason}
            onValueChange={(next) => setReason(next as CloseReason)}
          >
            {reasons.map((option) => (
              <RadioCard
                key={option.code}
                id={`close-reason-${option.code}`}
                value={option.code}
                label={option.label}
              />
            ))}
          </RadioGroup>
        </fieldset>
        <DialogFooter>
          <Button variant="secondary" disabled={closeProfile.isPending} onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={!reason || !online}
            loading={closeProfile.isPending}
            onClick={() => void submit()}
          >
            {t('account.status.close.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReopenDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('settings')
  const me = useCurrentMe()
  const reopen = useReopenProfile()
  // Loaded as soon as the screen shows a closed profile, so the right dialog opens at once.
  const nikah = useNikahCheck(me.profile.status === 'closed')
  const afterNikah = nikah.data != null

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={afterNikah ? t('account.status.reopen.nikah_title') : t('account.status.reopen.title')}
      description={
        afterNikah
          ? t('account.status.reopen.nikah_body', {
              name: nikah.data?.name ?? t('account.status.reopen.member_fallback'),
            })
          : t('account.status.reopen.body')
      }
      confirmLabel={t('account.status.reopen.confirm')}
      confirmPhrase={afterNikah ? 'REOPEN' : undefined}
      phraseLabel={afterNikah ? t('account.status.reopen.nikah_phrase') : undefined}
      onConfirm={() => reopen.mutateAsync()}
    />
  )
}

/** "Mubarak!" once, after closing because the match was found here (08 section 7.3). */
function MubarakDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation(['settings', 'common'])
  const navigate = useNavigate()
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <OrnamentRule />
          <AlertDialogTitle className={displayHeadingVariants({ size: 'sm' })}>
            {t('account.status.close.mubarak_title')}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-foreground">
            {t('account.status.close.mubarak')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common:actions.close')}</AlertDialogCancel>
          <Button
            onClick={() => {
              onClose()
              void navigate({ to: '/chats' })
            }}
          >
            {t('account.status.close.open_connections')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * The gentler options shown before the deletion confirmation (06 section 9.1): pause, close or
 * continue. Pause and close are offered only when the profile status allows them.
 */
function GentleDialog({
  open,
  onClose,
  onChoose,
}: {
  open: boolean
  onClose: () => void
  onChoose: (next: AccountDialog) => void
}) {
  const { t } = useTranslation(['settings', 'common'])
  const me = useCurrentMe()
  const status = me.profile.status
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('account.delete.gentle.title')}</AlertDialogTitle>
          <AlertDialogDescription className="text-foreground">
            {t('account.delete.gentle.text')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-2">
          {canPause(status) ? (
            <Button variant="secondary" onClick={() => onChoose('pause')}>
              {t('account.delete.gentle.pause')}
            </Button>
          ) : null}
          {canClose(status) ? (
            <Button variant="secondary" onClick={() => onChoose('close')}>
              {t('account.delete.gentle.close')}
            </Button>
          ) : null}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common:actions.cancel')}</AlertDialogCancel>
          <Button variant="destructive" onClick={() => onChoose('delete')}>
            {t('account.delete.gentle.continue')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
