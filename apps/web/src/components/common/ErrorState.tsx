import { TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '~/components/ui/button'
import { isApiError } from '~/lib/api'
import { cn } from '~/lib/utils'

/**
 * A screen-level load error (16 rule G3): "Something went wrong", the support text, "Try again"
 * and "Reference: {x-request-id}" in small type when the API sent one.
 */
export function ErrorState({
  error,
  onRetry,
  retrying = false,
  className,
}: {
  error: unknown
  onRetry: () => void
  /** Shows a spinner in the button while the retry runs. */
  retrying?: boolean
  className?: string
}) {
  const { t } = useTranslation('errors')
  const requestId = isApiError(error) ? error.requestId : null

  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center gap-3 px-4 py-10 text-center', className)}
    >
      <span className="flex size-14 items-center justify-center rounded-full bg-danger-soft text-danger">
        <TriangleAlert aria-hidden="true" className="size-7" />
      </span>
      <h2 className="text-lg font-semibold">{t('generic.screen_title')}</h2>
      <p className="max-w-md text-muted-foreground">{t('generic.screen_text')}</p>
      <Button onClick={onRetry} loading={retrying}>
        {t('generic.try_again')}
      </Button>
      {requestId ? (
        <p className="text-sm text-muted-foreground">{t('reference', { id: requestId })}</p>
      ) : null}
    </div>
  )
}
