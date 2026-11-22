import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '~/lib/utils'

/** Give the group an `aria-label` or `aria-labelledby` (a visible legend is best). */
function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn('grid gap-2', className)}
      {...props}
    />
  )
}

/*
 * The checkbox's twin: a 26 circle with the control border and a 48 by 48 hit area. Wrap the
 * item and its text in one `<label>` with `min-h-touch` so tapping the text selects it too.
 */
function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        'tap-target inline-flex size-[26px] shrink-0 items-center justify-center rounded-pill border-[1.5px] border-input bg-surface text-primary transition-colors disabled:cursor-not-allowed disabled:bg-muted-strong aria-invalid:border-danger data-[state=checked]:border-primary',
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="flex items-center justify-center"
      >
        <span className="block size-[14px] rounded-pill bg-primary" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  )
}

export { RadioGroup, RadioGroupItem }
