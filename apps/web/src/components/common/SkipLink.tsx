import { cn } from '~/lib/utils'

/** The first tab stop of a layout: jumps to its main content. */
export function SkipLink({
  target = 'main',
  label,
  className,
}: {
  /** The id of the main landmark. */
  target?: string
  label: string
  className?: string
}) {
  return (
    <a
      href={`#${target}`}
      className={cn(
        'sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[60] focus:inline-flex focus:min-h-touch focus:items-center focus:rounded-pill focus:bg-surface focus:px-[22px] focus:py-[8px] focus:text-label-lg focus:text-primary focus:shadow-menu',
        className,
      )}
    >
      {label}
    </a>
  )
}
