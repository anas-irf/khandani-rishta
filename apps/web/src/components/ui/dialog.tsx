import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import type * as React from 'react'
import { buttonVariants } from '~/components/ui/button'
import { useReturnFocus } from '~/lib/focus'
import { cn } from '~/lib/utils'

const overlayClass =
  'fixed inset-0 z-50 bg-inverse/50 motion-safe:transition-opacity motion-safe:duration-(--duration-base) motion-safe:starting:opacity-0'

/*
 * DESIGN.md 6.13: every dialog is a bottom sheet on phones. On wide screens it is centred, or it
 * takes the place of the side rail (`placement="rail"`, for the dialogs of a profile's actions).
 * `placement="full"` is the photo viewer: the whole window, on the inverse surface.
 */
const dialogContentVariants = cva(
  'fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col gap-5 overflow-y-auto rounded-sheet bg-surface px-[20px] pt-6 pb-[max(20px,env(safe-area-inset-bottom))] text-foreground shadow-bar [--tonal:var(--color-muted)] [&>*]:shrink-0 motion-safe:transition-[translate,opacity] motion-safe:duration-(--duration-base) motion-safe:starting:translate-y-6 motion-safe:starting:opacity-0 wide:rounded-xl wide:p-6',
  {
    variants: {
      placement: {
        center:
          'wide:inset-0 wide:m-auto wide:h-fit wide:max-h-[calc(100dvh-48px)] wide:w-[calc(100%-48px)] wide:max-w-form wide:shadow-menu',
        rail: 'wide:inset-x-auto wide:end-[max(var(--spacing-gutter),calc((100vw-var(--container-content))/2))] wide:top-[calc(var(--app-bar,80px)+24px)] wide:bottom-auto wide:max-h-[calc(100dvh-var(--app-bar,80px)-48px)] wide:w-[min(380px,calc(100%-2*var(--spacing-gutter)))] wide:shadow-panel',
        full: 'inset-0 max-h-none gap-0 overflow-hidden rounded-none bg-inverse p-0 pb-[env(safe-area-inset-bottom)] text-inverse-foreground shadow-none [--focus:var(--color-inverse-foreground)] wide:rounded-none wide:p-0',
      },
    },
    defaultVariants: { placement: 'center' },
  },
)

/** Equal buttons, 56 tall, that take a line each when they no longer fit (DESIGN.md 6.13). */
const dialogFooterClass =
  'flex flex-wrap gap-3 pt-1 *:min-h-touch-lg *:flex-[1_1_8rem] max-wide:*:text-emphasis'

function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal(props: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(overlayClass, className)}
      {...props}
    />
  )
}

type DialogContentProps = React.ComponentProps<typeof DialogPrimitive.Content> &
  VariantProps<typeof dialogContentVariants> & {
    /** Shows the X button in the corner. */
    showCloseButton?: boolean
    /** Accessible name of the X button. Pass the translated text. */
    closeLabel?: string
  }

/**
 * Give every dialog a `DialogTitle`, and a `DialogDescription` (or `aria-describedby={undefined}`).
 * Radix traps focus, restores it on close and closes on Escape.
 */
function DialogContent({
  className,
  children,
  placement,
  showCloseButton = true,
  closeLabel = 'Close',
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: DialogContentProps) {
  const returnFocus = useReturnFocus({ onOpenAutoFocus, onCloseAutoFocus })
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-placement={placement ?? 'center'}
        data-with-close={showCloseButton}
        className={cn('group/dialog', dialogContentVariants({ placement }), className)}
        {...returnFocus}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close
            data-slot="dialog-close-button"
            aria-label={closeLabel}
            className={cn(
              buttonVariants({ variant: 'quiet', size: 'icon' }),
              'absolute end-3 top-3 wide:end-4 wide:top-4',
            )}
          >
            <X aria-hidden="true" />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        'flex flex-col gap-2 text-start group-data-[with-close=true]/dialog:pe-[52px]',
        className,
      )}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-footer" className={cn(dialogFooterClass, className)} {...props} />
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-title-lg', className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-body-md text-foreground-secondary', className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  dialogContentVariants,
  dialogFooterClass,
  overlayClass,
}
