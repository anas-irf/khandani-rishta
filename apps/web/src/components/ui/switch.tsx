import { Switch as SwitchPrimitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '~/lib/utils'

/*
 * DESIGN.md 6.11: a 56 x 32 track with a 26 thumb, primary when on. State is shown by the thumb
 * position as well as by colour, and the thumb moves the other way in right-to-left layouts.
 *
 * A labelled setting is a whole row that is the switch: use `SwitchRow` (components/common).
 */

/** The track and thumb. Place it inside a `SwitchRoot`, which gives it its state. */
function SwitchTrack({ className }: { className?: string }) {
  return (
    <span
      data-slot="switch-track"
      className={cn(
        'inline-flex h-[32px] w-[56px] shrink-0 items-center rounded-pill bg-input p-[3px] transition-colors group-disabled/switch:opacity-70 group-data-[state=checked]/switch:bg-primary',
        className,
      )}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-[26px] rounded-pill bg-background transition-[translate] data-[state=checked]:translate-x-[24px] rtl:data-[state=checked]:-translate-x-[24px]"
      />
    </span>
  )
}

/** The switch button itself, with no look of its own. */
function SwitchRoot({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn('group/switch disabled:cursor-not-allowed', className)}
      {...props}
    />
  )
}

/** A switch on its own, with a 48 tall hit area. Pair it with a `<Label htmlFor>`. */
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchRoot
      className={cn('tap-target inline-flex shrink-0 rounded-pill', className)}
      {...props}
    >
      <SwitchTrack />
    </SwitchRoot>
  )
}

export { Switch, SwitchRoot, SwitchTrack }
