import { type FormEvent, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Label } from '~/components/ui/label'
import { RadioGroup, RadioGroupItem } from '~/components/ui/radio-group'
import { Textarea } from '~/components/ui/textarea'
import { useReportMember } from '~/features/relations/queries'
import { isApiError } from '~/lib/api'
import { isOneOf, REPORT_REASONS } from '~/lib/api-enums'
import type { ReportBody } from '~/lib/api-types'
import { optionsIn, useOptions } from '~/lib/reference'
import { CharCount, FieldError, OptionalMark } from './fields/field-shell'
import { useOnlineStatus } from './OfflineBanner'
import { useGoBack } from './PageHeader'

const DETAILS_MAX = 1000

/** Reasons after which the confirmation adds safety tip 12 (13 section 11.3). */
const TIP_REASONS: ReadonlySet<string> = new Set(['harassment', 'asking_for_money'])

/** What is reported (13 section 6.1). */
export type ReportSubjectRef =
  | { type: 'profile' }
  | { type: 'photo'; photoId: string }
  | { type: 'message'; messageId: string }

export type ReportDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The reported member. */
  profileId: string
  /** Their `display_name`. */
  name: string
  /** Default: the profile. */
  subject?: ReportSubjectRef
  /** A preselected reason, for example `asking_for_money` from the chat money notice. */
  defaultReason?: string
  /**
   * Runs after a report with "Also block" succeeded. Default: back to the previous screen
   * (16 section 6.11), or `/home` without history.
   */
  onBlocked?: () => void
}

function bodyFor(
  profileId: string,
  subject: ReportSubjectRef,
  reason: ReportBody['reason'],
  details: string,
  alsoBlock: boolean,
): ReportBody {
  const body: ReportBody = {
    target_profile_id: profileId,
    subject_type: subject.type,
    reason,
    also_block: alsoBlock,
  }
  if (subject.type === 'photo') body.photo_id = subject.photoId
  if (subject.type === 'message') body.message_id = subject.messageId
  const trimmed = details.trim()
  if (trimmed) body.details = trimmed
  return body
}

/**
 * The report dialog used by every "Report" control (16 section 6.11, 13 section 6): a required
 * reason from `report_reason`, optional "Tell us more" (at most 1,000 characters) and "Also
 * block this member", ticked by default. Then `POST /v1/reports`, the confirmation of 13
 * section 6.4 as a toast (with tip 12 for harassment and money), and the way back when blocked.
 */
export function ReportDialog({ open, onOpenChange, ...props }: ReportDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <ReportForm {...props} onClose={() => onOpenChange(false)} /> : null}
    </Dialog>
  )
}

function ReportForm({
  profileId,
  name,
  subject = { type: 'profile' },
  defaultReason,
  onBlocked,
  onClose,
}: Omit<ReportDialogProps, 'open' | 'onOpenChange'> & { onClose: () => void }) {
  const { t } = useTranslation(['shared', 'common', 'errors'])
  const reasons = optionsIn(useOptions('report_reason'), REPORT_REASONS)
  const report = useReportMember()
  const goBack = useGoBack()
  const online = useOnlineStatus()
  const ids = { legend: useId(), reasonError: useId(), details: useId(), count: useId() }

  const [reason, setReason] = useState(defaultReason ?? '')
  const [details, setDetails] = useState('')
  const [alsoBlock, setAlsoBlock] = useState(true)
  const [errors, setErrors] = useState<{ reason?: string; details?: string }>({})

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!isOneOf(REPORT_REASONS, reason)) {
      setErrors({ reason: t('shared:report.reason_required') })
      return
    }
    setErrors({})
    try {
      await report.mutateAsync(bodyFor(profileId, subject, reason, details, alsoBlock))
    } catch (error) {
      if (isApiError(error) && error.code === 'validation_failed') {
        const next: { reason?: string; details?: string } = {}
        for (const field of error.fields) {
          if (field.field === 'reason' || field.field === 'details') {
            next[field.field] = t(`errors:field.${field.code}`, { defaultValue: field.message })
          }
        }
        setErrors(next)
      }
      return
    }
    toast.success(t('shared:report.success'), {
      description: TIP_REASONS.has(reason) ? t('shared:report.safety_tip') : undefined,
      duration: TIP_REASONS.has(reason) ? 12_000 : undefined,
    })
    onClose()
    if (alsoBlock) (onBlocked ?? goBack)()
  }

  return (
    <DialogContent closeLabel={t('common:actions.close')} aria-describedby={undefined}>
      <form onSubmit={(event) => void submit(event)} className="grid gap-5" noValidate>
        <DialogHeader>
          <DialogTitle>{t('shared:report.title', { name })}</DialogTitle>
        </DialogHeader>

        <fieldset
          className="grid gap-1"
          aria-describedby={errors.reason ? ids.reasonError : undefined}
        >
          <legend id={ids.legend} className="mb-1 text-label-lg">
            {t('shared:report.reason_label')}
          </legend>
          <RadioGroup
            value={reason}
            onValueChange={(value) => {
              setReason(value)
              setErrors((previous) => ({ ...previous, reason: undefined }))
            }}
            aria-labelledby={ids.legend}
            aria-required="true"
            aria-invalid={errors.reason ? true : undefined}
            className="gap-0"
          >
            {reasons.map((option) => (
              <Label
                key={option.code}
                variant="option"
                className="rounded-input px-1 py-1 hover:tonal"
              >
                <RadioGroupItem value={option.code} />
                <span className="min-w-0">{option.label}</span>
              </Label>
            ))}
          </RadioGroup>
          <FieldError id={ids.reasonError} message={errors.reason ?? undefined} />
        </fieldset>

        <div className="grid gap-2">
          <Label htmlFor={ids.details} className="flex-wrap">
            {t('shared:report.details_label')} <OptionalMark />
          </Label>
          <Textarea
            id={ids.details}
            value={details}
            maxLength={DETAILS_MAX}
            dir="auto"
            aria-describedby={ids.count}
            aria-invalid={errors.details ? true : undefined}
            onChange={(event) => setDetails(event.target.value)}
          />
          <CharCount id={ids.count} over={Boolean(errors.details)}>
            {errors.details ??
              t('shared:report.details_count', {
                count: details.length,
                max: DETAILS_MAX,
              })}
          </CharCount>
        </div>

        <Label variant="option">
          <Checkbox
            checked={alsoBlock}
            onCheckedChange={(checked) => setAlsoBlock(checked === true)}
          />
          <span className="min-w-0">{t('shared:report.also_block')}</span>
        </Label>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={report.isPending}>
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" loading={report.isPending} disabled={!online}>
            {t('shared:report.submit')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
