import { Progress as ProgressPrimitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '~/lib/utils'

/**
 * Radix sets `role="progressbar"` and the `aria-value*` attributes. Always pass an `aria-label`
 * (or `aria-labelledby`), and pass `value={null}` for an indeterminate state. The bar is sized
 * with `width`, so it fills from the start edge in both left-to-right and right-to-left layouts.
 */
function Progress({
  className,
  value,
  max = 100,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  const percent = typeof value === 'number' ? Math.min(100, Math.max(0, (value / max) * 100)) : null

  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      max={max}
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-border', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="h-full rounded-full bg-primary transition-[width] data-[state=indeterminate]:w-full data-[state=indeterminate]:animate-pulse"
        style={percent === null ? undefined : { width: `${percent}%` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
