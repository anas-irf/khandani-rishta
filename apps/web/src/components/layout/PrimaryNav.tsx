import { Link } from '@tanstack/react-router'
import { Heart, House, type LucideIcon, MessageCircle, Search, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Me } from '~/lib/api-types'
import { useCurrentMe } from '~/lib/me'
import { badgeCount, cn } from '~/lib/utils'

type Destination = {
  to: '/home' | '/search' | '/interests' | '/chats' | '/me'
  labelKey: string
  icon: LucideIcon
  badge: (me: Me) => number
  dot?: (me: Me) => boolean
}

/** The five primary destinations and their badges (16 sections 2.1 and 2.4). */
export const PRIMARY_DESTINATIONS: Destination[] = [
  { to: '/home', labelKey: 'nav.home', icon: House, badge: () => 0 },
  { to: '/search', labelKey: 'nav.search', icon: Search, badge: () => 0 },
  {
    to: '/interests',
    labelKey: 'nav.interests',
    icon: Heart,
    badge: (me) => me.counters.pending_interests,
  },
  {
    to: '/chats',
    labelKey: 'nav.chats',
    icon: MessageCircle,
    badge: (me) => me.counters.unread_chats,
  },
  {
    to: '/me',
    labelKey: 'nav.me',
    icon: UserRound,
    badge: () => 0,
    dot: (me) => me.profile.completeness < 70 || me.counters.pending_photo_requests > 0,
  },
]

function CountBadge({ count, className }: { count: number; className?: string }) {
  const { t } = useTranslation()
  const text = badgeCount(count)
  if (!text) return null
  return (
    <span
      className={cn(
        'inline-flex min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-xs font-semibold leading-5 text-danger-foreground',
        className,
      )}
    >
      <span aria-hidden>{text}</span>
      <span className="sr-only">{t('nav.badge_count', { count })}</span>
    </span>
  )
}

function AttentionDot({ className }: { className?: string }) {
  const { t } = useTranslation()
  return (
    <span className={cn('inline-block size-2.5 rounded-full bg-danger', className)}>
      <span className="sr-only">{t('nav.attention_dot')}</span>
    </span>
  )
}

/** Text links in the wide top bar. */
export function TopNavLinks() {
  const { t } = useTranslation()
  const me = useCurrentMe()
  return (
    <nav aria-label={t('nav.primary_label')} className="flex items-center gap-1">
      {PRIMARY_DESTINATIONS.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          className="relative inline-flex min-h-11 items-center gap-2 rounded-md px-3 font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          activeProps={{ className: 'text-primary', 'aria-current': 'page' }}
        >
          {t(item.labelKey)}
          <CountBadge count={item.badge(me)} />
          {item.dot?.(me) ? <AttentionDot /> : null}
        </Link>
      ))}
    </nav>
  )
}

/** The bottom bar on narrow screens (17 section 9.1). */
export function BottomNav() {
  const { t } = useTranslation()
  const me = useCurrentMe()
  return (
    <nav
      aria-label={t('nav.primary_label')}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="grid grid-cols-5">
        {PRIMARY_DESTINATIONS.map((item) => {
          const Icon = item.icon
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                className="flex min-h-16 flex-col items-center justify-center gap-0.5 text-sm text-muted-foreground"
                activeProps={{ className: 'text-primary font-semibold', 'aria-current': 'page' }}
              >
                <span className="relative">
                  <Icon className="size-6" aria-hidden />
                  <CountBadge count={item.badge(me)} className="absolute -top-2 -end-3" />
                  {item.dot?.(me) ? <AttentionDot className="absolute -top-0.5 -end-1" /> : null}
                </span>
                {t(item.labelKey)}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export { CountBadge }
