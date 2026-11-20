import { cn } from '~/lib/utils'

/**
 * Member-written text (about me, messages, notes): always plain text, never HTML, with its
 * own direction (`dir="auto"`) and its line breaks kept. Links inside it are not made
 * clickable (17 section 14). Renders nothing for null or empty text.
 */
export function PlainText({
  text,
  as: Element = 'p',
  className,
}: {
  text: string | null | undefined
  as?: 'p' | 'div' | 'span'
  className?: string
}) {
  if (!text) return null
  return (
    <Element dir="auto" className={cn('whitespace-pre-line break-words', className)}>
      {text}
    </Element>
  )
}
