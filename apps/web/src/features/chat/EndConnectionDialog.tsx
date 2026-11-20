import { type FormEvent, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useOnlineStatus } from '~/components/common/OfflineBanner'
import { ReportDialog } from '~/components/common/ReportDialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Label } from '~/components/ui/label'
import { RadioGroup, RadioGroupItem } from '~/components/ui/radio-group'
import type { Connection, EndConnectionReason } from '~/lib/api-types'
import { useOptions } from '~/lib/reference'
import { useEndConnection } from './queries'
import { otherName } from './text'

/** Reasons only the system sets; the member never chooses them (05 section 2.41). */
const SYSTEM_REASONS: ReadonlySet<string> = new Set(['blocked', 'account_closed'])

/**
 * "End this connection?" (16 section 6.12): a required reason, "Also block {name}" (ticked
 * automatically for inappropriate behaviour), then `POST .../end`. After ending for
 * inappropriate behaviour the member is offered to report the other member.
 */
export function EndConnectionDialog({
  connection,
  open,
  onOpenChange,
  onEnded,
}: {
  connection: Connection
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Runs once the flow is over (the screen returns to `APP-CHATS`). */
  onEnded: () => void
}) {
  const { t } = useTranslation('chat')
  const [offerReport, setOfferReport] = useState(false)
  const [reporting, setReporting] = useState(false)
  const name = otherName(t, connection)

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        {open ? (
          <EndForm
            connection={connection}
            name={name}
            onClose={() => onOpenChange(false)}
            onDone={(reason) => {
              onOpenChange(false)
              if (reason === 'inappropriate_behaviour' && connection.other) setOfferReport(true)
              else onEnded()
            }}
          />
        ) : null}
      </Dialog>
      <AlertDialog open={offerReport} onOpenChange={setOfferReport}>
        <AlertDialogContent aria-describedby={undefined}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('end.report_offer', { name })}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={onEnded}>{t('end.no')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setOfferReport(false)
                setReporting(true)
              }}
            >
              {t('end.report')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {connection.other ? (
        <ReportDialog
          open={reporting}
          onOpenChange={(next) => {
            setReporting(next)
            if (!next) onEnded()
          }}
          profileId={connection.other.id}
          name={name}
          onBlocked={onEnded}
        />
      ) : null}
    </>
  )
}

function EndForm({
  connection,
  name,
  onClose,
  onDone,
}: {
  connection: Connection
  name: string
  onClose: () => void
  onDone: (reason: EndConnectionReason) => void
}) {
  const { t } = useTranslation(['chat', 'common'])
  const options = useOptions('connection_end_reason').filter(
    (option) => !SYSTEM_REASONS.has(option.code),
  )
  const end = useEndConnection()
  const online = useOnlineStatus()
  const ids = { legend: useId(), error: useId(), text: useId() }
  const [reason, setReason] = useState<EndConnectionReason | ''>('')
  const [alsoBlock, setAlsoBlock] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!reason) {
      setError(t('chat:end.reason_required'))
      return
    }
    try {
      await end.mutateAsync({ id: connection.id, reason, alsoBlock })
    } catch {
      return
    }
    toast.success(t('chat:end.success'))
    onDone(reason)
  }

  return (
    <DialogContent closeLabel={t('common:actions.close')} aria-describedby={ids.text}>
      <form onSubmit={(event) => void submit(event)} className="grid gap-4" noValidate>
        <DialogHeader>
          <DialogTitle>{t('chat:end.title')}</DialogTitle>
          <DialogDescription id={ids.text} className="text-base text-foreground">
            {t('chat:end.text', { name })}
          </DialogDescription>
        </DialogHeader>
        <fieldset className="grid gap-1" aria-describedby={error ? ids.error : undefined}>
          <legend id={ids.legend} className="mb-1 text-sm font-medium">
            {t('chat:end.reason_label')}
          </legend>
          <RadioGroup
            value={reason}
            onValueChange={(value) => {
              setReason(value as EndConnectionReason)
              setError(null)
              if (value === 'inappropriate_behaviour') setAlsoBlock(true)
            }}
            aria-labelledby={ids.legend}
            aria-required="true"
            aria-invalid={error ? true : undefined}
            className="gap-0"
          >
            {options.map((option) => (
              <Label
                key={option.code}
                className="min-h-11 cursor-pointer gap-3 rounded-[var(--radius-input)] px-1 font-normal text-base hover:bg-muted"
              >
                <RadioGroupItem value={option.code} />
                {t(`chat:end.reason.${option.code}`, { defaultValue: option.label })}
              </Label>
            ))}
          </RadioGroup>
          {error ? (
            <p id={ids.error} className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </fieldset>
        {connection.other ? (
          <Label className="min-h-11 cursor-pointer gap-3 font-normal text-base">
            <Checkbox
              checked={alsoBlock}
              onCheckedChange={(checked) => setAlsoBlock(checked === true)}
            />
            {t('chat:end.also_block', { name })}
          </Label>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={end.isPending}>
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" variant="destructive" loading={end.isPending} disabled={!online}>
            {t('chat:end.confirm')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
