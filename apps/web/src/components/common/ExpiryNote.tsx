import { Clock } from 'lucide-react'
import { cn } from '~/lib/utils'

const SOON_MS = 3 * 24 * 60 * 60 * 1000

/**
 * When an interest expires (DESIGN.md 6.12): a clock and the words, muted. In the last 3 days it
 * takes the attention colour on attention soft and keeps the icon, so colour is never alone.
 */
export function ExpiryNote({
  expiresAt,
  text,
  className,
}: {
  expiresAt: string
  /** "Expires {date}", in the screen's own words. */
  text: string
  className?: string
}) {
  const soon = new Date(expiresAt).getTime() - Date.now() <= SOON_MS
  return (
    <p
      data-expires-soon={soon || undefined}
      className={cn(
        'flex w-fit max-w-full items-start gap-1.5 text-caption',
        soon
          ? 'rounded-lg bg-warning-soft px-[12px] py-[4px] font-semibold text-warning'
          : 'text-muted-foreground',
        className,
      )}
    >
      <span aria-hidden="true" className="flex h-[1lh] items-center">
        <Clock className="size-4" />
      </span>
      <span className="min-w-0">{text}</span>
    </p>
  )
}
