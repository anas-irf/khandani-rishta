import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'
import { cn } from '~/lib/utils'

const alertVariants = cva(
  'relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-[var(--radius-card)] border px-4 py-3 text-foreground has-[>svg]:grid-cols-[1.25rem_1fr] has-[>svg]:gap-x-3 [&>svg]:size-5 [&>svg]:translate-y-0.5 [&>svg]:text-current',
  {
    variants: {
      variant: {
        default: 'border-border bg-surface',
        info: 'border-primary/40 bg-primary-soft [&>svg]:text-primary',
        success: 'border-success/40 bg-success-soft [&>svg]:text-success',
        warning: 'border-warning/40 bg-warning-soft [&>svg]:text-warning',
        danger: 'border-danger/40 bg-danger-soft [&>svg]:text-danger',
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
      className={cn('col-start-2 min-h-5 text-base font-semibold leading-snug', className)}
      {...props}
    />
  )
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        'col-start-2 grid justify-items-start gap-1 text-sm [&_p]:leading-relaxed',
        className,
      )}
      {...props}
    />
  )
}

export { Alert, AlertDescription, AlertTitle, alertVariants }
