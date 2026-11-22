import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'
import { cn } from '~/lib/utils'

/** A soft fill, flat and without an outline (DESIGN.md 5.3). */
const alertVariants = cva(
  'relative grid w-full grid-cols-[0_minmax(0,1fr)] items-start gap-y-1 rounded-card px-5 py-4 text-foreground has-[>svg]:grid-cols-[1.25rem_minmax(0,1fr)] has-[>svg]:gap-x-3 [&>svg]:size-5 [&>svg]:translate-y-[3px] [&>svg]:text-current',
  {
    variants: {
      variant: {
        default: 'tonal',
        info: 'bg-primary-soft [&>svg]:text-primary',
        success: 'bg-success-soft [&>svg]:text-success',
        warning: 'bg-warning-soft [&>svg]:text-warning',
        danger: 'bg-danger-soft [&>svg]:text-danger',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

/**
 * `role="alert"` interrupts screen readers, so only the `danger` variant uses it. Other variants
 * use `role="status"` (polite). Put an icon (aria-hidden) before the title so colour is never the
 * only carrier of meaning.
 */
function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role={variant === 'danger' ? 'alert' : 'status'}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn('col-start-2 text-title-sm font-bold', className)}
      {...props}
    />
  )
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn('col-start-2 grid justify-items-start gap-1 text-body-sm', className)}
      {...props}
    />
  )
}

export { Alert, AlertDescription, AlertTitle, alertVariants }
