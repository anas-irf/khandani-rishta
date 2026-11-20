import type { ErrorComponentProps } from '@tanstack/react-router'
import { Link, useLocation, useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
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
    <div className="container-app flex min-h-[50dvh] flex-col items-center justify-center gap-4 py-10 text-center">
      <h1 className="text-2xl font-semibold">{t('route_error.title')}</h1>
      <p className="max-w-md text-muted-foreground">{t('route_error.text')}</p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={() => void router.invalidate()}>{t('route_error.try_again')}</Button>
        {isRoot ? (
          <Button variant="outline" asChild>
            <Link to="/">{t('route_error.home')}</Link>
          </Button>
        ) : (
          <Button variant="outline" onClick={() => window.history.back()}>
            {t('route_error.go_back')}
          </Button>
        )}
      </div>
    </div>
  )
}
