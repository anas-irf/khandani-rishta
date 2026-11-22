import { cva, type VariantProps } from 'class-variance-authority'
import { useTranslation } from 'react-i18next'
import { badgeCount, cn } from '~/lib/utils'

const countBadgeVariants = cva(
  'inline-flex shrink-0 items-center justify-center rounded-pill text-label-sm leading-[1.4] font-bold tabular-nums',
  {
    variants: {
      tone: {
        /** Interests. */
        primary: 'bg-primary text-primary-foreground',
        /** Chats and notifications. */
        inverse: 'bg-inverse text-background',
      },
      size: {
        default: 'min-h-[24px] min-w-[max(24px,1.4em)] px-[7px]',
        /** On the icons of the bars. */
        small: 'min-h-[22px] min-w-[max(22px,1.4em)] px-[6px]',
      },
    },
    defaultVariants: { tone: 'primary', size: 'default' },
  },
)

/**
 * A count in a pill (DESIGN.md 6.19, 16 section 2.4): "99+" above 99, nothing at zero, and always
 * words for screen readers.
 */
export function CountBadge({
  count,
  label,
  decorative = false,
  tone,
  size,
  className,
}: {
  count: number
  /** The words read out (default "{n} new"). */
  label?: string
  /** When the control around it already says the count in its own name. */
  decorative?: boolean
  className?: string
} & VariantProps<typeof countBadgeVariants>) {
  const { t } = useTranslation()
  const text = badgeCount(count)
  if (!text) return null
  return (
    <span
      data-slot="count-badge"
      aria-hidden={decorative || undefined}
      className={cn(countBadgeVariants({ tone, size }), className)}
    >
      <span aria-hidden="true">{text}</span>
      {decorative ? null : (
        <span className="sr-only">{label ?? t('nav.badge_count', { count })}</span>
      )}
    </span>
  )
}

/** The gold diamond on "Me" when the profile needs attention, with its words (DESIGN.md 6.17). */
export function AttentionMark({
  decorative = false,
  className,
}: {
  /** When the control around it already says the words. */
  decorative?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <span data-slot="attention-mark" className={cn('inline-flex', className)}>
      <span aria-hidden="true" className="size-[9px] rotate-45 bg-accent" />
      {decorative ? null : <span className="sr-only">{t('nav.attention_dot')}</span>}
    </span>
  )
}
