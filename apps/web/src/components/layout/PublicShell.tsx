import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { SkipLink } from '~/components/common/SkipLink'
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
      <SkipLink label={t('nav.skip_to_content')} />
      <PublicHeader />
      <main id="main" tabIndex={-1} className="flex flex-1 flex-col">
        {children}
      </main>
      <PublicFooter />
    </div>
  )
}
