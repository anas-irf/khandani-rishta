import { Switch as SwitchPrimitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '~/lib/utils'

/*
 * Touch target note: the visible track is 44px by 24px; the `after:` pseudo-element extends the
 * clickable height to 44px. Wrap the switch and its text in one `<label>` with `min-h-11` so
 * tapping the text toggles it too.
 *
 * State is shown by the thumb position and by track and thumb colour, so it never relies on
 * colour alone. The thumb moves the other way in right-to-left layouts.
 */
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-muted-foreground bg-surface transition-colors after:absolute after:-inset-y-2.5 after:inset-x-0 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none ms-0.5 block size-4 rounded-full bg-muted-foreground transition-[translate,background-color] data-[state=checked]:translate-x-5 data-[state=checked]:bg-primary-foreground rtl:data-[state=checked]:-translate-x-5"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
