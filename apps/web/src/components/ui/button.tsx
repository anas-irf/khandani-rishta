import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { Slot } from 'radix-ui'
import type * as React from 'react'
import { cn } from '~/lib/utils'

/*
 * DESIGN.md 6.1 and 6.2. A pill, at least 48 tall. Give a row of buttons `flex-wrap`: a button
 * that does not fit moves to its own line, and only then does its label wrap.
 *
 * A disabled button is sand strong with secondary text, never faded, because it often says
 * something to read ("Interest sent"). While it loads it keeps its own colours.
 */
const buttonVariants = cva(
  "inline-flex max-w-full items-center justify-center gap-2.5 rounded-pill border-[1.5px] border-transparent text-center text-label-lg whitespace-normal transition-colors disabled:cursor-not-allowed disabled:not-aria-busy:border-muted-strong disabled:not-aria-busy:bg-muted-strong disabled:not-aria-busy:text-foreground-secondary aria-disabled:pointer-events-none aria-disabled:not-aria-busy:border-muted-strong aria-disabled:not-aria-busy:bg-muted-strong aria-disabled:not-aria-busy:text-foreground-secondary [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        /** The one main action of an area. */
        default:
          'border-primary bg-primary text-primary-foreground hover:border-primary-hover hover:bg-primary-hover active:border-primary-hover active:bg-primary-hover',
        /** "Decline", "Shortlist", "Withdraw". */
        secondary: 'border-input text-foreground hover:tonal',
        /** "More", "Not interested", "Report". */
        quiet: 'border border-input text-foreground hover:tonal',
        /** No outline: icon controls in bars ("Back", "Close"). */
        ghost: 'text-foreground hover:tonal',
        /** The same on an inverse surface (the photo viewer), where sand would outshine it. */
        'ghost-inverse':
          'text-inverse-foreground hover:bg-inverse-foreground/15 disabled:not-aria-busy:border-transparent disabled:not-aria-busy:bg-inverse/40 disabled:not-aria-busy:text-inverse-foreground/50',
        /** The main action on a primary band. */
        inverse:
          'border-background bg-background text-primary hover:border-surface hover:bg-surface',
        /** Confirms a negative choice that destroys nothing ("Decline"). */
        ink: 'border-foreground bg-foreground text-background hover:border-foreground-secondary hover:bg-foreground-secondary',
        /** Confirms a destructive choice ("Block", "Delete account"). */
        destructive:
          'border-danger bg-danger text-danger-foreground hover:border-danger-hover hover:bg-danger-hover',
        /** A text link with the gold underline ("See all"). */
        link: 'link-gold min-w-touch rounded-sm text-foreground hover:text-primary disabled:not-aria-busy:border-transparent disabled:not-aria-busy:bg-transparent disabled:no-underline',
      },
      size: {
        default: 'min-h-touch px-[22px] py-[8px]',
        /** Two buttons sharing a narrow row, as on a card. */
        compact: 'min-h-touch px-[12px] py-[8px]',
        /** Main actions on phones and in dialogs: 56 tall. */
        lg: 'min-h-touch-lg px-[28px] py-2 text-emphasis',
        icon: 'size-touch shrink-0 p-0',
        /** An icon over its label, in the phone top bar (DESIGN.md 6.16). */
        bar: 'min-h-touch-lg min-w-touch-lg flex-col gap-1 rounded-input px-1 py-1 text-label-sm',
      },
      /** The room a button takes on its line. */
      fill: {
        /** Under a form: the whole line on a phone, its own width when wide. */
        phone: 'w-full wide:w-auto wide:self-start',
        /** Shares the line on a phone, its own width when wide. */
        row: 'grow wide:grow-0',
        /** The answer beside `main`. */
        side: 'flex-[1_1_7rem]',
        /** The main answer, 1.4 times as wide (DESIGN.md 6.12). */
        main: 'flex-[1.4_1_8rem]',
      },
    },
    compoundVariants: [
      { variant: 'link', className: 'px-0' },
      // DESIGN.md section 1: a main action is 56 tall on phones, with the large label of 6.1.
      // The smaller sizes keep their label and padding for the narrow row they are in.
      {
        variant: ['default', 'inverse'],
        size: 'default',
        className: 'max-wide:min-h-touch-lg max-wide:px-[28px] max-wide:text-emphasis',
      },
      {
        variant: ['default', 'inverse'],
        size: 'compact',
        className: 'max-wide:min-h-touch-lg',
      },
      { variant: ['default', 'inverse'], size: 'icon', className: 'max-wide:size-touch-lg' },
    ],
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
  fill,
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
        className={cn(buttonVariants({ variant, size, fill }), className)}
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
      className={cn(buttonVariants({ variant, size, fill }), className)}
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
