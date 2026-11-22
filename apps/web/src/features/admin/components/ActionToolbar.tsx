import type { ReactNode } from 'react'
import { useBarHeight } from '~/lib/media'

/**
 * The decisions of a detail screen, in a bar that stays at the top while the record scrolls. The
 * console has no app bar, so it publishes its height as that bar and focus stays clear of it.
 */
export function ActionToolbar({ label, children }: { label: string; children: ReactNode }) {
  const ref = useBarHeight('--app-bar')
  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={label}
      className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-background py-2"
    >
      {children}
    </div>
  )
}
