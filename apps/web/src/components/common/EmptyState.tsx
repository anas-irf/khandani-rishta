import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '~/lib/utils'
import { Diamond } from './Ornament'

const ICON_TONE = {
  primary: 'text-primary',
  warning: 'text-warning',
  danger: 'text-danger',
} as const

/**
 * The standard empty state (16 rule G2, DESIGN.md 6.15): a sand panel with three arches and the
 * icon in the middle one, a title, a line of text and, where useful, the action. The copy comes
 * from the screen's entry in 16. Errors and status panels use the same panel.
 */
export function EmptyState({
  icon: Icon,
  tone = 'primary',
  title,
  titleAs: Title = 'h2',
  titleId,
  text,
  action,
  children,
  footnote,
  className,
}: {
  /** In the middle arch, in place of the diamond. */
  icon?: LucideIcon
  tone?: keyof typeof ICON_TONE
  title: string
  /** The level that fits the outline: `h1` when the state is the whole page (default `h2`). */
  titleAs?: 'h1' | 'h2' | 'h3'
  /** Id of the title, for a surrounding section's `aria-labelledby`. */
  titleId?: string
  text?: ReactNode
  /** One primary button or link, and at most a secondary one beside it. */
  action?: ReactNode
  /** More lines between the text and the action (relaxation hints). */
  children?: ReactNode
  /** Small print under the action (an error's reference). */
  footnote?: ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        'band-sand flex flex-wrap items-center gap-x-[clamp(32px,5vw,72px)] gap-y-6 rounded-xl p-[clamp(28px,4vw,52px)]',
        className,
      )}
    >
      <div aria-hidden="true" className="flex max-w-full items-end gap-2">
        <span className="h-[80px] w-[64px] shrink rounded-arch-inner border-[1.5px] border-dashed border-accent-decor" />
        <span className="flex h-[120px] w-[96px] shrink-0 items-center justify-center rounded-arch border-[1.5px] border-accent-decor">
          {Icon ? (
            <Icon strokeWidth={1.7} className={cn('size-[30px]', ICON_TONE[tone])} />
          ) : (
            <Diamond className="size-[10px]" />
          )}
        </span>
        <span className="h-[80px] w-[64px] shrink rounded-arch-inner border-[1.5px] border-dashed border-accent-decor" />
      </div>
      <div className="flex min-w-0 max-w-full flex-[1_1_360px] flex-col items-start gap-4">
        <Title id={titleId} className="max-w-full text-title-lg wide:text-headline-sm">
          {title}
        </Title>
        {text ? <p className="max-w-measure text-foreground-secondary">{text}</p> : null}
        {children}
        {action ? (
          <div className="flex max-w-full flex-wrap gap-3 [&_[data-slot=button]]:min-h-touch-lg [&_[data-slot=button]]:text-emphasis">
            {action}
          </div>
        ) : null}
        {footnote ? <p className="text-caption text-muted-foreground">{footnote}</p> : null}
      </div>
    </div>
  )
}
