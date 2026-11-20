import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { PublicFooter } from './PublicFooter'
import { PublicHeader } from './PublicHeader'

/**
 * The frame of every public page (17 section 3.1): a skip link, the header, `<main id="main">`
 * and the footer. Public pages are content only and render on the server.
 */
export function PublicShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[60] focus:rounded-[var(--radius-input)] focus:bg-surface focus:px-4 focus:py-3 focus:font-medium focus:text-primary focus:shadow-lg"
      >
        {t('nav.skip_to_content')}
      </a>
      <PublicHeader />
      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
        {children}
      </main>
      <PublicFooter />
    </div>
  )
}
