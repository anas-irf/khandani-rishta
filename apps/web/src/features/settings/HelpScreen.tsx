// SET-HELP (16 section 6.30)
import { Link } from '@tanstack/react-router'
import { Mail } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '~/components/common/PageHeader'
import { SectionCard } from '~/components/common/SectionCard'
import { allowedForGate, gateHome } from '~/lib/gate'
import { useCurrentMe } from '~/lib/me'
import { APP_VERSION } from './app-version'
import { RowChevron, SettingsPage } from './controls'

const PAGES = [
  { to: '/safety', key: 'safety' },
  { to: '/how-it-works', key: 'how' },
  { to: '/faq', key: 'faq' },
  { to: '/nikah-guide', key: 'nikah' },
  { to: '/community-guidelines', key: 'guidelines' },
  { to: '/terms', key: 'terms' },
  { to: '/privacy', key: 'privacy' },
] as const

const rowClass =
  'flex min-h-12 w-full items-center gap-3 px-4 py-3 text-start text-base font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'

export function HelpScreen() {
  const { t } = useTranslation('settings')
  const me = useCurrentMe()
  // Reachable under every gate except `consent_required` (16 section 3.2); the way back is the
  // settings menu when that is open to this member, otherwise the gate's own screen.
  const backTo = allowedForGate(me, '/settings') ? '/settings' : gateHome(me)

  const code = me.profile.public_code
  const mailto = `mailto:${me.config.support_email}?subject=${encodeURIComponent(
    t('help.support.subject', { code }),
  )}&body=${encodeURIComponent(`\n\n${t('help.support.body', { version: APP_VERSION })}`)}`

  return (
    <SettingsPage>
      <PageHeader title={t('help.title')} backTo={backTo} />
      <nav aria-label={t('help.list_label')}>
        <ul className="divide-y divide-border overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
          {PAGES.map((page) => (
            <li key={page.key}>
              <Link to={page.to} className={rowClass}>
                <span className="flex-1">{t(`help.rows.${page.key}`)}</span>
                <RowChevron />
              </Link>
            </li>
          ))}
          <li>
            <a href={mailto} className={rowClass}>
              <Mail aria-hidden="true" className="size-5 text-muted-foreground" />
              <span className="flex-1">{t('help.rows.contact')}</span>
            </a>
          </li>
        </ul>
      </nav>

      <SectionCard title={t('help.about.title')}>
        <p>{t('help.about.version', { version: APP_VERSION })}</p>
        <p>{t('help.about.code', { code })}</p>
        <p className="text-sm text-muted-foreground">{t('geonames', { ns: 'common' })}</p>
      </SectionCard>
    </SettingsPage>
  )
}
