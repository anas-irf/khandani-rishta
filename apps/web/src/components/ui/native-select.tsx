import { ChevronDown } from 'lucide-react'
import type * as React from 'react'
import { controlVariants } from '~/components/ui/input'
import { cn } from '~/lib/utils'

/**
 * A styled native `<select>`. Native selects are preferred on phones: the platform picker is
 * accessible and familiar. `className` applies to the `<select>`; `wrapperClassName` to the
 * positioning wrapper.
 */
function NativeSelect({
  className,
  wrapperClassName,
  children,
  ...props
}: React.ComponentProps<'select'> & { wrapperClassName?: string }) {
  return (
    <div
      data-slot="native-select-wrapper"
      className={cn('relative w-full min-w-0 max-w-full', wrapperClassName)}
    >
      <select
        data-slot="native-select"
        className={cn('peer', controlVariants({ control: 'select' }), className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute end-[10px] top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  )
}

function NativeSelectOption(props: React.ComponentProps<'option'>) {
  return <option data-slot="native-select-option" {...props} />
}

function NativeSelectOptGroup(props: React.ComponentProps<'optgroup'>) {
  return <optgroup data-slot="native-select-optgroup" {...props} />
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption }
