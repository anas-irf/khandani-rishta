import { cn } from '~/lib/utils'

/** "91%", wherever the translation puts it. Digits are Western in both languages (17 section 12). */
const PERCENT = /\d+\s?%/

/** A sentence with its percentage set bold in tabular figures: "87% match", "fits 94% of". */
export function Percent({ text, className }: { text: string; className?: string }) {
  const match = PERCENT.exec(text)
  if (!match) return <>{text}</>
  return (
    <>
      {text.slice(0, match.index)}
      <strong className={cn('font-bold tabular-nums', className)}>{match[0]}</strong>
      {text.slice(match.index + match[0].length)}
    </>
  )
}
