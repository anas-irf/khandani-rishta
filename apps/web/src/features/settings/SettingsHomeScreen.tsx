// SET-HOME (16 section 6.24)
import { Link } from '@tanstack/react-router'
import { Bell, LifeBuoy, Phone, ShieldCheck, UserCog, UserX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '~/components/common/PageHeader'
import { useCurrentMe } from '~/lib/me'
import { APP_VERSION } from './app-version'
import { RowChevron, SettingsPage } from './controls'
import { SignOutButton } from './SignOutButton'

const ROWS = [
  { to: '/settings/privacy', key: 'privacy', icon: ShieldCheck },
  { to: '/settings/notifications', key: 'notifications', icon: Bell },
  { to: '/settings/contacts', key: 'contacts', icon: Phone },
  // Needs an active profile, so it is only offered under the gate `ok` (16 section 3.2).
  { to: '/settings/blocked', key: 'blocked', icon: UserX, onlyWhenOk: true },
  { to: '/settings/account', key: 'account', icon: UserCog },
  { to: '/settings/help', key: 'help', icon: LifeBuoy },
] as const

export function SettingsHomeScreen() {
  const { t } = useTranslation('settings')
  const me = useCurrentMe()
  const rows = ROWS.filter((row) => !('onlyWhenOk' in row) || me.gate === 'ok')

  return (
    <SettingsPage>
      <PageHeader title={t('title')} />
      <nav aria-label={t('home.list_label')}>
        <ul className="divide-y divide-border overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
          {rows.map((row) => (
            <li key={row.key}>
              <Link
                to={row.to}
                className="flex min-h-12 w-full items-center gap-3 px-4 py-3 text-base font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <row.icon aria-hidden="true" className="size-5 text-muted-foreground" />
                <span className="flex-1">{t(`home.rows.${row.key}`)}</span>
                <RowChevron />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex flex-col items-start gap-3">
        <SignOutButton />
        <p className="text-sm text-muted-foreground">
          {t('home.version', { version: APP_VERSION })}
        </p>
      </div>
    </SettingsPage>
  )
}
