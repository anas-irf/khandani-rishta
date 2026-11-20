import { Check, Minus } from 'lucide-react'
import { Checkbox as CheckboxPrimitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '~/lib/utils'

/*
 * Touch target note: the visible box is 20px (size-5), but the `after:` pseudo-element extends
 * the clickable area of the button itself to 44px by 44px. The clickable area of the whole
 * control should still be larger: always wrap the checkbox and its text in one `<label>` (or
 * pair it with `<Label htmlFor>`) with `min-h-11`, so tapping the text toggles it too.
 *
 * The unchecked border uses `border-muted-foreground` (not `border-input`) so the box meets the
 * 3 to 1 non-text contrast ratio.
 */
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "group relative inline-flex size-5 shrink-0 items-center justify-center rounded-[5px] border border-muted-foreground bg-surface text-primary-foreground transition-colors after:absolute after:-inset-3 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger aria-invalid:focus-visible:ring-danger data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current"
      >
        <Check aria-hidden="true" className="size-3.5 group-data-[state=indeterminate]:hidden" />
        <Minus
          aria-hidden="true"
          className="hidden size-3.5 group-data-[state=indeterminate]:block"
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
