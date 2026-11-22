import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import type * as React from 'react'
import { cn } from '~/lib/utils'

/**
 * DESIGN.md 6.3 and 6.4: a pill at 15 / 700. Colour is never the only carrier of meaning
 * (20 section 7): always give a badge a text label, and an icon where it helps. A tick means
 * verified and nothing else.
 */
const badgeVariants = cva(
  'inline-flex w-fit max-w-full items-center justify-center gap-1.5 rounded-pill px-3 py-[5px] text-start text-label-sm font-bold whitespace-normal [&>svg]:pointer-events-none [&>svg]:size-3.5 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground',
        /** "Must have", and other words in primary on primary soft. */
        tag: 'bg-primary-soft px-2.5 py-[3px] text-primary',
        success: 'bg-success-soft text-success',
        secondary: 'tonal text-foreground-secondary',
        outline: 'border border-input text-foreground-secondary',
        warning: 'bg-warning-soft text-warning',
        danger: 'bg-danger-soft text-danger',
        inverse: 'bg-inverse text-inverse-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span'
  return (
    <Comp
      data-slot="badge"
      data-variant={variant ?? 'default'}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
