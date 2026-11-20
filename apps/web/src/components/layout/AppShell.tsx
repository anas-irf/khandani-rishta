import { Link, useLocation } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { OfflineBanner } from '~/components/common/OfflineBanner'
import { gateHome, showsPrimaryNavigation } from '~/lib/gate'
import { useCurrentMe } from '~/lib/me'
import { AccountMenu } from './AccountMenu'
import { BrandLink } from './BrandLink'
import { NotificationBell } from './NotificationBell'
import { BottomNav, TopNavLinks } from './PrimaryNav'
import { useWarmRoutes } from './useWarmRoutes'

/**
 * Screens that show the primary navigation on narrow screens (16 section 2.1): the five
 * destinations and the list screens reached from them. Detail screens show their own back
 * arrow and title instead.
 */
const BOTTOM_BAR_PATHS = new Set([
  '/home',
  '/search',
  '/interests',
  '/chats',
  '/me',
  '/matches',
  '/shortlist',
  '/visitors',
  '/notifications',
  '/photo-requests',
  '/settings',
])

export function showsBottomBar(pathname: string): boolean {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  return BOTTOM_BAR_PATHS.has(path)
}

/**
 * The application shell (17 section 9.2): a top bar on wide screens, a bottom bar with the five
 * primary destinations on narrow screens. When the gate is not `ok`, there is no primary
 * navigation, only a back link to the gate's landing screen (17 section 4.2).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const me = useCurrentMe()
  const { pathname } = useLocation()
  const { t } = useTranslation()
  const withNavigation = showsPrimaryNavigation(me)
  const bottomBar = withNavigation && showsBottomBar(pathname)
  useWarmRoutes(withNavigation)

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2"
      >
        {t('nav.skip_to_content')}
      </a>
      <OfflineBanner />
      {withNavigation ? (
        <header className="sticky top-0 z-30 hidden border-b border-border bg-surface/95 backdrop-blur md:block">
          <div className="container-app flex h-16 items-center gap-6">
            <BrandLink />
            <TopNavLinks />
            <div className="ms-auto flex items-center gap-2">
              <NotificationBell />
              <AccountMenu />
            </div>
          </div>
        </header>
      ) : (
        <header className="border-b border-border bg-surface">
          <div className="container-app flex h-14 items-center gap-3">
            <Link
              to={gateHome(me)}
              className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 font-medium text-primary hover:bg-muted"
            >
              <ArrowLeft className="size-5 rtl:-scale-x-100" aria-hidden />
              {t('nav.back_to')}
            </Link>
          </div>
        </header>
      )}
      <main
        id="main"
        tabIndex={-1}
        className={bottomBar ? 'flex-1 pb-24 outline-none md:pb-10' : 'flex-1 pb-10 outline-none'}
      >
        {children}
      </main>
      {bottomBar ? <BottomNav /> : null}
    </div>
  )
}
