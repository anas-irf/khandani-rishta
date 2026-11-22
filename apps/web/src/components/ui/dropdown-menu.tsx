import { Check, ChevronRight } from 'lucide-react'
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui'
import type * as React from 'react'
import { rememberMenuOpener } from '~/lib/focus'
import { cn } from '~/lib/utils'

// Radix reads the text direction from `DirectionProvider`, not from `<html dir>`. Mount
// `<DirectionProvider dir={...}>` (from 'radix-ui') at the app root so menus open and navigate
// correctly in right-to-left layouts.

// DESIGN.md 6.18: surface, hairline, 24 radius, the menu shadow. Items are 48 tall and may wrap.
const contentBase =
  'z-50 flex max-w-[min(320px,calc(100vw-16px))] origin-(--radix-dropdown-menu-content-transform-origin) flex-col gap-1 overflow-x-hidden rounded-lg border border-border bg-surface p-2 text-foreground shadow-menu [--tonal:var(--color-muted)] motion-safe:transition-[opacity,scale] motion-safe:starting:scale-95 motion-safe:starting:opacity-0'

const itemBase =
  'relative flex min-h-touch shrink-0 cursor-pointer select-none items-center gap-3 rounded-item px-4 py-2 text-start text-body-md transition-colors -outline-offset-3 data-disabled:cursor-default data-disabled:text-muted-foreground data-highlighted:bg-muted [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-5 [&_svg:not([class*="text-"])]:text-muted-foreground'

function DropdownMenu(props: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuPortal(props: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  return <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
}

function DropdownMenuTrigger(props: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

/**
 * Opening moves focus to the first item, and Escape gives it back to the button. Radix does the
 * first for the keyboard only, so the first focus that lands on the menu itself is handed on.
 */
function DropdownMenuContent({
  className,
  sideOffset = 8,
  collisionPadding = 8,
  onFocus,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  const focusFirstItem = (event: React.FocusEvent<HTMLDivElement>) => {
    onFocus?.(event)
    const menu = event.currentTarget
    if (menu.dataset.focused) return
    menu.dataset.focused = 'true'
    rememberMenuOpener(menu)
    if (event.target !== menu) return
    menu.querySelector<HTMLElement>('[role^="menuitem"]:not([data-disabled])')?.focus()
  }

  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        onFocus={focusFirstItem}
        className={cn(
          contentBase,
          'max-h-(--radix-dropdown-menu-content-available-height) min-w-[240px] overflow-y-auto',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

function DropdownMenuGroup(props: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
}

function DropdownMenuItem({
  className,
  inset,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  /** Indents the item to line up with items that have a check or radio indicator. */
  inset?: boolean
  variant?: 'default' | 'destructive'
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        itemBase,
        'data-[inset=true]:ps-11 data-[variant=destructive]:text-danger data-[variant=destructive]:data-highlighted:bg-danger-soft data-[variant=destructive]:[&_svg]:text-danger!',
        className,
      )}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(itemBase, 'ps-11', className)}
      checked={checked}
      {...props}
    >
      <span className="pointer-events-none absolute start-3.5 flex size-5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check aria-hidden="true" className="size-5 text-primary" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup(
  props: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>,
) {
  return <DropdownMenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />
}

function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(itemBase, 'ps-11', className)}
      {...props}
    >
      <span className="pointer-events-none absolute start-3.5 flex size-5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <span className="block size-2.5 rounded-pill bg-primary" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  )
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & { inset?: boolean }) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        'px-4 py-2 text-body-sm text-muted-foreground data-[inset=true]:ps-11',
        className,
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn('mx-2 my-1 h-px shrink-0 bg-border', className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn('ms-auto text-caption text-muted-foreground', className)}
      {...props}
    />
  )
}

function DropdownMenuSub(props: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & { inset?: boolean }) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(itemBase, 'data-[inset=true]:ps-11 data-[state=open]:bg-muted', className)}
      {...props}
    >
      {children}
      <ChevronRight aria-hidden="true" className="ms-auto size-5 rtl:-scale-x-100" />
    </DropdownMenuPrimitive.SubTrigger>
  )
}

function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.SubContent
      data-slot="dropdown-menu-sub-content"
      className={cn(contentBase, 'min-w-[180px]', className)}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
}
