import type { ReactNode } from 'react'
import { cn } from '~/lib/utils'
import { DiamondTitle, OrnamentRule } from './Ornament'

export type SectionHeadingProps = {
  title: ReactNode
  /** Heading level that fits the page outline (default h2). */
  as?: 'h2' | 'h3'
  /** Id of the heading, for the section's `aria-labelledby`. */
  id?: string
  /**
   * - `diamond` (default): the 8 gold diamond before the title, for groups (DESIGN.md 6.10).
   * - `rule`: the short rule above it, for the matches of Home. Phones leave it out (6.21).
   */
  ornament?: 'diamond' | 'rule' | 'none'
  description?: ReactNode
  /** A control at the end: "See all", "Edit". It moves under the title when it no longer fits. */
  action?: ReactNode
  className?: string
}

/** The ornamented title of a section, at 24 / 700 (DESIGN.md 3.2). */
export function SectionHeading({
  title,
  as: Heading = 'h2',
  id,
  ornament = 'diamond',
  description,
  action,
  className,
}: SectionHeadingProps) {
  return (
    <div
      data-slot="section-heading"
      className={cn(
        'flex flex-wrap justify-between gap-x-4',
        // With a line under the title the action joins that line, otherwise the title's own.
        description ? 'items-end' : 'items-center',
        className,
      )}
    >
      <div className="flex min-w-[min(100%,12rem)] flex-1 flex-col gap-1">
        {ornament === 'rule' ? <OrnamentRule className="mb-1 max-wide:hidden" /> : null}
        <Heading id={id} className="max-w-full text-headline-sm">
          {ornament === 'diamond' ? <DiamondTitle>{title}</DiamondTitle> : title}
        </Heading>
        {description ? <p className="text-body-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}
