// SET-HOME (16 section 6.24)
import { Bell, LifeBuoy, Phone, ShieldCheck, UserCog, UserX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { LinkRow } from '~/components/common/LinkRow'
import { Page } from '~/components/common/Page'
import { useCurrentMe } from '~/lib/me'
import { APP_VERSION } from './app-version'
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
    <Page title={t('title')} width="column">
      <nav aria-label={t('home.list_label')}>
        <ul className="flex flex-col">
          {rows.map((row) => (
            <li key={row.key} className="border-b border-border">
              <LinkRow to={row.to} icon={row.icon} label={t(`home.rows.${row.key}`)} />
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex flex-col items-start gap-4">
        <SignOutButton />
        <p className="text-caption text-muted-foreground">
          {t('home.version', { version: APP_VERSION })}
        </p>
      </div>
    </Page>
  )
}
