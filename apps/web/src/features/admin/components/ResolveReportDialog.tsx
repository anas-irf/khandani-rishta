import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FieldError } from '~/components/common/fields/field-shell'
import { RadioCard } from '~/components/common/RadioCard'
import { RadioGroup } from '~/components/ui/radio-group'
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
  const outcomeId = useId()

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
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-label-lg">{t('report.outcome')}</legend>
            <RadioGroup
              name="outcome"
              aria-label={t('report.outcome')}
              value={outcome}
              onValueChange={(value) => setOutcome(value as ReportOutcome)}
            >
              {(['actioned', 'dismissed'] as const).map((option) => (
                <RadioCard
                  key={option}
                  id={`${outcomeId}-${option}`}
                  value={option}
                  disabled={onlyDismiss && option === 'actioned'}
                  label={t(`report.outcome_${option}`)}
                  description={t(`report.outcome_${option}_hint`)}
                />
              ))}
            </RadioGroup>
            {form.errors.outcome ? (
              <div role="alert">
                <FieldError id={`${outcomeId}-error`} message={form.errors.outcome} />
              </div>
            ) : null}
            {onlyDismiss ? (
              <p className="text-caption text-muted-foreground">{t('report.open_only_dismiss')}</p>
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
