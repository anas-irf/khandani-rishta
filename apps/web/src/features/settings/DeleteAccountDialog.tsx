import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FieldError } from '~/components/common/fields/field-shell'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
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
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Textarea } from '~/components/ui/textarea'
import { isApiError } from '~/lib/api'
import type { Me } from '~/lib/api-types'
import { serverFieldMessage } from '~/lib/form-context'
import { useCurrentMe } from '~/lib/me'
import { useScheduleDeletion } from './queries'
import { formatLongDateInZone, purgeDateFromNow } from './zone-date'

const REASON_MAX = 300
const PHRASE = 'DELETE'

/**
 * The confirmation sheet of 06 section 9.5 and 16 section 6.27 step 2: the consequences, with
 * the dates computed from `Me.config.deletion_grace_days` (never a fixed 30), an optional reason
 * of at most 300 characters, and a field in which the member must type `DELETE`. Calls
 * `POST /v1/me/deletion`; the returned `Me` is put in the cache, which routes by its gate.
 */
export function DeleteAccountDialog({
  open,
  onOpenChange,
  onScheduled,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the returned `Me` after the deletion was scheduled. */
  onScheduled?: (me: Me) => void
}) {
  const { t } = useTranslation(['settings', 'common'])
  const me = useCurrentMe()
  const online = useOnlineStatus()
  const schedule = useScheduleDeletion()
  const reasonId = useId()
  const phraseId = useId()
  const [reason, setReason] = useState('')
  const [phrase, setPhrase] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const graceDays = me.config.deletion_grace_days
  const purgeDate = formatLongDateInZone(purgeDateFromNow(graceDays), me.user.timezone)
  const canDelete = phrase === PHRASE && online

  const close = (next: boolean) => {
    if (schedule.isPending) return
    if (!next) {
      setReason('')
      setPhrase('')
      setFieldErrors({})
    }
    onOpenChange(next)
  }

  const submit = async () => {
    if (!canDelete || schedule.isPending) return
    setFieldErrors({})
    try {
      const trimmed = reason.trim()
      const result = await schedule.mutateAsync({
        ...(trimmed ? { reason: trimmed } : {}),
        confirm: 'DELETE',
      })
      close(false)
      if (result) onScheduled?.(result)
    } catch (error) {
      if (isApiError(error) && error.code === 'validation_failed') {
        const messages: Record<string, string> = {}
        for (const fieldError of error.fields) {
          messages[fieldError.field] = serverFieldMessage('settings', fieldError)
        }
        setFieldErrors(messages)
      }
      // Other failures were announced by the global handler; the dialog stays open.
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={close}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('account.delete.confirm.title')}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <ul
              aria-label={t('account.delete.confirm.list_label')}
              className="bullet-list gap-2 text-foreground"
            >
              <li>{t('account.delete.confirm.hidden')}</li>
              <li>{t('account.delete.confirm.days', { days: graceDays })}</li>
              <li>{t('account.delete.confirm.purge', { date: purgeDate })}</li>
              <li>{t('account.delete.confirm.messages')}</li>
              <li>{t('account.delete.confirm.record')}</li>
              <li>{t('account.delete.confirm.break')}</li>
            </ul>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor={reasonId}>{t('account.delete.confirm.reason_label')}</Label>
          <Textarea
            id={reasonId}
            value={reason}
            maxLength={REASON_MAX}
            rows={3}
            aria-invalid={fieldErrors.reason ? true : undefined}
            onChange={(event) => setReason(event.target.value)}
          />
          {fieldErrors.reason ? (
            <div role="alert">
              <FieldError id={`${reasonId}-error`} message={fieldErrors.reason} />
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor={phraseId}>{t('account.delete.confirm.phrase_label')}</Label>
          <Input
            id={phraseId}
            value={phrase}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-invalid={fieldErrors.confirm ? true : undefined}
            onChange={(event) => setPhrase(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit()
            }}
          />
          {fieldErrors.confirm ? (
            <div role="alert">
              <FieldError id={`${phraseId}-error`} message={fieldErrors.confirm} />
            </div>
          ) : null}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={schedule.isPending}>
            {t('common:actions.cancel')}
          </AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={!canDelete}
            loading={schedule.isPending}
            onClick={() => void submit()}
          >
            {t('account.delete.confirm.button')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
