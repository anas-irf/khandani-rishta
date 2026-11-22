import type { VariantProps } from 'class-variance-authority'
import { AlertDialog as AlertDialogPrimitive } from 'radix-ui'
import type * as React from 'react'
import { buttonVariants } from '~/components/ui/button'
import { dialogContentVariants, dialogFooterClass, overlayClass } from '~/components/ui/dialog'
import { useReturnFocus } from '~/lib/focus'
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
      className={cn(overlayClass, className)}
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
  placement,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content> &
  VariantProps<typeof dialogContentVariants>) {
  const returnFocus = useReturnFocus({ onOpenAutoFocus, onCloseAutoFocus })
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        data-placement={placement ?? 'center'}
        className={cn(dialogContentVariants({ placement }), className)}
        {...returnFocus}
        {...props}
      />
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn('flex flex-col gap-2 text-start', className)}
      {...props}
    />
  )
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="alert-dialog-footer" className={cn(dialogFooterClass, className)} {...props} />
  )
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn('text-title-lg', className)}
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
      className={cn('text-body-md text-foreground-secondary', className)}
      {...props}
    />
  )
}

type ButtonStyleProps = Pick<VariantProps<typeof buttonVariants>, 'variant' | 'size'>

/**
 * The confirming button. Use `ink` for a negative choice that destroys nothing and `destructive`
 * for one that does (DESIGN.md 6.1).
 */
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
  variant = 'secondary',
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
