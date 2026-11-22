import { cn } from '~/lib/utils'

/**
 * Facts on one line, "Lahore · Software and IT · Divorced" (DESIGN.md 6.9). It wraps between
 * facts, and each keeps its dot, so a line never starts with one. Screen readers hear commas.
 */
export function MetaLine({
  parts,
  className,
}: {
  parts: readonly (string | null | undefined)[]
  className?: string
}) {
  const facts = parts.filter((part): part is string => Boolean(part))
  if (facts.length === 0) return null
  return (
    <p data-slot="meta-line" className={cn('text-body-md text-foreground-secondary', className)}>
      <span aria-hidden="true">
        {facts.map((fact, index) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: two facts may read the same (a city and its province).
            key={`${index}-${fact}`}
            className="me-[0.25em] inline-block max-w-full"
          >
            {fact}
            {index < facts.length - 1 ? ' ·' : ''}
          </span>
        ))}
      </span>
      <span className="sr-only">{facts.join(', ')}</span>
    </p>
  )
}
