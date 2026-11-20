import { Check, ChevronRight, Loader2 } from 'lucide-react'
import { type ReactNode, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Label } from '~/components/ui/label'
import { NativeSelect } from '~/components/ui/native-select'
import { RadioGroup, RadioGroupItem } from '~/components/ui/radio-group'
import { Skeleton } from '~/components/ui/skeleton'
import { Switch } from '~/components/ui/switch'
import { cn } from '~/lib/utils'

/**
 * Controls of the settings screens: each one has its own label, helper text and a small status
 * that shows a spinner while a save runs and a brief "Saved" afterwards (16 section 6.25).
 */

export type SaveState = 'idle' | 'saving' | 'saved'

/** A polite live region: the spinner while saving, then "Saved" for a moment. */
export function SaveIndicator({ state }: { state: SaveState }) {
  const { t } = useTranslation('settings')
  return (
    <span
      role="status"
      aria-live="polite"
      data-save-state={state}
      className="inline-flex min-h-5 min-w-5 shrink-0 items-center gap-1 text-sm text-muted-foreground"
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

/** A settings toggle: label and helper text at the start, the switch at the end. */
export function SettingSwitch({
  label,
  help,
  checked,
  onCheckedChange,
  disabled,
  state = 'idle',
}: {
  label: string
  help?: ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  state?: SaveState
}) {
  const id = useId()
  const helpId = `${id}-help`
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 py-1.5">
      <div className="grid min-w-0 gap-0.5">
        <Label htmlFor={id} className="block text-base font-medium leading-snug">
          {label}
        </Label>
        {help ? (
          <p id={helpId} className="text-sm text-muted-foreground">
            {help}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <SaveIndicator state={state} />
        <Switch
          id={id}
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled || state === 'saving'}
          aria-describedby={help ? helpId : undefined}
        />
      </div>
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
    <div className="grid gap-1.5 py-1.5">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id} className="text-base font-medium leading-snug">
          {label}
        </Label>
        <SaveIndicator state={state} />
      </div>
      {help ? (
        <p id={helpId} className="text-sm text-muted-foreground">
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
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
      {caption ? (
        <p id={captionId} className="text-sm text-muted-foreground">
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
    <div className="grid gap-2 py-1.5">
      <div className="flex items-center justify-between gap-3">
        <p id={titleId} className="text-base font-medium leading-snug">
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
        className="gap-2"
      >
        {options.map((option) => {
          const optionId = `${id}-${option.value}`
          const helpId = option.help ? `${optionId}-help` : undefined
          return (
            <div key={option.value} className="grid gap-1">
              <label
                htmlFor={optionId}
                className={cn(
                  'flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-3 transition-colors hover:bg-muted',
                  'has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary-soft',
                  'has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60',
                )}
              >
                <RadioGroupItem
                  id={optionId}
                  value={option.value}
                  aria-describedby={helpId}
                  className="mt-0.5"
                />
                <span className="grid gap-0.5">
                  <span className="text-base font-medium leading-snug">{option.label}</span>
                  {option.help ? (
                    <span id={helpId} className="text-sm text-muted-foreground">
                      {option.help}
                    </span>
                  ) : null}
                </span>
              </label>
              {option.extra ? <div className="ps-3">{option.extra}</div> : null}
            </div>
          )
        })}
      </RadioGroup>
      {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
    </div>
  )
}

/** A settings screen's column: header above, groups below. */
export function SettingsPage({ children }: { children: ReactNode }) {
  return (
    <div className="container-app">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 pb-6">{children}</div>
    </div>
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
          className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4"
        >
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-11 w-full rounded-[var(--radius-input)]" />
          <Skeleton className="h-11 w-full rounded-[var(--radius-input)]" />
        </div>
      ))}
    </div>
  )
}

/** The arrow at the end of a menu row; it points the other way in right-to-left layouts. */
export function RowChevron({ className }: { className?: string }) {
  return (
    <ChevronRight
      aria-hidden="true"
      className={cn('size-5 shrink-0 text-muted-foreground rtl:-scale-x-100', className)}
    />
  )
}
