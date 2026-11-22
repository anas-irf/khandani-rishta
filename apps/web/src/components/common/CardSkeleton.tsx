import { Skeleton } from '~/components/ui/skeleton'
import { cn } from '~/lib/utils'
import type { ProfileCardSize } from './ProfileCard'

/**
 * The loading shape of a `ProfileCard` (16 rule G1). Hidden from screen readers; the list
 * around it announces the loading state once.
 */
export function CardSkeleton({
  size = 'full',
  className,
}: {
  size?: ProfileCardSize
  className?: string
}) {
  if (size === 'compact') {
    return (
      <div
        aria-hidden="true"
        data-skeleton="card-compact"
        className={cn('flex items-start gap-4 border-b border-border py-3', className)}
      >
        <Skeleton className="h-[76px] w-[60px] shrink-0 rounded-arch" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-6 w-3/5" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-6 w-2/5 rounded-pill" />
        </div>
      </div>
    )
  }

  if (size === 'tile') {
    return (
      <div
        aria-hidden="true"
        data-skeleton="card-tile"
        className={cn('flex w-[156px] shrink-0 flex-col gap-2', className)}
      >
        <Skeleton className="h-[195px] w-full rounded-arch" />
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    )
  }

  return (
    <div
      aria-hidden="true"
      data-skeleton="card-full"
      className={cn('flex min-w-0 flex-col gap-3 wide:row-span-5', className)}
    >
      <Skeleton className="aspect-[4/5] w-full rounded-arch" />
      <Skeleton className="h-7 w-3/4" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-[48px] w-full rounded-pill" />
    </div>
  )
}
