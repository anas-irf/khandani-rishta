import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/button'

/** Unknown URLs (17 section 4.4). Inside the app shell it renders within the shell. */
export function NotFound({ children }: { children?: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="container-app flex flex-col items-start gap-4 py-10">
      <div className="text-muted-foreground">{children ?? <p>{t('not_found.text')}</p>}</div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => window.history.back()}>
          {t('not_found.go_back')}
        </Button>
        <Button asChild>
          <Link to="/">{t('not_found.home')}</Link>
        </Button>
      </div>
    </div>
  )
}
