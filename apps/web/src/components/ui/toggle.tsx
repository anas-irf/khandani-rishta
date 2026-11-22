import { cva, type VariantProps } from 'class-variance-authority'
import { Toggle as TogglePrimitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '~/lib/utils'

/*
 * A choice that stays pressed (DESIGN.md 4.2): the selected border, fill and weight, so colour
 * is not the only mark, and no tick, which means verified (6.6). `ToggleGroupItem` looks the same.
 */
const toggleVariants = cva(
  'inline-flex min-h-touch min-w-touch max-w-full items-center gap-2 border-[1.5px] border-input text-foreground transition-colors hover:tonal disabled:cursor-not-allowed disabled:bg-muted-strong disabled:text-foreground-secondary data-[state=on]:border-primary data-[state=on]:bg-primary-soft [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-5',
  {
    variants: {
      variant: {
        /** A word or two. The 24 radius is a pill at 48 tall and stays soft at two lines. */
        chip: 'justify-center rounded-lg px-4 py-[8px] text-center text-label-md data-[state=on]:font-bold data-[state=on]:text-primary',
        /** A sentence: a prompt, a message template. */
        row: 'w-full justify-start rounded-row px-4 py-3 text-start text-body-sm',
      },
    },
    defaultVariants: { variant: 'chip' },
  },
)

/** One pressed or unpressed button (`aria-pressed`). Pass `pressed` and `onPressedChange`. */
function Toggle({
  className,
  variant,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
