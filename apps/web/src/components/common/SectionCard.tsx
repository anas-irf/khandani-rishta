import { Link } from '@tanstack/react-router'
import { Pencil } from 'lucide-react'
import { type ReactNode, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/button'
import { cn } from '~/lib/utils'

export type SectionCardProps = {
  title: string
  /** Heading level that fits the page outline (default h2). */
  titleAs?: 'h2' | 'h3'
  /** Line under the title. */
  description?: ReactNode
  /** Path of the edit screen: renders an "Edit" link. */
  editTo?: string
  /** Renders an "Edit" button instead of a link. */
  onEdit?: () => void
  /** Any other control for the header, in place of the edit action. */
  action?: ReactNode
  children?: ReactNode
  className?: string
}

/** A titled card with an optional "Edit" action (17 section 10). */
export function SectionCard({
  title,
  titleAs: Heading = 'h2',
  description,
  editTo,
  onEdit,
  action,
  children,
  className,
}: SectionCardProps) {
  const { t } = useTranslation('shared')
  const headingId = useId()
  const editLabel = t('section.edit_named', { title })

  let headerAction: ReactNode = action ?? null
  if (!headerAction && editTo) {
    headerAction = (
      <Button asChild variant="ghost" className="-me-2 text-primary">
        <Link to={editTo} aria-label={editLabel}>
          <Pencil aria-hidden="true" />
          {t('section.edit')}
        </Link>
      </Button>
    )
  } else if (!headerAction && onEdit) {
    headerAction = (
      <Button
        variant="ghost"
        className="-me-2 text-primary"
        onClick={onEdit}
        aria-label={editLabel}
      >
        <Pencil aria-hidden="true" />
        {t('section.edit')}
      </Button>
    )
  }

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 shadow-sm md:p-5',
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Heading id={headingId} className="text-lg font-semibold leading-snug">
            {title}
          </Heading>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {headerAction}
      </header>
      {children}
    </section>
  )
}
