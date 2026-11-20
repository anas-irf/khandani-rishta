import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '~/lib/utils'

/**
 * A segmented control built on Radix ToggleGroup.
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
      className={cn(
        'inline-flex w-fit items-stretch rounded-[var(--radius-input)] border border-input bg-surface',
        className,
      )}
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
      className={cn(
        'relative inline-flex h-11 min-w-11 flex-1 items-center justify-center gap-1.5 whitespace-nowrap border-s border-input px-4 text-sm font-medium text-foreground transition-colors first:rounded-s-[7px] first:border-s-0 last:rounded-e-[7px] hover:bg-muted focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary-hover [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
        className,
      )}
      {...props}
    />
  )
}

export { ToggleGroup, ToggleGroupItem }
