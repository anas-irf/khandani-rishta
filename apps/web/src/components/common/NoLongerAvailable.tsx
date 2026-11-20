import { Link } from '@tanstack/react-router'
import { SearchX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/button'
import { cn } from '~/lib/utils'
import { useGoBack } from './PageHeader'

/**
 * "This is no longer available." for a profile, interest or connection that answered
 * `not_found` (16 sections 1.3 and 4.2), with "Go back" and a way to `APP-HOME`.
 */
export function NoLongerAvailable({
  message,
  className,
}: {
  /** A screen's own text, for example "This profile is not available." on `APP-PROFILE`. */
  message?: string
  className?: string
}) {
  const { t } = useTranslation('errors')
  const goBack = useGoBack()

  return (
    <div
      role="status"
      className={cn('flex flex-col items-center gap-4 px-4 py-12 text-center', className)}
    >
      <span className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <SearchX aria-hidden="true" className="size-7" />
      </span>
      <h2 className="text-lg font-semibold">{message ?? t('no_longer_available')}</h2>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="secondary" onClick={goBack}>
          {t('go_back')}
        </Button>
        <Button asChild>
          <Link to="/home">{t('go_home')}</Link>
        </Button>
      </div>
    </div>
  )
}
