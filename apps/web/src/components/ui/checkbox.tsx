import { Check, Minus } from 'lucide-react'
import { Checkbox as CheckboxPrimitive } from 'radix-ui'
import type * as React from 'react'
import { cn } from '~/lib/utils'

/*
 * DESIGN.md 6.13: a 26 box with a 7 radius and the control border (3.6:1), primary when checked.
 * `tap-target` grows the hit area to 48 by 48. Wrap the box and its text in one `<label>` (or
 * pair it with `<Label htmlFor>`) with `min-h-touch`, so tapping the text toggles it too.
 */
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'group tap-target inline-flex size-[26px] shrink-0 items-center justify-center rounded-check border-[1.5px] border-input bg-surface text-primary-foreground transition-colors disabled:cursor-not-allowed disabled:bg-muted-strong aria-invalid:border-danger data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current"
      >
        <Check
          aria-hidden="true"
          strokeWidth={3}
          className="size-[16px] group-data-[state=indeterminate]:hidden"
        />
        <Minus
          aria-hidden="true"
          strokeWidth={3}
          className="hidden size-[16px] group-data-[state=indeterminate]:block"
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
