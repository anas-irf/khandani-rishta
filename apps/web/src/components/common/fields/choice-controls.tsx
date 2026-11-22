import { RadioGroup } from '~/components/ui/radio-group'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { cn } from '~/lib/utils'
import { RadioCard } from '../RadioCard'
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
      className={cn('w-full', className)}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.code}
          value={option.code}
          name={option.code === focusCode ? name : undefined}
          className={itemClassName}
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
      className={className}
    >
      {options.map((option) => (
        <FocusableRadioCard
          key={option.code}
          id={`${idPrefix}-${option.code}`}
          option={option}
          name={option.code === focusCode ? name : undefined}
        />
      ))}
    </RadioGroup>
  )
}

function FocusableRadioCard({
  id,
  option,
  name,
}: {
  id: string
  option: ChoiceOption
  name: string | undefined
}) {
  const nameRef = useNameRef(name)
  return (
    <RadioCard
      id={id}
      ref={nameRef}
      value={option.code}
      label={option.label}
      description={option.description}
    />
  )
}
