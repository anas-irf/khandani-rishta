import type * as React from 'react'
import { cn } from '~/lib/utils'

/**
 * A loading placeholder. Hidden from screen readers: announce the loading state once, in the
 * region that contains the skeletons (for example `aria-busy` plus a status message).
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="skeleton" aria-hidden="true" className={cn('skeleton', className)} {...props} />
  )
}

export { Skeleton }
