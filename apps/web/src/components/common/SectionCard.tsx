import { Link } from '@tanstack/react-router'
import { Pencil } from 'lucide-react'
import { type ReactNode, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/button'
import { cn } from '~/lib/utils'
import { SectionHeading } from './SectionHeading'

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

/**
 * A titled group with an optional "Edit" action (17 section 10, DESIGN.md 6.10): the diamond
 * heading and what belongs to it, with no box and no shadow. The band it sits in separates it
 * from the next group, so give groups `Band`s or a `BandStack`.
 */
export function SectionCard({
  title,
  titleAs,
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
      <Button asChild variant="link">
        <Link to={editTo} aria-label={editLabel}>
          <Pencil aria-hidden="true" />
          {t('section.edit')}
        </Link>
      </Button>
    )
  } else if (!headerAction && onEdit) {
    headerAction = (
      <Button variant="link" onClick={onEdit} aria-label={editLabel}>
        <Pencil aria-hidden="true" />
        {t('section.edit')}
      </Button>
    )
  }

  return (
    <section
      aria-labelledby={headingId}
      data-slot="section-card"
      className={cn('flex min-w-0 flex-col gap-3', className)}
    >
      <SectionHeading
        id={headingId}
        as={titleAs}
        title={title}
        description={description}
        action={headerAction}
      />
      {children}
    </section>
  )
}
