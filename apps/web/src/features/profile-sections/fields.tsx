import { Check, Lock } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import {
  ariaFor,
  FieldShell,
  subId,
  useFieldDisabled,
} from '~/components/common/fields/field-shell'
import type { TextStatus } from '~/lib/api-types'
import { useFieldControl } from '~/lib/form-context'
import { useCurrentMe } from '~/lib/me'
import type { Option } from '~/lib/reference'
import { cn } from '~/lib/utils'

/**
 * Field pieces specific to the profile forms: a locked value (08 section 2.2), toggle chips for
 * short multi-choice lists and hobbies (07 sections 9.1 and 11.2), and the moderated text label
 * (08 section 1.4).
 */

/** A field the owner can no longer edit: read-only text, a lock icon and how to correct it. */
export function LockedField({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation('profile_sections')
  const me = useCurrentMe()
  const email = me.config.support_email
  const code = me.profile.public_code
  const subject = encodeURIComponent(t('locked.mail_subject', { code }))
  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <p className="flex min-h-11 items-center gap-2 rounded-[var(--radius-input)] border border-border bg-muted px-3">
        <Lock aria-label={t('locked.icon')} className="size-4 shrink-0 text-muted-foreground" />
        <span dir="auto">{value}</span>
      </p>
      <p className="text-sm text-muted-foreground">
        <Trans
          t={t}
          i18nKey="locked.explanation"
          values={{ email, code }}
          components={{
            mail: (
              // biome-ignore lint/a11y/useAnchorContent: Trans puts the address inside.
              <a
                href={`mailto:${email}?subject=${subject}`}
                className="font-medium text-primary underline underline-offset-4"
              />
            ),
          }}
        />
      </p>
    </div>
  )
}

export type ChipsFieldProps = {
  label: string
  helpText?: string
  required?: boolean
  disabled?: boolean
  className?: string
  options?: Option[]
  /** Chips grouped under headings (hobbies by category). */
  groups?: { key: string; title: string; options: Option[] }[]
  /** At most this many: the other chips are disabled and `maxMessage` is shown. */
  max?: number
  maxMessage?: string
  /** Shown as a pressed chip while nothing is chosen, for example "Any" (07 section 11.2). */
  emptyLabel?: string
}

/** Several choices as toggle chips. Value `string[]`. */
export function ChipsField({
  label,
  helpText,
  required = false,
  disabled,
  className,
  options = [],
  groups,
  max,
  maxMessage,
  emptyLabel,
}: ChipsFieldProps) {
  const control = useFieldControl<string[]>()
  const isDisabled = useFieldDisabled(control, disabled)
  const value = control.value ?? []
  const reached = max != null && value.length >= max
  const maxId = subId(control, 'max')
  const all = groups ? groups.flatMap((group) => group.options) : options
  const firstCode = all[0]?.code

  const toggle = (code: string) => {
    if (value.includes(code)) control.setValue(value.filter((entry) => entry !== code))
    else if (!reached) control.setValue([...value, code])
  }

  const chip = (option: Option) => {
    const selected = value.includes(option.code)
    return (
      <button
        key={option.code}
        type="button"
        name={option.code === firstCode ? control.name : undefined}
        aria-pressed={selected}
        disabled={isDisabled || (!selected && reached)}
        onClick={() => toggle(option.code)}
        onBlur={control.onBlur}
        className={cn(
          'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          selected
            ? 'border-primary bg-primary-soft text-foreground'
            : 'border-border bg-surface text-foreground hover:bg-muted',
        )}
      >
        {selected ? <Check aria-hidden="true" className="size-4 text-primary" /> : null}
        <span dir="auto">{option.label}</span>
      </button>
    )
  }

  const aria = ariaFor(control, {
    required,
    hasHelp: Boolean(helpText),
    extraDescribedBy: reached && maxMessage ? maxId : undefined,
  })

  return (
    <FieldShell
      control={control}
      label={label}
      helpText={helpText}
      required={required}
      className={className}
      kind="fieldset"
    >
      <div {...aria} className="grid gap-3">
        {groups ? (
          groups.map((group) => (
            <div key={group.key} className="grid gap-2">
              <span className="text-sm text-muted-foreground">{group.title}</span>
              <div className="flex flex-wrap gap-2">{group.options.map(chip)}</div>
            </div>
          ))
        ) : (
          <div className="flex flex-wrap gap-2">
            {emptyLabel && value.length === 0 ? (
              <span className="inline-flex min-h-11 items-center rounded-full border border-primary bg-primary-soft px-3 text-sm font-medium">
                {emptyLabel}
              </span>
            ) : null}
            {options.map(chip)}
          </div>
        )}
      </div>
      {reached && maxMessage ? (
        <p id={maxId} className="text-sm text-muted-foreground">
          {maxMessage}
        </p>
      ) : null}
    </FieldShell>
  )
}

/** "Under review" or "Not approved" next to a moderated text (08 section 1.4). */
export function TextStatusNote({ status }: { status: TextStatus }) {
  const { t } = useTranslation('profile_sections')
  if (status === 'approved') return null
  return (
    <p
      className={cn(
        'rounded-[var(--radius-input)] px-3 py-2 text-sm',
        status === 'pending' ? 'bg-warning-soft' : 'bg-danger-soft',
      )}
    >
      {status === 'pending' ? t('form.text_pending') : t('form.text_rejected')}
    </p>
  )
}
