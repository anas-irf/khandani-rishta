import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Band } from '~/components/common/Band'
import { OfflineBanner } from '~/components/common/OfflineBanner'
import { OrnamentRule } from '~/components/common/Ornament'
import { SkipLink } from '~/components/common/SkipLink'
import { TextLink } from '~/components/common/TextLink'
import { Wordmark } from '~/components/layout/Logo'
import { SignOutButton } from '~/features/settings/SignOutButton'

/**
 * The page every gate screen shares (16 section 6.2): outside the app shell, no primary
 * navigation, the wordmark, the title on sand, one column with the screen's content, and under
 * it the way out: a link to `SET-HELP` where the gate allows it (16 section 3.2) and "Sign out".
 */
export function GateLayout({
  title,
  children,
  helpLink = true,
}: {
  title: string
  children: ReactNode
  /** `SET-HELP` is open under every gate except `consent_required`. */
  helpLink?: boolean
}) {
  const { t } = useTranslation(['gate', 'common'])
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <SkipLink label={t('common:nav.skip_to_content')} />
      <OfflineBanner />
      <header className="border-b border-border">
        <div className="container-app flex min-h-[64px] items-center py-2 wide:min-h-[80px]">
          <Wordmark />
        </div>
      </header>
      <main id="main" tabIndex={-1} className="flex flex-1 flex-col">
        <Band as="div" tone="sand" width="form" space="sm" innerClassName="flex flex-col gap-3">
          <OrnamentRule />
          <h1 className="text-headline-md">{title}</h1>
        </Band>
        <Band
          as="div"
          width="form"
          space="sm"
          className="flex-1"
          innerClassName="flex flex-col gap-6"
        >
          {children}
        </Band>
      </main>
      <footer className="border-t border-border">
        <div className="container-app flex flex-wrap items-center justify-center gap-x-5 gap-y-2 py-3">
          {helpLink ? <TextLink to="/settings/help">{t('gate:layout.help')}</TextLink> : null}
          <SignOutButton variant="quiet" />
        </div>
      </footer>
    </div>
  )
}

/** A link to a public page that opens in a new tab, so the gate screen keeps its state. */
export function PublicPageLink({
  to,
  children,
}: {
  to: '/terms' | '/privacy' | '/community-guidelines'
  children: ReactNode
}) {
  const { t } = useTranslation('gate')
  return (
    <TextLink to={to} target="_blank" rel="noopener noreferrer">
      {children}
      <span className="sr-only">{t('layout.opens_in_new_tab')}</span>
    </TextLink>
  )
}
