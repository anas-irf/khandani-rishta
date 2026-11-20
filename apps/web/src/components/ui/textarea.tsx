import type * as React from 'react'
import { cn } from '~/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex min-h-24 w-full resize-y rounded-[var(--radius-input)] border border-input bg-surface px-3 py-2 text-base text-foreground transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-danger aria-invalid:ring-danger/20 aria-invalid:focus-visible:ring-danger',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
