import type { ErrorComponentProps } from '@tanstack/react-router'
import { Link, useLocation, useRouter } from '@tanstack/react-router'
import { TriangleAlert } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Band } from '~/components/common/Band'
import { EmptyState } from '~/components/common/EmptyState'
import { Button } from '~/components/ui/button'
import { reportError } from '~/lib/monitoring'

/**
 * A route that failed to render. The error is reported, never shown: its message may carry
 * technical details that mean nothing to a member (16 rule G3 for the wording).
 */
export function DefaultCatchBoundary({ error }: ErrorComponentProps) {
  const { t } = useTranslation()
  const router = useRouter()
  const isRoot = useLocation({ select: (location) => location.pathname === '/' })

  useEffect(() => {
    reportError(error, { source: 'route' })
  }, [error])

  return (
    <Band as="div" width="column" className="flex-1">
      <EmptyState
        icon={TriangleAlert}
        tone="danger"
        titleAs="h1"
        title={t('route_error.title')}
        text={t('route_error.text')}
        action={
          <>
            <Button onClick={() => void router.invalidate()}>{t('route_error.try_again')}</Button>
            {isRoot ? (
              <Button variant="secondary" asChild>
                <Link to="/">{t('route_error.home')}</Link>
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => window.history.back()}>
                {t('route_error.go_back')}
              </Button>
            )}
          </>
        }
      />
    </Band>
  )
}
