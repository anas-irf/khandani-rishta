import type { ReactNode } from 'react'
import { cn } from '~/lib/utils'

/** The gold diamond. Decoration only: it never carries meaning on its own (DESIGN.md 2.2). */
export function Diamond({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block size-[8px] shrink-0 rotate-45 bg-accent-decor', className)}
    />
  )
}

/** A title after its diamond, which stays on the first line when the title wraps. */
export function DiamondTitle({ children }: { children: ReactNode }) {
  return (
    <span className="flex max-w-full min-w-0 items-start gap-3">
      <span aria-hidden="true" className="flex h-[1lh] shrink-0 items-center">
        <Diamond />
      </span>
      <span className="min-w-0">{children}</span>
    </span>
  )
}

/** A gold hairline with its diamond: at the start of a heading, or centred on both sides. */
export function OrnamentRule({
  centered = false,
  className,
}: {
  centered?: boolean
  className?: string
}) {
  const line = <span className="h-px w-[44px] bg-accent-decor" />
  return (
    <span aria-hidden="true" className={cn('flex items-center gap-3', className)}>
      {centered ? line : null}
      <Diamond
        className={cn('size-[7px]', centered && 'border border-accent-decor bg-transparent')}
      />
      {line}
    </span>
  )
}
