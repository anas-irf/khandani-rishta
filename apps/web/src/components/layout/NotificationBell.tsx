import { Link } from '@tanstack/react-router'
import { Bell } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCurrentMe } from '~/lib/me'
import { cn } from '~/lib/utils'
import { CountBadge } from './PrimaryNav'

/**
 * The bell that opens APP-NOTIFS (16 section 2.2): in the top bar of every screen on wide
 * screens and in the top bar of APP-HOME on narrow ones. The badge follows
 * `counters.unread_notifications` (14 section 8.2).
 */
export function NotificationBell({ className }: { className?: string }) {
  const { t } = useTranslation()
  const me = useCurrentMe()
  const count = me.counters.unread_notifications
  return (
    <Link
      to="/notifications"
      aria-label={count > 0 ? t('nav.notifications_count', { count }) : t('nav.notifications')}
      className={cn(
        'relative inline-flex size-11 items-center justify-center rounded-full text-foreground hover:bg-muted',
        className,
      )}
    >
      <Bell className="size-6" aria-hidden />
      <CountBadge count={count} className="absolute top-0.5 end-0.5" />
    </Link>
  )
}
