import { cva, type VariantProps } from 'class-variance-authority'
import { Progress as ProgressPrimitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '~/lib/utils'

const progressVariants = cva('relative h-[12px] w-full overflow-hidden rounded-pill', {
  variants: {
    tone: {
      primary: 'bg-primary-soft [&>[data-slot=progress-indicator]]:bg-primary',
      success: 'bg-success-soft [&>[data-slot=progress-indicator]]:bg-success',
    },
  },
  defaultVariants: { tone: 'primary' },
})

/**
 * Radix sets `role="progressbar"` and the `aria-value*` attributes; pass `role="meter"` for a
 * measurement that is not progress (a fit). Always pass an `aria-label` (or `aria-labelledby`),
 * and pass `value={null}` for an indeterminate state. The bar is sized with `width`, so it fills
 * from the start edge in both left-to-right and right-to-left layouts.
 */
function Progress({
  className,
  tone,
  value,
  max = 100,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & VariantProps<typeof progressVariants>) {
  const percent = typeof value === 'number' ? Math.min(100, Math.max(0, (value / max) * 100)) : null

  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      max={max}
      className={cn(progressVariants({ tone }), className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="h-full rounded-pill transition-[width] data-[state=indeterminate]:w-full data-[state=indeterminate]:animate-pulse"
        style={percent === null ? undefined : { width: `${percent}%` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
