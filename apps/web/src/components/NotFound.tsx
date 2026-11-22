import { Link } from '@tanstack/react-router'
import { SearchX } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Band } from '~/components/common/Band'
import { EmptyState } from '~/components/common/EmptyState'
import { Button } from '~/components/ui/button'

/** Unknown URLs (17 section 4.4). Inside the app shell it renders within the shell. */
export function NotFound({ children }: { children?: ReactNode }) {
  const { t } = useTranslation()
  return (
    <Band as="div" width="column" className="flex-1">
      <EmptyState
        icon={SearchX}
        titleAs="h1"
        title={t('not_found.title')}
        text={children ? null : t('not_found.text')}
        action={
          <>
            <Button variant="secondary" onClick={() => window.history.back()}>
              {t('not_found.go_back')}
            </Button>
            <Button asChild>
              <Link to="/">{t('not_found.home')}</Link>
            </Button>
          </>
        }
      >
        {children ? (
          <div className="max-w-measure text-foreground-secondary">{children}</div>
        ) : null}
      </EmptyState>
    </Band>
  )
}
