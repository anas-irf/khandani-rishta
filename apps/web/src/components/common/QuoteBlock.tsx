import { cn } from '~/lib/utils'
import { PlainText } from './PlainText'

/**
 * A member's own words in a quote: the fill of a tonal block with the 3 gold bar at the start
 * (DESIGN.md 4.2), shown in full. Renders nothing for empty text.
 */
export function QuoteBlock({
  text,
  className,
}: {
  text: string | null | undefined
  className?: string
}) {
  if (!text) return null
  return (
    <blockquote
      data-slot="quote"
      className={cn(
        'tonal rounded-sm border-s-[3px] border-accent-decor px-4 py-3 text-body-sm text-foreground wide:text-body-md',
        className,
      )}
    >
      <PlainText text={text} />
    </blockquote>
  )
}
