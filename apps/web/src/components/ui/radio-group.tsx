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
 * Touch target note: the visible circle is 20px (size-5); the `after:` pseudo-element extends
 * the clickable area to 44px by 44px. Wrap the item and its text in one `<label>` with
 * `min-h-11` so tapping the text selects it too.
 */
function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        "relative inline-flex aspect-square size-5 shrink-0 items-center justify-center rounded-full border border-muted-foreground bg-surface text-primary transition-colors after:absolute after:-inset-3 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger aria-invalid:focus-visible:ring-danger data-[state=checked]:border-primary",
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="flex items-center justify-center"
      >
        <span className="block size-2.5 rounded-full bg-primary" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  )
}

export { RadioGroup, RadioGroupItem }
