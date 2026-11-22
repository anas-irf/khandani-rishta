import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui'
import type * as React from 'react'
import { toggleVariants } from '~/components/ui/toggle'
import { cn } from '~/lib/utils'

/**
 * A row of choice chips built on Radix ToggleGroup. The chosen one takes the selected border
 * (DESIGN.md 4.2), and the row wraps when it no longer fits.
 *
 * - Give the group an `aria-label` or `aria-labelledby`.
 * - With `type="single"`, tapping the selected item clears the value (`onValueChange('')`). When
 *   one choice must always stay selected, ignore the empty string in `onValueChange`.
 * - Arrow keys move between items; mount Radix `DirectionProvider` so they follow `dir="rtl"`.
 */
function ToggleGroup({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn('flex w-fit max-w-full flex-wrap items-stretch gap-2', className)}
      {...props}
    />
  )
}

function ToggleGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(toggleVariants(), 'flex-auto focus-visible:z-10', className)}
      {...props}
    />
  )
}

export { ToggleGroup, ToggleGroupItem }
