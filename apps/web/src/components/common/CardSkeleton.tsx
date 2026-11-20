import { Skeleton } from '~/components/ui/skeleton'
import { cn } from '~/lib/utils'

/**
 * The loading shape of a `ProfileCard` (16 rule G1). Hidden from screen readers; the list
 * around it announces the loading state once.
 */
export function CardSkeleton({
  size = 'full',
  className,
}: {
  size?: 'full' | 'compact'
  className?: string
}) {
  if (size === 'compact') {
    return (
      <div
        aria-hidden="true"
        data-skeleton="card-compact"
        className={cn(
          'flex items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-3',
          className,
        )}
      >
        <Skeleton className="size-18 shrink-0 rounded-[var(--radius-input)]" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-5 w-2/5" />
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
    )
  }

  return (
    <div
      aria-hidden="true"
      data-skeleton="card-full"
      className={cn(
        'flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface',
        className,
      )}
    >
      <Skeleton className="aspect-[4/5] w-full rounded-none" />
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-6 w-24 rounded-full" />
      </div>
    </div>
  )
}
