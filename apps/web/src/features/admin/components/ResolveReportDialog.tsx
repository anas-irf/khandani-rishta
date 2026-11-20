import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { validate } from '../forms'
import { useResolveReport } from '../queries'
import { resolveReportSchema } from '../schemas'
import type { ReportOutcome } from '../types'
import { ActionDialog } from './ActionDialog'
import { CountedTextarea } from './FormField'
import { ErrorSummary, useDialogErrors } from './useDialogErrors'

/**
 * Resolves a report as actioned or dismissed with a staff-only note (18 section 4.5). From
 * `open` only "dismissed" is allowed. "Actioned" with no content removed and no sanction
 * recorded asks for a second confirmation.
 */
export function ResolveReportDialog({
  reportId,
  status,
  actionRecorded,
  onDone,
  onClose,
}: {
  reportId: string
  status: string
  /** A photo was rejected or a sanction applied from this screen. */
  actionRecorded: boolean
  onDone: (result: { outcome: ReportOutcome; note: string }) => void
  onClose: () => void
}) {
  const { t } = useTranslation('admin')
  const resolve = useResolveReport()
  const onlyDismiss = status === 'open'
  const [outcome, setOutcome] = useState<ReportOutcome | ''>(onlyDismiss ? 'dismissed' : '')
  const [note, setNote] = useState('')
  const [confirming, setConfirming] = useState(false)
  const form = useDialogErrors(['outcome', 'note'])

  const submit = async () => {
    const result = validate(resolveReportSchema, { outcome, note }, t)
    if (!result.ok) {
      form.setErrors(result.errors)
      throw new Error('invalid')
    }
    if (result.data.outcome === 'actioned' && !actionRecorded && !confirming) {
      setConfirming(true)
      throw new Error('confirm')
    }
    try {
      await resolve.mutateAsync({ reportId, ...result.data })
    } catch (error) {
      form.fail(error)
      throw error
    }
    onDone(result.data)
  }

  return (
    <ActionDialog
      title={confirming ? t('report.confirm_title') : t('report.resolve_title')}
      description={confirming ? t('report.confirm_text') : t('report.resolve_description')}
      submitLabel={confirming ? t('report.confirm_submit') : t('report.resolve')}
      onSubmit={submit}
      onClose={onClose}
      error={<ErrorSummary messages={form.rest} />}
    >
      {confirming ? null : (
        <>
          <fieldset className="grid gap-1.5">
            <legend className="text-sm font-medium">{t('report.outcome')}</legend>
            {(['actioned', 'dismissed'] as const).map((option) => (
              <label key={option} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="outcome"
                  value={option}
                  checked={outcome === option}
                  disabled={onlyDismiss && option === 'actioned'}
                  onChange={() => setOutcome(option)}
                  className="size-4 accent-primary"
                />
                <span>
                  {t(`report.outcome_${option}`)}
                  <span className="block text-muted-foreground">
                    {t(`report.outcome_${option}_hint`)}
                  </span>
                </span>
              </label>
            ))}
            {form.errors.outcome ? (
              <p role="alert" className="text-sm text-danger">
                {form.errors.outcome}
              </p>
            ) : null}
            {onlyDismiss ? (
              <p className="text-sm text-muted-foreground">{t('report.open_only_dismiss')}</p>
            ) : null}
          </fieldset>
          <CountedTextarea
            label={t('report.note')}
            hint={t('report.note_hint')}
            error={form.errors.note}
            value={note}
            onChange={setNote}
            max={1000}
            name="note"
          />
        </>
      )}
    </ActionDialog>
  )
}
