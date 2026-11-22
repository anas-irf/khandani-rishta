// SET-HELP (16 section 6.30)
import { Mail } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Band } from '~/components/common/Band'
import { AnchorRow, LinkRow } from '~/components/common/LinkRow'
import { Page } from '~/components/common/Page'
import { allowedForGate, gateHome } from '~/lib/gate'
import { useCurrentMe } from '~/lib/me'
import { APP_VERSION } from './app-version'
import { SettingsGroup } from './controls'

const PAGES = [
  { to: '/safety', key: 'safety' },
  { to: '/how-it-works', key: 'how' },
  { to: '/faq', key: 'faq' },
  { to: '/nikah-guide', key: 'nikah' },
  { to: '/community-guidelines', key: 'guidelines' },
  { to: '/terms', key: 'terms' },
  { to: '/privacy', key: 'privacy' },
] as const

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
    <Page title={t('help.title')} backTo={backTo} width="column" layout="bands">
      <Band as="div" tone="auto" width="column" space="sm">
        <nav aria-label={t('help.list_label')}>
          <ul className="flex flex-col">
            {PAGES.map((page) => (
              <li key={page.key} className="border-b border-border">
                <LinkRow to={page.to} label={t(`help.rows.${page.key}`)} />
              </li>
            ))}
            <li className="border-b border-border">
              <AnchorRow href={mailto} icon={Mail} label={t('help.rows.contact')} />
            </li>
          </ul>
        </nav>
      </Band>

      <SettingsGroup title={t('help.about.title')}>
        <p>{t('help.about.version', { version: APP_VERSION })}</p>
        <p className="tabular-nums">{t('help.about.code', { code })}</p>
        <p className="text-caption text-muted-foreground">{t('geonames', { ns: 'common' })}</p>
      </SettingsGroup>
    </Page>
  )
}
