import type { ComponentProps } from 'react'
import { cn } from '~/lib/utils'

/** A key of the console's shortcuts. It takes the colour of the control it sits in. */
export function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'inline-flex min-w-[24px] justify-center rounded-check border border-current px-1 font-sans text-caption leading-[1.3] tabular-nums',
        className,
      )}
      {...props}
    />
  )
}
