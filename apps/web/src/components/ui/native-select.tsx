import { ChevronDown } from 'lucide-react'
import type * as React from 'react'
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
    <div data-slot="native-select-wrapper" className={cn('relative w-full', wrapperClassName)}>
      <select
        data-slot="native-select"
        className={cn(
          'peer h-11 w-full min-w-0 appearance-none rounded-[var(--radius-input)] border border-input bg-surface ps-3 pe-10 text-base text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-danger aria-invalid:ring-danger/20 aria-invalid:focus-visible:ring-danger',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground peer-disabled:opacity-60"
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
