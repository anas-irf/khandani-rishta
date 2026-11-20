import type * as React from 'react'
import { cn } from '~/lib/utils'

/** Text input. 16px text on purpose: smaller text makes iOS Safari zoom in when focused. */
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-11 w-full min-w-0 rounded-[var(--radius-input)] border border-input bg-surface px-3 py-1 text-base text-foreground transition-colors file:me-3 file:inline-flex file:h-full file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-danger aria-invalid:ring-danger/20 aria-invalid:focus-visible:ring-danger',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
