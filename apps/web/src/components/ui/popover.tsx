import { Popover as PopoverPrimitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '~/lib/utils'

function Popover(props: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger(props: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverAnchor(props: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

function PopoverClose(props: React.ComponentProps<typeof PopoverPrimitive.Close>) {
  return <PopoverPrimitive.Close data-slot="popover-close" {...props} />
}

/**
 * The content has `role="dialog"`: give it an accessible name with `aria-label` or
 * `aria-labelledby`.
 */
function PopoverContent({
  className,
  align = 'center',
  sideOffset = 8,
  collisionPadding = 8,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          'z-50 w-[320px] max-w-[calc(100vw-16px)] origin-(--radix-popover-content-transform-origin) rounded-lg border border-border bg-surface p-4 text-foreground shadow-menu [--tonal:var(--color-muted)] motion-safe:transition-[opacity,scale] motion-safe:starting:scale-95 motion-safe:starting:opacity-0',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverAnchor, PopoverClose, PopoverContent, PopoverTrigger }
