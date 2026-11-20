import { Loader2 } from 'lucide-react'
import type * as React from 'react'
import { cn } from '~/lib/utils'

type SpinnerProps = Omit<React.ComponentProps<'span'>, 'children'> & {
  /** Text announced to screen readers. */
  label?: string
}

/** A spinning loader icon announced as a status. `className` sizes the icon (default `size-5`). */
function Spinner({ className, label = 'Loading', ...props }: SpinnerProps) {
  return (
    <span data-slot="spinner" role="status" className="inline-flex items-center" {...props}>
      <Loader2 aria-hidden="true" className={cn('size-5 animate-spin', className)} />
      <span className="sr-only">{label}</span>
    </span>
  )
}

export type { SpinnerProps }
export { Spinner }
