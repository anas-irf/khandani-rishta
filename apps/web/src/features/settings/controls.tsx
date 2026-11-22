import { Check, Loader2 } from 'lucide-react'
import { type ReactNode, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Band } from '~/components/common/Band'
import { RadioCard } from '~/components/common/RadioCard'
import { SectionCard } from '~/components/common/SectionCard'
import { SwitchRow } from '~/components/common/SwitchRow'
import { Label } from '~/components/ui/label'
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select'
import { RadioGroup } from '~/components/ui/radio-group'
import { Skeleton } from '~/components/ui/skeleton'
import { cn } from '~/lib/utils'

/**
 * Controls of the settings screens: each one has its own label, helper text and a small status
 * that shows a spinner while a save runs and a brief "Saved" afterwards (16 section 6.25).
 */

export type SaveState = 'idle' | 'saving' | 'saved'

/** A polite live region: the spinner while saving, then "Saved" for a moment. */
export function SaveIndicator({ state, className }: { state: SaveState; className?: string }) {
  const { t } = useTranslation('settings')
  return (
    <span
      role="status"
      aria-live="polite"
      data-save-state={state}
      className={cn(
        'inline-flex min-h-[22px] min-w-[20px] shrink-0 items-center gap-1 text-caption text-muted-foreground',
        className,
      )}
    >
      {state === 'saving' ? (
        <>
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          <span className="sr-only">{t('saving.working')}</span>
        </>
      ) : null}
      {state === 'saved' ? (
        <>
          <Check aria-hidden="true" className="size-4 text-success" />
          <span>{t('saving.saved')}</span>
        </>
      ) : null}
    </span>
  )
}

/**
 * A settings toggle: the whole row is the switch (DESIGN.md 6.11). A switch that saves on its own
 * passes `state`; the line for "Saved" keeps its room, so the rows under it never move.
 */
export function SettingSwitch({
  label,
  help,
  checked,
  onCheckedChange,
  disabled,
  state,
}: {
  label: string
  help?: ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  state?: SaveState
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <SwitchRow
        label={label}
        help={help}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled || state === 'saving'}
      />
      {state ? <SaveIndicator state={state} className="-mb-2 ps-[20px]" /> : null}
    </div>
  )
}

/** A three-way (or any short) closed list as a native select, with its title and helper text. */
export function SettingSelect({
  label,
  help,
  value,
  options,
  onChange,
  disabled,
  state = 'idle',
  caption,
}: {
  label: string
  help?: ReactNode
  value: string
  options: { value: string; label: string; disabled?: boolean }[]
  onChange: (value: string) => void
  disabled?: boolean
  state?: SaveState
  /** A short note under the select, for example "Coming soon" for a disabled option. */
  caption?: ReactNode
}) {
  const id = useId()
  const helpId = `${id}-help`
  const captionId = `${id}-caption`
  return (
    <div className="flex min-w-0 flex-col gap-2 py-[8px]">
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <Label htmlFor={id}>{label}</Label>
        <SaveIndicator state={state} />
      </div>
      {help ? (
        <p id={helpId} className="text-caption text-muted-foreground">
          {help}
        </p>
      ) : null}
      <NativeSelect
        id={id}
        value={value}
        disabled={disabled || state === 'saving'}
        aria-describedby={
          [help ? helpId : null, caption ? captionId : null].filter(Boolean).join(' ') || undefined
        }
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <NativeSelectOption key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {caption ? (
        <p id={captionId} className="text-caption text-muted-foreground">
          {caption}
        </p>
      ) : null}
    </div>
  )
}

export type RadioCardOption = {
  value: string
  label: string
  help?: string
  /** A control shown under the card, for example a link ("Review my must-haves"). */
  extra?: ReactNode
}

/**
 * Radio cards for choices that each need an explanation (09 section 3): a title for the group,
 * one card per choice, and the save status next to the title. The group is disabled while a
 * save runs, and shows the saved value, never the pending one (16 rule G7).
 */
export function SettingRadioCards({
  title,
  value,
  options,
  onChange,
  state = 'idle',
  note,
}: {
  title: string
  value: string
  options: RadioCardOption[]
  onChange: (value: string) => void
  state?: SaveState
  /** A fixed note under the cards. */
  note?: ReactNode
}) {
  const id = useId()
  const titleId = `${id}-title`
  return (
    <div className="flex min-w-0 flex-col gap-3 py-[8px]">
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <p id={titleId} className="max-w-full text-title-md font-bold">
          {title}
        </p>
        <SaveIndicator state={state} />
      </div>
      <RadioGroup
        aria-labelledby={titleId}
        value={value}
        onValueChange={(next) => {
          if (next && next !== value) onChange(next)
        }}
        disabled={state === 'saving'}
      >
        {options.map((option) => (
          <div key={option.value} className="flex min-w-0 flex-col items-start">
            <RadioCard
              id={`${id}-${option.value}`}
              value={option.value}
              label={option.label}
              description={option.help}
              className="w-full"
            />
            {option.extra ? <div className="max-w-full ps-[16px]">{option.extra}</div> : null}
          </div>
        ))}
      </RadioGroup>
      {note ? <p className="text-caption text-muted-foreground">{note}</p> : null}
    </div>
  )
}

/** One group of a settings screen: a band with its ornamented title (DESIGN.md 6.10). */
export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Band as="div" tone="auto" width="column">
      <SectionCard title={title} className="gap-4">
        {children}
      </SectionCard>
    </Band>
  )
}

/** The first load of a settings screen (16 rule G1): skeleton groups, announced once as "Loading". */
export function SettingsSkeleton({ groups = 3 }: { groups?: number }) {
  const { t } = useTranslation('shared')
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-4">
      <span className="sr-only">{t('list.loading')}</span>
      {Array.from({ length: groups }, (_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity.
          key={index}
          aria-hidden="true"
          className="flex flex-col gap-4 pb-4"
        >
          <Skeleton className="h-6 w-[min(100%,10rem)]" />
          <Skeleton className="min-h-touch w-full rounded-row" />
          <Skeleton className="min-h-touch w-full rounded-row" />
        </div>
      ))}
    </div>
  )
}
