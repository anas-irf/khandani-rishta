import { X } from 'lucide-react'
import { Dialog as SheetPrimitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '~/lib/utils'

function Sheet(props: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger(props: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose(props: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal(props: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-foreground/50 motion-safe:transition-opacity motion-safe:duration-200 motion-safe:starting:opacity-0',
        className,
      )}
      {...props}
    />
  )
}

type SheetSide = 'start' | 'end' | 'top' | 'bottom'

// Logical sides: `start` and `end` follow the writing direction, so the sheet and its slide-in
// animation flip in right-to-left layouts. `ltr:` and `rtl:` pick the slide-in direction.
const sideClasses: Record<SheetSide, string> = {
  start:
    'inset-y-0 start-0 h-full w-3/4 max-w-sm border-e motion-safe:starting:ltr:-translate-x-full motion-safe:starting:rtl:translate-x-full',
  end: 'inset-y-0 end-0 h-full w-3/4 max-w-sm border-s motion-safe:starting:ltr:translate-x-full motion-safe:starting:rtl:-translate-x-full',
  top: 'inset-x-0 top-0 h-auto max-h-[90dvh] border-b motion-safe:starting:-translate-y-full',
  bottom:
    'inset-x-0 bottom-0 h-auto max-h-[90dvh] rounded-t-[var(--radius-card)] border-t motion-safe:starting:translate-y-full',
}

type SheetContentProps = React.ComponentProps<typeof SheetPrimitive.Content> & {
  /** Edge the sheet slides in from. Defaults to `end`. */
  side?: SheetSide
  /** Shows the X button in the corner. */
  showCloseButton?: boolean
  /** Accessible name of the X button. Pass the translated text. */
  closeLabel?: string
}

/** Give every sheet a `SheetTitle`, and a `SheetDescription` (or `aria-describedby={undefined}`). */
function SheetContent({
  className,
  children,
  side = 'end',
  showCloseButton = true,
  closeLabel = 'Close',
  ...props
}: SheetContentProps) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        data-with-close={showCloseButton}
        className={cn(
          'group/sheet fixed z-50 flex flex-col gap-4 overflow-y-auto border-border bg-surface p-5 text-foreground shadow-lg focus-visible:outline-none motion-safe:transition-[translate] motion-safe:duration-200',
          sideClasses[side],
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <SheetPrimitive.Close
            data-slot="sheet-close-button"
            aria-label={closeLabel}
            className="absolute end-2 top-2 inline-flex size-11 items-center justify-center rounded-[var(--radius-input)] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&_svg]:size-5"
          >
            <X aria-hidden="true" />
          </SheetPrimitive.Close>
        ) : null}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn(
        'flex flex-col gap-1.5 text-start group-data-[with-close=true]/sheet:pe-9',
        className,
      )}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn('mt-auto flex flex-col gap-2', className)}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('text-lg font-semibold leading-snug', className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export type { SheetSide }
export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
}
