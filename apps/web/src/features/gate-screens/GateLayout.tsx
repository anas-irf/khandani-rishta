import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { OfflineBanner } from '~/components/common/OfflineBanner'
import { LogoMark } from '~/components/layout/Logo'
import { SignOutButton } from '~/features/settings/SignOutButton'

/**
 * The page every gate screen shares (16 section 6.2): outside the app shell, no primary
 * navigation, the logo, one centred card with the screen's content, and under it the way out:
 * a link to `SET-HELP` where the gate allows it (16 section 3.2) and "Sign out".
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
      <OfflineBanner />
      <header className="border-b border-border bg-surface">
        <div className="container-app flex h-16 items-center gap-2">
          <LogoMark />
          <span className="text-lg font-bold">{t('common:app_name')}</span>
        </div>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="flex flex-1 flex-col items-center px-4 py-8 outline-none"
      >
        <div className="flex w-full max-w-lg flex-col gap-5 rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-sm md:p-8">
          <h1 className="text-2xl font-semibold leading-snug">{title}</h1>
          {children}
        </div>
      </main>
      <footer className="border-t border-border bg-surface">
        <div className="container-app flex flex-wrap items-center justify-center gap-x-4 gap-y-1 py-3">
          {helpLink ? (
            <Link
              to="/settings/help"
              className="inline-flex min-h-11 items-center rounded-md font-medium text-primary underline-offset-4 hover:underline"
            >
              {t('gate:layout.help')}
            </Link>
          ) : null}
          <SignOutButton variant="ghost" />
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
    <Link
      to={to}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
    >
      {children}
      <span className="sr-only">{t('layout.opens_in_new_tab')}</span>
    </Link>
  )
}
