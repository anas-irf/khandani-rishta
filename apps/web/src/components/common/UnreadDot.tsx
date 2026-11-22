import type { ComponentProps } from 'react'
import { cn } from '~/lib/utils'

/** The mark of an item not seen yet (16 sections 6.9 and 6.15), always with words for screen readers. */
export function UnreadDot({
  label,
  className,
  ...props
}: ComponentProps<'span'> & { label: string }) {
  return (
    <span data-slot="unread-dot" className={cn('inline-flex shrink-0', className)} {...props}>
      <span aria-hidden="true" className="size-[11px] rounded-pill bg-primary" />
      <span className="sr-only">{label}</span>
    </span>
  )
}
