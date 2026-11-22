import { Link } from '@tanstack/react-router'
import { House, type LucideIcon, Mail, MessageSquare, Search, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AttentionMark, CountBadge } from '~/components/common/CountBadge'
import type { Me } from '~/lib/api-types'
import { useCurrentMe } from '~/lib/me'
import { useBarHeight } from '~/lib/media'
import { cn } from '~/lib/utils'

type Destination = {
  to: '/home' | '/search' | '/interests' | '/chats' | '/me'
  labelKey: string
  icon: LucideIcon
  badge: (me: Me) => number
  /** Primary for interests, inverse for chats (DESIGN.md 6.19). */
  badgeTone?: 'primary' | 'inverse'
  dot?: (me: Me) => boolean
}

/**
 * The five primary destinations and their badges (16 sections 2.1 and 2.4). The envelope is
 * Interests: the heart belongs to Shortlist alone.
 */
export const PRIMARY_DESTINATIONS: Destination[] = [
  { to: '/home', labelKey: 'nav.home', icon: House, badge: () => 0 },
  { to: '/search', labelKey: 'nav.search', icon: Search, badge: () => 0 },
  {
    to: '/interests',
    labelKey: 'nav.interests',
    icon: Mail,
    badge: (me) => me.counters.pending_interests,
    badgeTone: 'primary',
  },
  {
    to: '/chats',
    labelKey: 'nav.chats',
    icon: MessageSquare,
    badge: (me) => me.counters.unread_chats,
    badgeTone: 'inverse',
  },
  {
    to: '/me',
    labelKey: 'nav.me',
    icon: UserRound,
    badge: () => 0,
    dot: (me) => me.profile.completeness < 70 || me.counters.pending_photo_requests > 0,
  },
]

/** The pills of the wide top bar (DESIGN.md 6.16): 48 tall, the current one in primary soft. */
export function TopNavLinks({ className }: { className?: string }) {
  const { t } = useTranslation()
  const me = useCurrentMe()
  return (
    <nav aria-label={t('nav.primary_label')} className={cn('min-w-0', className)}>
      <ul className="flex flex-wrap items-center gap-2 xl:ps-3">
        {PRIMARY_DESTINATIONS.map((item) => (
          <li key={item.to} className="max-w-full">
            <Link
              to={item.to}
              className="inline-flex min-h-touch max-w-full items-center gap-2 rounded-pill px-[12px] py-[8px] text-label-lg text-foreground transition-colors hover:bg-muted lg:px-[8px] xl:px-[16px] data-[status=active]:bg-primary-soft data-[status=active]:text-primary"
            >
              {t(item.labelKey)}
              <CountBadge count={item.badge(me)} tone={item.badgeTone} />
              {item.dot?.(me) ? <AttentionMark /> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/**
 * The bottom bar on narrow screens (17 section 9.1, DESIGN.md 6.17): five equal tabs, 64 tall
 * plus the inset. At larger text they take a second row and no label is cut.
 */
export function BottomNav() {
  const { t } = useTranslation()
  const me = useCurrentMe()
  const ref = useBarHeight('--bottom-nav')
  return (
    <nav
      ref={ref}
      data-slot="bottom-nav"
      aria-label={t('nav.primary_label')}
      className="sticky bottom-0 z-30 border-t border-border bg-background pb-[env(safe-area-inset-bottom)] wide:hidden"
    >
      <ul className="flex flex-wrap px-1 py-1">
        {PRIMARY_DESTINATIONS.map((item) => {
          const Icon = item.icon
          const count = item.badge(me)
          const attention = item.dot?.(me) ?? false
          return (
            <li key={item.to} className="min-w-max flex-[1_1_0]">
              <Link
                to={item.to}
                className="group/tab flex min-h-[64px] min-w-touch flex-col items-center justify-center gap-1 rounded-md px-[3px] py-1 text-label-sm text-muted-foreground -outline-offset-3 data-[status=active]:font-bold data-[status=active]:text-primary"
              >
                <span className="relative flex h-[32px] w-[60px] max-w-full items-center justify-center rounded-pill transition-colors group-data-[status=active]/tab:bg-primary-soft">
                  <Icon aria-hidden="true" strokeWidth={1.8} className="size-[24px]" />
                  <CountBadge
                    count={count}
                    tone={item.badgeTone}
                    size="small"
                    decorative
                    className="absolute end-0 bottom-[16px]"
                  />
                  {attention ? (
                    <AttentionMark decorative className="absolute end-[14px] top-[2px]" />
                  ) : null}
                </span>
                {t(item.labelKey)}
                {/* Read after the label: "Interests 3 new". */}
                {count > 0 ? (
                  <span className="sr-only"> {t('nav.badge_count', { count })}</span>
                ) : null}
                {attention ? <span className="sr-only"> {t('nav.attention_dot')}</span> : null}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
