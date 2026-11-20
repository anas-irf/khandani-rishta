import { RadioGroup, RadioGroupItem } from '~/components/ui/radio-group'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { cn } from '~/lib/utils'
import { type AriaProps, useNameRef } from './field-shell'

/**
 * Single-choice controls for short lists (07 section 2.6): a segmented control and radio
 * cards. Both are labelled by the field's label through `aria-labelledby`.
 */

export type ChoiceOption = { code: string; label: string; description?: string }

type ChoiceProps = {
  /** The field name, put on the selected (or first) choice so `focusField()` finds it. */
  name: string
  options: ChoiceOption[]
  value: string | null
  onChange: (code: string | null) => void
  onBlur?: () => void
  labelledBy: string
  aria: AriaProps
  disabled?: boolean
  /** When false, tapping the selected choice clears it. */
  required?: boolean
  className?: string
  itemClassName?: string
}

/** Whether the labels are short enough for a segmented control on a 360px wide phone. */
export function fitsSegmented(options: { label: string }[]): boolean {
  const total = options.reduce((sum, option) => sum + option.label.length, 0)
  return options.length <= 4 && options.every((option) => option.label.length <= 14) && total <= 32
}

/** A segmented control with radio semantics. */
export function SegmentedChoice({
  name,
  options,
  value,
  onChange,
  onBlur,
  labelledBy,
  aria,
  disabled,
  required,
  className,
  itemClassName,
}: ChoiceProps) {
  const focusCode = options.some((option) => option.code === value) ? value : options[0]?.code
  return (
    <ToggleGroup
      type="single"
      role="radiogroup"
      aria-labelledby={labelledBy}
      {...aria}
      value={value ?? ''}
      onValueChange={(next) => {
        if (next) onChange(next)
        else if (!required) onChange(null)
      }}
      onBlur={onBlur}
      disabled={disabled}
      className={cn('flex w-full', className)}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.code}
          value={option.code}
          name={option.code === focusCode ? name : undefined}
          className={cn(
            'h-auto min-h-11 whitespace-normal px-2 py-1.5 text-center leading-tight',
            itemClassName,
          )}
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

/** Radio cards: each choice is a card with a title and an optional description. */
export function RadioCardList({
  name,
  options,
  value,
  onChange,
  onBlur,
  labelledBy,
  aria,
  disabled,
  className,
  idPrefix,
}: ChoiceProps & { idPrefix: string }) {
  const focusCode = options.some((option) => option.code === value) ? value : options[0]?.code
  return (
    <RadioGroup
      aria-labelledby={labelledBy}
      {...aria}
      value={value ?? ''}
      onValueChange={(next) => onChange(next || null)}
      onBlur={onBlur}
      disabled={disabled}
      className={cn('gap-2', className)}
    >
      {options.map((option) => (
        <RadioCard
          key={option.code}
          id={`${idPrefix}-${option.code}`}
          option={option}
          name={option.code === focusCode ? name : undefined}
        />
      ))}
    </RadioGroup>
  )
}

function RadioCard({
  id,
  option,
  name,
}: {
  id: string
  option: ChoiceOption
  name: string | undefined
}) {
  const nameRef = useNameRef(name)
  const titleId = `${id}-title`
  const descriptionId = option.description ? `${id}-description` : undefined
  return (
    <label
      htmlFor={id}
      className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-3 transition-colors hover:bg-muted has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary-soft has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
    >
      <RadioGroupItem
        id={id}
        ref={nameRef}
        value={option.code}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="mt-0.5"
      />
      <span className="grid gap-0.5">
        <span id={titleId} className="text-base font-medium leading-snug">
          {option.label}
        </span>
        {option.description ? (
          <span id={descriptionId} className="text-sm text-muted-foreground">
            {option.description}
          </span>
        ) : null}
      </span>
    </label>
  )
}
