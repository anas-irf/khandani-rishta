import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RadioCard } from '~/components/common/RadioCard'
import { Input } from '~/components/ui/input'
import { RadioGroup } from '~/components/ui/radio-group'
import { Toggle } from '~/components/ui/toggle'
import { validate } from '../forms'
import { useBanUser, useSuspendUser, useWarnUser } from '../queries'
import { banSchema, suspendSchema, warnSchema } from '../schemas'
import { ActionDialog } from './ActionDialog'
import { CountedTextarea, FormField, PresetButtons } from './FormField'
import { ErrorSummary, useDialogErrors } from './useDialogErrors'

export type SanctionKind = 'warn' | 'suspend' | 'ban'

/** Suspension length presets (18 section 5.3). */
const DAY_PRESETS = [7, 30, 90] as const

/**
 * Warn, suspend or ban a user, with the reason the member will see (18 section 5.3). With more
 * than one kind it offers a choice; a ban needs the profile code typed to confirm. A report's
 * id links the sanction to the report.
 */
export function SanctionDialog({
  userId,
  publicCode,
  kinds,
  initialReason = '',
  reportId,
  onDone,
  onClose,
}: {
  userId: string
  publicCode: string
  kinds: readonly SanctionKind[]
  initialReason?: string
  reportId?: string
  onDone?: (kind: SanctionKind) => void
  onClose: () => void
}) {
  const { t } = useTranslation('admin')
  const warn = useWarnUser()
  const suspend = useSuspendUser()
  const ban = useBanUser()
  const [kind, setKind] = useState<SanctionKind>(kinds[0] ?? 'warn')
  const [reason, setReason] = useState(initialReason)
  const [days, setDays] = useState<number | null>(30)
  const [phrase, setPhrase] = useState('')
  const form = useDialogErrors(['reason', 'days'])
  const examples = t('sanctions.examples', { returnObjects: true }) as string[]

  const phraseOk = kind !== 'ban' || phrase.trim() === publicCode

  const submit = async () => {
    const schema = kind === 'warn' ? warnSchema : kind === 'ban' ? banSchema : suspendSchema
    const result = validate(schema, { reason, days }, t)
    if (!result.ok) {
      form.setErrors(result.errors)
      throw new Error('invalid')
    }
    const link = reportId ? { report_id: reportId } : {}
    try {
      if (kind === 'warn') await warn.mutateAsync({ userId, reason: result.data.reason, ...link })
      else if (kind === 'ban')
        await ban.mutateAsync({ userId, reason: result.data.reason, ...link })
      else {
        await suspend.mutateAsync({
          userId,
          reason: result.data.reason,
          days: days ?? 0,
          ...link,
        })
      }
    } catch (error) {
      form.fail(error)
      throw error
    }
    onDone?.(kind)
  }

  return (
    <ActionDialog
      title={t(`sanctions.dialog.${kind}.title`)}
      description={t(`sanctions.dialog.${kind}.description`)}
      submitLabel={t(`sanctions.dialog.${kind}.submit`)}
      destructive={kind === 'ban'}
      canSubmit={phraseOk}
      onSubmit={submit}
      onClose={onClose}
      error={<ErrorSummary messages={form.rest} />}
    >
      {kinds.length > 1 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-label-lg">{t('sanctions.kind')}</legend>
          <RadioGroup
            name="sanction-kind"
            aria-label={t('sanctions.kind')}
            value={kind}
            onValueChange={(value) => setKind(value as SanctionKind)}
            className="grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]"
          >
            {kinds.map((option) => (
              <RadioCard
                key={option}
                id={`sanction-kind-${option}`}
                value={option}
                label={t(`sanctions.kind_label.${option}`)}
              />
            ))}
          </RadioGroup>
        </fieldset>
      ) : null}
      <PresetButtons label={t('sanctions.examples_label')} presets={examples} onPick={setReason} />
      <CountedTextarea
        label={t('sanctions.reason')}
        error={form.errors.reason}
        value={reason}
        onChange={setReason}
        max={500}
        rows={3}
        name="reason"
      />
      {kind === 'suspend' ? (
        <div className="grid gap-2">
          <FormField label={t('sanctions.days')} error={form.errors.days} className="w-40">
            {(props) => (
              <Input
                {...props}
                name="days"
                type="number"
                min={1}
                max={365}
                inputMode="numeric"
                value={days ?? ''}
                onChange={(event) =>
                  setDays(event.target.value === '' ? null : Number(event.target.value))
                }
              />
            )}
          </FormField>
          <div
            className="flex flex-wrap gap-2"
            role="toolbar"
            aria-label={t('sanctions.days_presets')}
          >
            {DAY_PRESETS.map((preset) => (
              <Toggle
                key={preset}
                pressed={days === preset}
                onPressedChange={() => setDays(preset)}
              >
                {t('sanctions.days_preset', { count: preset })}
              </Toggle>
            ))}
          </div>
        </div>
      ) : null}
      {kind === 'ban' ? (
        <FormField label={t('sanctions.type_code', { code: publicCode })}>
          {(props) => (
            <Input
              {...props}
              name="confirm_code"
              autoComplete="off"
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
            />
          )}
        </FormField>
      ) : null}
    </ActionDialog>
  )
}
