import type { VariantProps } from 'class-variance-authority'
import { AlertDialog as AlertDialogPrimitive } from 'radix-ui'
import type * as React from 'react'
import { buttonVariants } from '~/components/ui/button'
import { cn } from '~/lib/utils'

function AlertDialog(props: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogTrigger(props: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
}

function AlertDialogPortal(props: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  return <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
}

function AlertDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  return (
    <AlertDialogPrimitive.Overlay
      data-slot="alert-dialog-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-foreground/50 motion-safe:transition-opacity motion-safe:duration-150 motion-safe:starting:opacity-0',
        className,
      )}
      {...props}
    />
  )
}

/**
 * Give every alert dialog an `AlertDialogTitle` and an `AlertDialogDescription`. Radix moves
 * focus to the cancel button on open, closes on Escape, and ignores clicks on the overlay.
 */
function AlertDialogContent({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        className={cn(
          'fixed inset-0 z-50 m-auto grid h-fit max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg gap-4 overflow-y-auto rounded-[var(--radius-card)] border border-border bg-surface p-5 text-foreground shadow-lg focus-visible:outline-none motion-safe:transition-[opacity,scale] motion-safe:duration-150 motion-safe:starting:scale-95 motion-safe:starting:opacity-0',
          className,
        )}
        {...props}
      />
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn('flex flex-col gap-1.5 text-start', className)}
      {...props}
    />
  )
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  )
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn('text-lg font-semibold leading-snug', className)}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

type ButtonStyleProps = Pick<VariantProps<typeof buttonVariants>, 'variant' | 'size'>

/** The confirming button. Use `variant="destructive"` for destructive confirmations. */
function AlertDialogAction({
  className,
  variant = 'default',
  size,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action> & ButtonStyleProps) {
  return (
    <AlertDialogPrimitive.Action
      data-slot="alert-dialog-action"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

/** The dismissing button. Closes the dialog without any further code. */
function AlertDialogCancel({
  className,
  variant = 'outline',
  size,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel> & ButtonStyleProps) {
  return (
    <AlertDialogPrimitive.Cancel
      data-slot="alert-dialog-cancel"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
}
