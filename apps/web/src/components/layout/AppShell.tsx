import { Link, useLocation } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { OfflineBanner } from '~/components/common/OfflineBanner'
import { BackArrow } from '~/components/common/PageHeader'
import { SkipLink } from '~/components/common/SkipLink'
import { Button } from '~/components/ui/button'
import { gateHome, showsPrimaryNavigation } from '~/lib/gate'
import { useCurrentMe } from '~/lib/me'
import { useBarHeight } from '~/lib/media'
import { cn } from '~/lib/utils'
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

function withoutSlash(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
}

export function showsBottomBar(pathname: string): boolean {
  return BOTTOM_BAR_PATHS.has(withoutSlash(pathname))
}

/**
 * The screens that fill the window and scroll inside (17 section 9.1): a conversation at every
 * width, and the rest of Chats where the list is a pane of its own.
 */
function fillsWindow(pathname: string): 'always' | 'wide' | null {
  const path = withoutSlash(pathname)
  if (/^\/chats\/[^/]+$/.test(path)) return 'always'
  return path === '/chats' || path.startsWith('/chats/') ? 'wide' : null
}

/**
 * The application shell (17 section 9.2, DESIGN.md 6.16 and 6.17): the top bar on wide screens,
 * the bottom bar with the five primary destinations on narrow screens. Both bars stay in the
 * flow, so neither covers content however tall larger text makes them. When the gate is not
 * `ok`, there is no primary navigation, only a back link to the gate's landing screen
 * (17 section 4.2).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const me = useCurrentMe()
  const { pathname } = useLocation()
  const { t } = useTranslation()
  const withNavigation = showsPrimaryNavigation(me)
  const bottomBar = withNavigation && showsBottomBar(pathname)
  const fill = fillsWindow(pathname)
  useWarmRoutes(withNavigation)

  return (
    <div
      className={cn(
        'flex min-h-dvh flex-col',
        fill === 'always' && 'h-dvh',
        fill === 'wide' && 'wide:h-dvh',
      )}
    >
      <SkipLink label={t('nav.skip_to_content')} />
      <OfflineBanner />
      {withNavigation ? (
        <TopBar />
      ) : (
        <header className="border-b border-border bg-background">
          <div className="container-app flex min-h-[64px] items-center">
            <Button asChild variant="ghost" className="-ms-[12px] ps-2 pe-4">
              <Link to={gateHome(me)}>
                <BackArrow />
                {t('nav.back_to')}
              </Link>
            </Button>
          </div>
        </header>
      )}
      <main
        id="main"
        tabIndex={-1}
        data-fills-window={fill === 'always' ? '' : undefined}
        className={cn(
          'flex flex-1 flex-col',
          fill === 'always' && 'min-h-0 overflow-y-auto',
          fill === 'wide' && 'wide:min-h-0 wide:overflow-y-auto',
        )}
      >
        {children}
      </main>
      {bottomBar ? <BottomNav /> : null}
    </div>
  )
}

/**
 * The wide top bar: 80 tall, and taller only when it has to wrap. From 1024 the navigation wraps
 * inside its own space, so the wordmark and the account never leave the first line; below that
 * it has a line of its own.
 */
function TopBar() {
  const ref = useBarHeight('--app-bar')
  return (
    <header
      ref={ref}
      data-slot="top-bar"
      className="sticky top-0 z-30 hidden border-b border-border bg-background wide:block"
    >
      <div className="container-app flex min-h-[80px] flex-wrap items-center gap-x-3 gap-y-1 py-2 xl:gap-x-4">
        <BrandLink />
        <TopNavLinks className="order-last basis-full lg:order-none lg:min-w-min lg:flex-1 lg:basis-0" />
        <div className="ms-auto flex max-w-full flex-wrap items-center justify-end gap-2 xl:gap-3">
          <NotificationBell variant="pill" />
          <AccountMenu />
        </div>
      </div>
    </header>
  )
}
