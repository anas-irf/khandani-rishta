import { Link, Outlet } from '@tanstack/react-router'
import { BookOpenCheck, Keyboard } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NotFound } from '~/components/NotFound'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { useCurrentMe } from '~/lib/me'
import { badgeCount, cn } from '~/lib/utils'
import { isStaffRole } from './access'
import { ConductDialog, ShortcutHelpDialog } from './components/HelpDialogs'
import { useAdminOverview } from './queries'
import { useShortcuts } from './shortcuts'
import type { AdminOverview, StaffRole } from './types'

type NavTarget =
  | '/admin'
  | '/admin/profiles'
  | '/admin/photos'
  | '/admin/texts'
  | '/admin/verifications'
  | '/admin/reports'
  | '/admin/users'
  | '/admin/castes'
  | '/admin/settings'
  | '/admin/releases'
  | '/admin/announcements'
  | '/admin/audit-log'

type NavItem = {
  id: string
  to: NavTarget
  /** Key under `admin:nav`. */
  label: string
  adminOnly?: boolean
  /** The count shown in the badge, from the overview. */
  count?: (queues: AdminOverview['queues']) => number
}

/** The sidebar of 18 section 3, in order. Admin-only entries are not rendered for moderators. */
export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'ADM-HOME', to: '/admin', label: 'overview' },
  {
    id: 'ADM-PROFILES',
    to: '/admin/profiles',
    label: 'profiles',
    count: (queues) => queues.profiles_pending,
  },
  { id: 'ADM-PHOTOS', to: '/admin/photos', label: 'photos', count: (q) => q.photos_pending },
  { id: 'ADM-TEXTS', to: '/admin/texts', label: 'texts', count: (q) => q.texts_pending },
  {
    id: 'ADM-VERIFICATIONS',
    to: '/admin/verifications',
    label: 'verifications',
    count: (q) => q.verifications_pending,
  },
  {
    id: 'ADM-REPORTS',
    to: '/admin/reports',
    label: 'reports',
    count: (q) => q.reports_open + q.reports_in_review,
  },
  { id: 'ADM-USERS', to: '/admin/users', label: 'users' },
  {
    id: 'ADM-CASTES',
    to: '/admin/castes',
    label: 'castes',
    count: (q) => q.caste_suggestions_pending,
  },
  { id: 'ADM-SETTINGS', to: '/admin/settings', label: 'settings', adminOnly: true },
  { id: 'ADM-RELEASES', to: '/admin/releases', label: 'releases', adminOnly: true },
  { id: 'ADM-ANNOUNCE', to: '/admin/announcements', label: 'announcements', adminOnly: true },
  { id: 'ADM-AUDIT', to: '/admin/audit-log', label: 'audit_log', adminOnly: true },
]

/**
 * The staff console layout (17 section 16, 18 section 3). Anyone whose role is not `moderator`
 * or `admin` sees "Not found", as if the page did not exist.
 */
export function AdminLayout() {
  const me = useCurrentMe()
  if (!isStaffRole(me.user.role)) return <NotFound />
  return <AdminShell role={me.user.role} />
}

function AdminShell({ role }: { role: StaffRole }) {
  const { t } = useTranslation('admin')
  const overview = useAdminOverview()
  const [dialog, setDialog] = useState<'shortcuts' | 'conduct' | null>(null)

  useShortcuts({ '?': () => setDialog('shortcuts') })

  const items = NAV_ITEMS.filter((item) => !item.adminOnly || role === 'admin')

  return (
    <div className="flex min-h-dvh min-w-[1024px] flex-col bg-background">
      <a
        href="#admin-main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2"
      >
        {t('layout.skip')}
      </a>
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-surface px-4">
        <p className="text-lg font-bold text-primary">{t('layout.title')}</p>
        <Badge variant={role === 'admin' ? 'danger' : 'secondary'}>{t(`role.${role}`)}</Badge>
        <div className="ms-auto flex items-center gap-2">
          <Button variant="ghost" onClick={() => setDialog('shortcuts')}>
            <Keyboard aria-hidden="true" />
            {t('layout.shortcuts')}
          </Button>
          <Button asChild variant="secondary">
            <Link to="/home">{t('layout.back_to_app')}</Link>
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-60 shrink-0 flex-col justify-between border-e border-border bg-surface">
          <nav aria-label={t('layout.nav')} className="p-2">
            <ul className="flex flex-col gap-1">
              {items.map((item) => {
                const count = overview.data ? (item.count?.(overview.data.queues) ?? 0) : 0
                return (
                  <li key={item.id}>
                    <Link
                      to={item.to}
                      activeOptions={{ exact: item.to === '/admin' }}
                      className={cn(
                        'flex min-h-11 items-center justify-between gap-2 rounded-md px-3 text-sm font-medium text-foreground hover:bg-muted',
                      )}
                      activeProps={{
                        className: 'bg-primary-soft text-primary hover:bg-primary-soft',
                        'aria-current': 'page',
                      }}
                    >
                      <span>{t(`nav.${item.label}`)}</span>
                      {count > 0 ? (
                        <Badge variant="secondary" className="min-w-6">
                          <span aria-hidden="true">{badgeCount(count)}</span>
                          <span className="sr-only">{t('layout.waiting', { count })}</span>
                        </Badge>
                      ) : null}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>
          <footer className="border-t border-border p-2">
            <Button
              variant="ghost"
              className="w-full justify-start"
              onClick={() => setDialog('conduct')}
            >
              <BookOpenCheck aria-hidden="true" />
              {t('layout.conduct')}
            </Button>
          </footer>
        </aside>
        <main id="admin-main" tabIndex={-1} className="min-w-0 flex-1 p-6 outline-none">
          <Outlet />
        </main>
      </div>
      {dialog === 'shortcuts' ? <ShortcutHelpDialog onClose={() => setDialog(null)} /> : null}
      {dialog === 'conduct' ? <ConductDialog onClose={() => setDialog(null)} /> : null}
    </div>
  )
}
