import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { Slot } from 'radix-ui'
import type * as React from 'react'
import { cn } from '~/lib/utils'

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-input)] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        secondary: 'border border-border bg-surface text-foreground hover:bg-muted',
        outline: 'border border-input bg-surface text-foreground hover:bg-muted',
        ghost: 'text-foreground hover:bg-muted',
        destructive: 'bg-danger text-danger-foreground hover:bg-danger-hover',
        link: 'text-primary underline-offset-4 hover:underline',
        soft: 'bg-primary-soft text-primary hover:bg-primary-soft/70',
      },
      size: {
        // 44px minimum touch target (20 section 7). `sm` is for dense desktop toolbars only.
        default: 'h-11 px-4',
        sm: 'h-9 px-3',
        lg: 'h-12 px-6 text-base',
        icon: 'size-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    /** Renders the single child element (for example a router `<Link>`) instead of a `<button>`. */
    asChild?: boolean
    /** Shows a spinner, sets `aria-busy` and disables the control. */
    loading?: boolean
  }

/**
 * Icon-only buttons (`size="icon"`) must be given an `aria-label`.
 * With `asChild` the child is not a `<button>`, so `disabled` becomes `aria-disabled` and the
 * click is cancelled while loading or disabled.
 */
function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  type,
  children,
  onClick,
  ...props
}: ButtonProps) {
  const isDisabled = Boolean(disabled) || loading
  const spinner = loading ? <Loader2 aria-hidden="true" className="animate-spin" /> : null

  if (asChild) {
    return (
      <Slot.Root
        data-slot="button"
        data-variant={variant ?? 'default'}
        data-size={size ?? 'default'}
        aria-busy={loading || undefined}
        aria-disabled={isDisabled || undefined}
        className={cn(buttonVariants({ variant, size }), className)}
        onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
          if (isDisabled) {
            event.preventDefault()
            return
          }
          onClick?.(event)
        }}
        {...props}
      >
        {spinner}
        <Slot.Slottable>{children}</Slot.Slottable>
      </Slot.Root>
    )
  }

  return (
    <button
      data-slot="button"
      data-variant={variant ?? 'default'}
      data-size={size ?? 'default'}
      type={type ?? 'button'}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      onClick={onClick}
      {...props}
    >
      {spinner}
      {children}
    </button>
  )
}

export type { ButtonProps }
export { Button, buttonVariants }
