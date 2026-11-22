import { Link } from '@tanstack/react-router'
import { Bell } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { CountBadge } from '~/components/common/CountBadge'
import { buttonVariants } from '~/components/ui/button'
import { useCurrentMe } from '~/lib/me'
import { cn } from '~/lib/utils'

/**
 * The link that opens APP-NOTIFS (16 section 2.2, DESIGN.md 6.16): a bell in the top bar of
 * APP-HOME on narrow screens, with its badge growing upwards and away from it, and a pill with
 * words in the top bar of every screen on wide ones. The badge follows
 * `counters.unread_notifications` (14 section 8.2).
 */
export function NotificationBell({
  variant = 'icon',
  className,
}: {
  variant?: 'icon' | 'pill'
  className?: string
}) {
  const { t } = useTranslation()
  const me = useCurrentMe()
  const count = me.counters.unread_notifications
  const pill = variant === 'pill'

  return (
    <Link
      to="/notifications"
      aria-label={count > 0 ? t('nav.notifications_count', { count }) : t('nav.notifications')}
      className={cn(
        pill
          ? buttonVariants({ variant: 'quiet', size: 'compact' })
          : buttonVariants({ variant: 'ghost', size: 'icon' }),
        pill ? 'min-w-touch text-label-md' : 'relative',
        className,
      )}
    >
      <Bell aria-hidden="true" strokeWidth={1.8} className={pill ? 'size-5' : 'size-[26px]'} />
      {pill ? <span className="hidden roomy:inline">{t('nav.notifications')}</span> : null}
      {/* A space between the words and the count, for software that reads the text. */}{' '}
      <CountBadge
        count={count}
        tone="inverse"
        size={pill ? 'default' : 'small'}
        decorative
        className={pill ? '-me-1' : 'absolute -end-1 bottom-[26px]'}
      />
    </Link>
  )
}
